/**
 * Source result contract (P4, openspec/changes/p4-source-contract).
 *
 * Why this exists: the contract until now was `fetch(): Promise<Job[]>`, and
 * an array is everything a source could say. So `[]` meant, all at once,
 * "there are no jobs", "I was blocked", "my parser broke" and "I have no
 * credential". P2 recovered that distinction from OUTSIDE, with loose signals
 * and a heuristic; P4 moves it into the contract, which is where the source
 * actually knows the answer.
 *
 * The vocabulary is deliberately the one `source_attempts.status` has
 * accepted since P2 (`blocked`, `rate_limited`, `quota_exhausted`,
 * `misconfigured`, `schema_changed`, ...) rather than a parallel one. Those
 * five statuses had ZERO occurrences in 7 days of production — not because
 * sources never get blocked, but because nothing could express it.
 *
 * The one invariant that orders the whole type:
 *
 *     `empty` means the source answered and there is genuinely nothing.
 *     Every other reason for `data.length === 0` has its own outcome.
 */

/** Mirrors P2's AttemptStatus vocabulary — not a second taxonomy. */
export type SourceOutcome =
  | "success"
  | "partial"
  | "empty"
  | "blocked"
  | "rate_limited"
  | "quota_exhausted"
  | "misconfigured"
  | "schema_changed"
  | "timeout"
  | "failed";

export interface SourceFetchCounters {
  /** What the source handed over, before validation. */
  received: number;
  /** What survived validation. */
  valid: number;
  /** HTTP requests actually issued. */
  requests: number;
  /** null = the source does not report it. NEVER invented (AGENTS.md #5). */
  bytes: number | null;
}

export interface SourceFetchError {
  /**
   * The error CLASS, never the raw message: a message can carry a URL with
   * an api_key in its query string, and this object is what reaches logs and
   * `source_attempts.error_class`.
   */
  readonly class: string;
  readonly statusCode?: number;
  /** Milliseconds the source asked us to wait (Retry-After). */
  readonly retryAfterMs?: number;
}

export interface SourceFetchResult<T> {
  readonly outcome: SourceOutcome;
  /** Never null: an empty array is still an array. Non-empty iff success/partial. */
  readonly data: T[];
  readonly counters: SourceFetchCounters;
  /**
   * Present for every outcome except `success` and `empty` — including
   * `partial`, which is the interesting case: it carries data AND a cause.
   */
  readonly error?: SourceFetchError;
  /** Stable, human-readable reason. Lands in `source_attempts.reason`. */
  readonly reason: string;
}

export const NO_COUNTERS: SourceFetchCounters = { received: 0, valid: 0, requests: 0, bytes: null };

export function successResult<T>(data: T[], counters: SourceFetchCounters): SourceFetchResult<T> {
  return { outcome: "success", data, counters, reason: "ok" };
}

/**
 * Data came through AND something explains the shortfall. The most frequent
 * real outcome of the detail stage (LinkedIn 28 attempts, LinkedIn-VE 17,
 * Computrabajo 9 over 7 days) — collapsing it into `success` throws away
 * precisely what this phase preserves.
 */
export function partialResult<T>(
  data: T[],
  error: SourceFetchError,
  reason: string,
  counters: SourceFetchCounters
): SourceFetchResult<T> {
  return { outcome: "partial", data, counters, error, reason };
}

export function emptyResult<T>(reason: string, counters: SourceFetchCounters): SourceFetchResult<T> {
  return { outcome: "empty", data: [], counters, reason };
}

export function failedResult<T>(
  outcome: Exclude<SourceOutcome, "success" | "partial" | "empty">,
  error: SourceFetchError,
  reason: string,
  counters: SourceFetchCounters = NO_COUNTERS
): SourceFetchResult<T> {
  return { outcome, data: [], counters, error, reason };
}

/**
 * Strips an error down to what is safe to keep. Only the constructor name
 * survives; the message and any URL inside it are dropped on the floor. A
 * status code and a Retry-After are kept because they are facts, not text.
 */
export function classifyError(error: unknown): SourceFetchError {
  if (!(error instanceof Error)) return { class: "UnknownError" };
  const candidate = error as Error & {
    statusCode?: unknown;
    status?: unknown;
    retryAfterMs?: unknown;
  };
  const statusCode =
    typeof candidate.statusCode === "number"
      ? candidate.statusCode
      : typeof candidate.status === "number"
        ? candidate.status
        : undefined;
  const retryAfterMs = typeof candidate.retryAfterMs === "number" ? candidate.retryAfterMs : undefined;
  return { class: error.name || "Error", ...(statusCode !== undefined ? { statusCode } : {}), ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
}

function outcomeForError(error: unknown): { outcome: SourceOutcome; reason: string } {
  if (error instanceof Error) {
    switch (error.name) {
      case "FetchBlockedError":
        return { outcome: "blocked", reason: "http_deny" };
      case "FetchRateLimitedError":
        return { outcome: "rate_limited", reason: "retry_after" };
      case "AbortError":
      case "TimeoutError":
        return { outcome: "timeout", reason: "deadline_exceeded" };
      default:
        break;
    }
    if ((error as { code?: unknown }).code === "ETIMEDOUT") {
      return { outcome: "timeout", reason: "timeout" };
    }
  }
  return { outcome: "failed", reason: "exception" };
}

/**
 * Builds the result for a finished attempt. `error` null means the fetch
 * itself completed — what is left to decide is whether the data it produced
 * says anything is wrong.
 */
export function classifyFetchResult<T>(
  error: unknown,
  counters: SourceFetchCounters,
  data: T[] = []
): SourceFetchResult<T> {
  if (error !== null && error !== undefined) {
    const { outcome, reason } = outcomeForError(error);
    return { outcome, data: [], counters, error: classifyError(error), reason };
  }

  // Received something but nothing survived validation. NOT `empty`: jobs
  // did arrive. This is Jooble's live shape (14 received / 0 valid, because
  // it is the only stamped source missing from KNOWN_SOURCES). P4 classifies
  // it; repairing the adapter is P5.
  if (counters.received > 0 && counters.valid === 0) {
    return {
      outcome: "failed",
      data: [],
      counters,
      error: { class: "AllRejectedByValidation" },
      reason: "all_rejected_by_validation"
    };
  }

  if (counters.received === 0) return emptyResult<T>("no_results", counters);
  return successResult<T>(data, counters);
}

/**
 * Wraps an adapter that still returns `Job[]` — all 17 of them today —
 * WITHOUT changing it. This is what makes adoption gradual (spec SRC-002).
 *
 * The resulting classification is deliberately no richer than what P2
 * already inferred: an empty array stays `empty`, because an unmigrated
 * adapter genuinely has no way to say anything else. Pretending otherwise
 * here would make each P5 migration look like a no-op instead of a real
 * gain in information.
 */
export function liftJobArray<T>(data: T[], requests = 1): SourceFetchResult<T> {
  const counters: SourceFetchCounters = {
    received: data.length,
    valid: data.length,
    requests,
    bytes: null
  };
  if (data.length === 0) return emptyResult<T>("no_results", counters);
  return successResult<T>(data, counters);
}
