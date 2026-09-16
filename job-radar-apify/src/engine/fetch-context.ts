/**
 * Deadline + cancellation propagated through the shared choke points of the
 * scrape pipeline (P3, openspec/changes/p3-execution-deadlines).
 *
 * Why this exists: before P3 every timeout in the tick was a `Promise.race`,
 * which resolves but never cancels the loser — a role that "timed out" kept
 * fetching and saving in the background, holding pool clients until the
 * process was hard-killed by Actions at `timeout-minutes` (25% of CO ticks
 * ended `cancelled` at 27-28 min). A race announces a deadline; it doesn't
 * enforce one.
 *
 * The contract is deliberately OPTIONAL everywhere it's accepted (`ctx?`).
 * Without a context every call site behaves exactly as it did before, which
 * is what lets the ~15 adapters — and the reputation pipeline that shares
 * `executeWithResilience` — stay untouched. Adapters inherit cancellation at
 * the wrapper boundary: after the deadline no NEW request is started and no
 * backoff/jitter sleep runs to completion. Threading the signal into each
 * adapter's own HTTP calls belongs to P4/P5, where each one is opened anyway.
 *
 * The one rule that orders the whole design (spec EXE-005):
 *
 *     Cancel work that hasn't started. Never work that is already writing.
 */

export interface FetchContext {
  /** Aborts when the deadline passes, or when a parent context aborts. */
  readonly signal: AbortSignal;
  /** Epoch ms at which this context's budget runs out. */
  readonly deadlineAt: number;
  /** Milliseconds left, never negative. */
  remainingMs(): number;
  /**
   * Whether a unit of work that plausibly takes `estimateMs` still fits.
   * Checked BEFORE starting, not only while running: beginning a source
   * that needs ~90s when 20s remain isn't cancellation, it's waste with an
   * extra step.
   */
  hasBudgetFor(estimateMs: number): boolean;
  /** Resolves early when the deadline passes instead of sleeping through it. */
  sleep(ms: number): Promise<void>;
  /** Sub-context that can never outlive this one. */
  child(budgetMs: number): FetchContext;
  /** Releases this context's timer/listener. Idempotent. */
  dispose(): void;
}

class DeadlineContext implements FetchContext {
  readonly signal: AbortSignal;
  readonly deadlineAt: number;

  private readonly controller = new AbortController();
  private timer: NodeJS.Timeout | null = null;
  private readonly children = new Set<DeadlineContext>();
  private readonly parent: DeadlineContext | null;
  private disposed = false;

  constructor(deadlineAt: number, parent: DeadlineContext | null = null) {
    this.deadlineAt = deadlineAt;
    this.parent = parent;
    this.signal = this.controller.signal;

    if (parent) {
      parent.children.add(this);
      // A parent that already gave up takes its children with it, so a
      // source can't keep working under a budget the tick no longer has.
      if (parent.signal.aborted) {
        this.controller.abort();
        return;
      }
    }

    const delay = deadlineAt - Date.now();
    if (delay <= 0) {
      this.controller.abort();
      return;
    }

    this.timer = setTimeout(() => this.abortNow(), delay);
    // Critical: the deadline timer must NOT be what keeps the process alive.
    // A ref'd timer here would hold the event loop open until the deadline
    // even after all real work finished — reintroducing, from the very
    // mechanism meant to fix it, the "process won't exit" failure this
    // phase exists to remove.
    this.timer.unref?.();
  }

  private abortNow(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    for (const child of this.children) child.abortNow();
  }

  remainingMs(): number {
    if (this.controller.signal.aborted) return 0;
    return Math.max(0, this.deadlineAt - Date.now());
  }

  hasBudgetFor(estimateMs: number): boolean {
    return !this.controller.signal.aborted && this.remainingMs() >= estimateMs;
  }

  sleep(ms: number): Promise<void> {
    if (this.controller.signal.aborted || ms <= 0) return Promise.resolve();
    // Never sleep past the deadline: waiting 9s of backoff when 2s remain
    // just guarantees the retry is dead on arrival.
    const capped = Math.min(ms, this.remainingMs());
    if (capped <= 0) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.controller.signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, capped);
      this.controller.signal.addEventListener("abort", done, { once: true });
    });
  }

  child(budgetMs: number): FetchContext {
    // min(parent, now + budget) — a child can never extend its parent's
    // deadline, only shorten it.
    const childDeadline = Math.min(this.deadlineAt, Date.now() + budgetMs);
    return new DeadlineContext(childDeadline, this);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const child of this.children) child.dispose();
    this.children.clear();
    this.parent?.children.delete(this);
  }
}

/** Root context for a tick. `budgetMs <= 0` yields an already-aborted one. */
export function createFetchContext(budgetMs: number): FetchContext {
  return new DeadlineContext(Date.now() + budgetMs);
}

/**
 * True when `ctx` exists and has already given up. Written as a helper so
 * call sites read as "stop?" rather than repeating the optional-chaining
 * dance, and so that NO context always means "keep going" (pre-P3 behavior).
 */
export function isCancelled(ctx?: FetchContext): boolean {
  return ctx?.signal.aborted === true;
}

/**
 * True when there's no context (unbudgeted, pre-P3 behavior) or the context
 * still has room for `estimateMs`.
 */
export function hasBudget(ctx: FetchContext | undefined, estimateMs: number): boolean {
  return ctx === undefined || ctx.hasBudgetFor(estimateMs);
}

/** Abortable sleep that falls back to a plain timer with no context. */
export function sleepWithContext(ms: number, ctx?: FetchContext): Promise<void> {
  if (ctx) return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rough per-unit cost estimates used by `hasBudgetFor` checks. Deliberately
 * conservative: the cost of skipping a source that would have fit is one
 * cadence window (it stays due, the next tick takes it), while the cost of
 * starting one that doesn't fit is a straggler holding a pool client past
 * the deadline — the exact thing that caused the hard-kills.
 */
export const BUDGET_ESTIMATES = {
  /** One source's full keyword fanout for a role. */
  sourceListing: 30_000,
  /** One detail page plus its jitter delay. */
  detailFetch: 8_000,
  /** One retry attempt plus its backoff. */
  retry: 12_000
} as const;
