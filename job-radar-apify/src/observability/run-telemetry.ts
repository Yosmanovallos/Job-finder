import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// P2 — persistent run/attempt observability (openspec/changes/archive/
// p2-run-observability). Deliberately free of any DB import: the Postgres
// store is injected (src/db/run-repository.ts), so classification and the
// recorder's failure isolation are testable offline, and nothing in the
// scraping path can be broken by importing this module.

export const RUN_STATUSES = [
  "running", "success", "empty", "partial", "failed", "timeout", "interrupted", "skipped"
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ATTEMPT_STATUSES = [
  "running", "success", "empty", "partial", "failed", "timeout", "interrupted", "skipped",
  "blocked", "misconfigured", "rate_limited", "quota_exhausted", "schema_changed"
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** Part of the contract, but P2 has no reliable signal for them (OBS-004). */
export const RESERVED_ATTEMPT_STATUSES = ["rate_limited", "quota_exhausted", "schema_changed"] as const;

export type AttemptStage = "listing" | "detail" | "verification";
export type WorkflowName = "scrape-tick" | "browser-tick";
export type AttemptPhase = "fetch" | "persist";

export const HEARTBEAT_INTERVAL_MS = 60_000;
export const STALE_RUN_AFTER_MS = 10 * 60_000;
export const RUN_RETENTION_DAYS = 30;
export const TELEMETRY_QUERY_TIMEOUT_MS = 5_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_DRAIN_TIMEOUT_MS = 15_000;

// --- Signals ----------------------------------------------------------------

export interface SignalTally {
  request: number;
  circuit_open: number;
  blocked: number;
  retries_exhausted: number;
  misconfigured: number;
  swallowed_error: number;
  /** P3: work refused or cut short because the tick's deadline ran out. */
  deadline_exceeded: number;
}
export type SourceSignalKind = keyof SignalTally;

export function emptySignalTally(): SignalTally {
  return { request: 0, circuit_open: 0, blocked: 0, retries_exhausted: 0, misconfigured: 0, swallowed_error: 0, deadline_exceeded: 0 };
}

const attemptContext = new AsyncLocalStorage<SignalTally>();

/**
 * Lets code deep inside a fetch (resilient-fetch, scrapers) tell the active
 * attempt what really happened, without changing any return type. Outside
 * an attempt (reputation pipeline, CLI, tests) it is a no-op.
 */
export function reportSourceSignal(kind: SourceSignalKind): void {
  const tally = attemptContext.getStore();
  if (tally) tally[kind] += 1;
}

// --- Classification ---------------------------------------------------------

export interface AttemptCounters {
  received: number | null;
  valid: number | null;
  filtered: number | null;
  new: number | null;
  duplicate: number | null;
  failed: number | null;
}

export interface Classification<S extends string> {
  status: S;
  reason: string;
}

export interface AttemptClassificationInput {
  stage: AttemptStage;
  counters: AttemptCounters;
  signals: SignalTally;
  phase?: AttemptPhase;
  failure?: { error: unknown };
}

export function errorClassOf(error: unknown): string {
  if (error instanceof Error) return (error.name || "Error").slice(0, 100);
  return "NonError";
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return error.name === "AbortError" || error.name === "TimeoutError" || code === "ETIMEDOUT";
}

// Ordered by severity: a definitive deny explains more than an open circuit
// that the deny itself may have tripped.
function negativeSignal(signals: SignalTally): Classification<AttemptStatus> | null {
  if (signals.blocked > 0) return { status: "blocked", reason: "http_deny" };
  if (signals.retries_exhausted > 0) return { status: "failed", reason: "retries_exhausted" };
  if (signals.swallowed_error > 0) return { status: "failed", reason: "swallowed_error" };
  // P3: ranked below real failures (a source that was blocked was blocked —
  // the deadline is not the interesting fact) but above circuit_open, since
  // running out of budget is a live outcome and an open circuit is a skip.
  if (signals.deadline_exceeded > 0) return { status: "timeout", reason: "deadline_exceeded" };
  if (signals.circuit_open > 0) return { status: "skipped", reason: "circuit_open" };
  return null;
}

export function classifyAttempt(input: AttemptClassificationInput): Classification<AttemptStatus> {
  const { stage, counters, signals, failure, phase = "fetch" } = input;
  if (failure) {
    if (phase === "persist") return { status: "failed", reason: "persistence_error" };
    if (failure.error instanceof Error && failure.error.name === "FetchBlockedError") {
      return { status: "blocked", reason: "http_deny" };
    }
    if (isTimeoutError(failure.error)) return { status: "timeout", reason: "timeout" };
    return { status: "failed", reason: "exception" };
  }
  if (signals.misconfigured > 0) return { status: "misconfigured", reason: "missing_credentials" };
  const negative = negativeSignal(signals);

  if (stage === "detail") {
    const attempted = Math.max((counters.received ?? 0) - (counters.filtered ?? 0), 0);
    const obtained = counters.valid ?? 0;
    if (obtained > 0) {
      if (negative) return { status: "partial", reason: negative.reason };
      return obtained >= attempted ? { status: "success", reason: "ok" } : { status: "partial", reason: "detail_unavailable" };
    }
    if (negative) return negative;
    if ((counters.failed ?? 0) > 0) return { status: "failed", reason: "exception" };
    return { status: "empty", reason: "no_detail" };
  }

  const received = counters.received ?? 0;
  if (received > 0) {
    if (counters.valid === 0) return { status: "failed", reason: "all_rejected_by_validation" };
    return negative ? { status: "partial", reason: negative.reason } : { status: "success", reason: "ok" };
  }
  return negative ?? { status: "empty", reason: "no_results" };
}

const NEUTRAL_STATUSES = new Set<AttemptStatus>(["empty", "skipped"]);

export function deriveRunStatus(
  statuses: AttemptStatus[],
  options: { deadlineExceeded?: boolean } = {}
): Classification<RunStatus> {
  if (options.deadlineExceeded) return { status: "timeout", reason: "deadline_exceeded" };
  if (statuses.length === 0) return { status: "skipped", reason: "no_due_sources" };
  const degraded = statuses.some((status) => status !== "success" && !NEUTRAL_STATUSES.has(status));
  const succeeded = statuses.some((status) => status === "success" || status === "partial");
  if (degraded) {
    return succeeded
      ? { status: "partial", reason: "some_sources_degraded" }
      : { status: "failed", reason: "no_source_succeeded" };
  }
  if (succeeded) return { status: "success", reason: "ok" };
  if (statuses.includes("empty")) return { status: "empty", reason: "no_results" };
  return { status: "skipped", reason: "all_sources_skipped" };
}

// --- Environment ------------------------------------------------------------

export interface RunEnvironment {
  trigger: string;
  isTest: boolean;
  gitSha: string | null;
  ghRepository: string | null;
  ghWorkflow: string | null;
  ghRunId: string | null;
  ghRunAttempt: number | null;
}

function matching(value: string | undefined, pattern: RegExp): string | null {
  return value && pattern.test(value) ? value : null;
}

export function detectRunEnvironment(env: NodeJS.ProcessEnv): RunEnvironment {
  if (env.JOB_RADAR_TEST_MODE) {
    return { trigger: "test", isTest: true, gitSha: null, ghRepository: null, ghWorkflow: null, ghRunId: null, ghRunAttempt: null };
  }
  if (env.GITHUB_ACTIONS !== "true") {
    return { trigger: "manual", isTest: false, gitSha: null, ghRepository: null, ghWorkflow: null, ghRunId: null, ghRunAttempt: null };
  }
  const attempt = matching(env.GITHUB_RUN_ATTEMPT, /^[1-9]\d{0,3}$/);
  const workflow = env.GITHUB_WORKFLOW?.trim();
  return {
    trigger: matching(env.GITHUB_EVENT_NAME, /^[a-z_]{1,30}$/) ?? "github_actions",
    isTest: false,
    gitSha: matching(env.GITHUB_SHA, /^[0-9a-f]{40}$/i),
    ghRepository: matching(env.GITHUB_REPOSITORY, /^[\w-]{1,100}\/[\w.-]{1,99}$/),
    ghWorkflow: workflow ? workflow.slice(0, 200) : null,
    ghRunId: matching(env.GITHUB_RUN_ID, /^\d{1,20}$/),
    ghRunAttempt: attempt ? Number(attempt) : null
  };
}

// --- Cursors ----------------------------------------------------------------

export interface RunCursor {
  startedAt: string;
  id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function encodeRunCursor(cursor: RunCursor): string {
  return Buffer.from(JSON.stringify([cursor.startedAt, cursor.id])).toString("base64url");
}

export function decodeRunCursor(value: string): RunCursor | null {
  if (!value || value.length > 200) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [startedAt, id] = parsed;
    if (typeof startedAt !== "string" || typeof id !== "string" || !isUuid(id)) return null;
    const time = new Date(startedAt);
    if (Number.isNaN(time.getTime()) || time.toISOString() !== startedAt) return null;
    return { startedAt, id };
  } catch {
    return null;
  }
}

// --- Store contract ---------------------------------------------------------

export interface RunStartRecord {
  id: string;
  workflow: WorkflowName;
  country: string | null;
  startedAt: Date;
  environment: RunEnvironment;
}

export interface AttemptStartRecord {
  id: string;
  runId: string;
  source: string;
  role: string | null;
  stage: AttemptStage;
  startedAt: Date;
}

export interface AttemptFinishRecord {
  id: string;
  status: AttemptStatus;
  reason: string;
  errorClass: string | null;
  finishedAt: Date;
  durationMs: number;
  counters: AttemptCounters;
  requests: number;
}

export interface RunTotals {
  attempts: number;
  received: number;
  new: number;
  duplicate: number;
}

export interface RunFinishRecord {
  id: string;
  status: RunStatus;
  reason: string;
  finishedAt: Date;
  totals: RunTotals;
}

export interface RunTelemetryStore {
  insertRun(record: RunStartRecord): Promise<void>;
  heartbeatRun(runId: string): Promise<void>;
  insertAttempt(record: AttemptStartRecord): Promise<void>;
  /** Must only transition attempts still in `running`. */
  finishAttempt(record: AttemptFinishRecord): Promise<void>;
  timeoutRunningAttempts(runId: string, finishedAt: Date): Promise<number>;
  /** Must only transition runs still in `running`. */
  finishRun(record: RunFinishRecord): Promise<void>;
}

// --- Recorder ---------------------------------------------------------------

export interface AttemptMeta {
  source: string;
  role: string | null;
  stage: AttemptStage;
}

export interface AttemptHandle {
  readonly id: string;
  setCounters(counters: Partial<AttemptCounters>): void;
  setPhase(phase: AttemptPhase): void;
}

export interface RunSummary {
  runId: string;
  status: RunStatus;
  reason: string;
  totals: RunTotals;
  telemetryEnabled: boolean;
}

interface AttemptState {
  status: AttemptStatus;
  stage: AttemptStage;
  counters: AttemptCounters;
}

export interface RunRecorderOptions {
  workflow: WorkflowName;
  country: string | null;
  store: RunTelemetryStore;
  env?: NodeJS.ProcessEnv;
  heartbeatIntervalMs?: number;
  drainTimeoutMs?: number;
  /**
   * P3: runs on every heartbeat tick, alongside the run's own heartbeat.
   * A callback (rather than importing the lease module here) keeps
   * observability from depending on coordination — and means a failing
   * lease refresh can never interfere with telemetry. Must not throw.
   */
  onHeartbeat?: (runId: string) => void;
}

export class RunRecorder {
  readonly runId = randomUUID();
  private readonly attempts = new Map<string, AttemptState>();
  private queue: Promise<void> = Promise.resolve();
  private consecutiveFailures = 0;
  private disabledBy: string | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private summary: RunSummary | null = null;

  private constructor(
    private readonly store: RunTelemetryStore | null,
    private readonly drainTimeoutMs: number
  ) {}

  /** Classifies in memory but never writes — for callers without telemetry. */
  static disabled(): RunRecorder {
    return new RunRecorder(null, 0);
  }

  /** Never throws; a store that fails or hangs only disables telemetry. */
  static async start(options: RunRecorderOptions): Promise<RunRecorder> {
    const recorder = new RunRecorder(options.store, options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS);
    const record: RunStartRecord = {
      id: recorder.runId,
      workflow: options.workflow,
      country: options.country,
      startedAt: new Date(),
      environment: detectRunEnvironment(options.env ?? process.env)
    };
    recorder.enqueue("insertRun", (store) => store.insertRun(record), true);
    await recorder.drain(Math.min(recorder.drainTimeoutMs, TELEMETRY_QUERY_TIMEOUT_MS));
    const onHeartbeat = options.onHeartbeat;
    recorder.heartbeat = setInterval(
      () => {
        recorder.enqueue("heartbeatRun", (store) => store.heartbeatRun(recorder.runId));
        if (onHeartbeat) {
          try {
            onHeartbeat(recorder.runId);
          } catch {
            // Never let a coordination failure disturb telemetry.
          }
        }
      },
      options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
    );
    recorder.heartbeat.unref();
    return recorder;
  }

  get telemetryEnabled(): boolean {
    return this.store !== null && this.disabledBy === null;
  }

  statusOf(attemptId: string): AttemptStatus | undefined {
    return this.attempts.get(attemptId)?.status;
  }

  async trackAttempt<T>(meta: AttemptMeta, work: (attempt: AttemptHandle) => Promise<T>): Promise<T> {
    const id = randomUUID();
    const startedAt = new Date();
    const writable = this.summary === null;
    const tally = emptySignalTally();
    const state: AttemptState = {
      status: "running",
      stage: meta.stage,
      counters: { received: null, valid: null, filtered: null, new: null, duplicate: null, failed: null }
    };
    let phase: AttemptPhase = "fetch";
    const handle: AttemptHandle = {
      id,
      setCounters: (counters) => Object.assign(state.counters, counters),
      setPhase: (next) => { phase = next; }
    };
    this.attempts.set(id, state);
    if (writable) {
      this.enqueue("insertAttempt", (store) =>
        store.insertAttempt({ id, runId: this.runId, source: meta.source, role: meta.role, stage: meta.stage, startedAt })
      );
    }

    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await attemptContext.run(tally, () => work(handle)) };
    } catch (error) {
      outcome = { ok: false, error };
    }

    // Already closed as `timeout` by finish(): a late straggler keeps its
    // terminal state and writes nothing (OBS-006).
    if (state.status === "running") {
      const failure = outcome.ok ? undefined : { error: outcome.error };
      const { status, reason } = classifyAttempt({ stage: meta.stage, counters: state.counters, signals: tally, phase, failure });
      state.status = status;
      if (writable && this.summary === null) {
        const finishedAt = new Date();
        const record: AttemptFinishRecord = {
          id, status, reason,
          errorClass: failure ? errorClassOf(failure.error) : null,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          counters: { ...state.counters },
          requests: tally.request
        };
        this.enqueue("finishAttempt", (store) => store.finishAttempt(record));
      }
    }

    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  async finish(options: { fatal?: boolean } = {}): Promise<RunSummary> {
    if (this.summary) return this.summary;
    if (this.heartbeat) clearInterval(this.heartbeat);
    const finishedAt = new Date();
    let stillRunning = 0;
    const totals: RunTotals = { attempts: this.attempts.size, received: 0, new: 0, duplicate: 0 };
    for (const state of this.attempts.values()) {
      if (state.status === "running") {
        state.status = "timeout";
        stillRunning++;
      }
      if (state.stage === "listing") {
        totals.received += state.counters.received ?? 0;
        totals.new += state.counters.new ?? 0;
        totals.duplicate += state.counters.duplicate ?? 0;
      }
    }
    const { status, reason } = options.fatal
      ? { status: "failed" as const, reason: "unhandled_error" }
      : deriveRunStatus([...this.attempts.values()].map((state) => state.status), { deadlineExceeded: stillRunning > 0 });

    if (stillRunning > 0) this.enqueue("timeoutRunningAttempts", (store) => store.timeoutRunningAttempts(this.runId, finishedAt));
    this.enqueue("finishRun", (store) => store.finishRun({ id: this.runId, status, reason, finishedAt, totals }));
    this.summary = { runId: this.runId, status, reason, totals, telemetryEnabled: this.telemetryEnabled };
    await this.drain(this.drainTimeoutMs);
    this.summary.telemetryEnabled = this.telemetryEnabled;
    return this.summary;
  }

  private enqueue(label: string, operation: (store: RunTelemetryStore) => Promise<unknown>, critical = false): void {
    const store = this.store;
    if (!store || this.disabledBy) return;
    this.queue = this.queue.then(async () => {
      if (this.disabledBy) return;
      try {
        await operation(store);
        this.consecutiveFailures = 0;
      } catch (error) {
        this.consecutiveFailures++;
        if (critical || this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) this.disable(label, error);
      }
    });
  }

  private disable(label: string, error: unknown): void {
    this.disabledBy = label;
    const code = typeof (error as { code?: unknown })?.code === "string" ? ` ${(error as { code: string }).code}` : "";
    console.warn(
      `⚠️ [RunTelemetry] Telemetría desactivada para esta ejecución (${label}: ${errorClassOf(error)}${code}). Las vacantes y la cadencia no se ven afectadas.`
    );
  }

  private async drain(timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      this.queue,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref();
      })
    ]);
    clearTimeout(timer);
  }
}

/** Runs a telemetry maintenance call (reconcile/purge) without ever throwing. */
export async function runTelemetrySafely<T>(label: string, operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.warn(`⚠️ [RunTelemetry] ${label} falló (${errorClassOf(error)}); se continúa sin afectar vacantes.`);
    return fallback;
  }
}
