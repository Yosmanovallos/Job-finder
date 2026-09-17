import { pool } from "../db/client.js";
import { reportSourceSignal } from "../observability/run-telemetry.js";
import { BUDGET_ESTIMATES, hasBudget, isCancelled, sleepWithContext, type FetchContext } from "./fetch-context.js";
import { circuitEffectOf } from "./circuit-policy.js";
import {
  classifyFetchResult,
  failedResult,
  liftJobArray,
  NO_COUNTERS,
  type SourceFetchResult
} from "../sources/fetch-result.js";
import {
  DEFAULT_SOURCE_POLICY,
  resolvePolicy,
  type SourcePolicy,
  type SourceStage
} from "../sources/source-policy.js";

/**
 * Thrown by a scraper when a source returns a definitive deny (401/403) —
 * distinct from a transient failure (429/5xx/network error). executeWithResilience
 * fails fast on this instead of spending its retry budget: retrying a "no"
 * wastes requests against a source that already answered, with no chance of
 * a different outcome on attempt 2 or 3.
 */
export class FetchBlockedError extends Error {
  constructor(label: string, statusCode: number) {
    super(`[${label}] Blocked: HTTP ${statusCode} (no retry — this is a deny, not a hiccup)`);
    this.name = "FetchBlockedError";
  }
}

// Kept as the module-level default so that nothing changes for a source with
// no declared policy. P4 (SRC-004) makes the effective values resolvable per
// (source, stage) instead of applying these two identically to both stages.
const FAILURE_THRESHOLD = DEFAULT_SOURCE_POLICY.failureThreshold;
// Persisted (not per-process) circuit breaker: each GitHub Actions tick is a
// fresh Node process, so an in-memory breaker forgets a source was blocked
// the instant that process exits — the next tick, 15 min later, retries from
// zero. 30 min covers roughly two tick cycles: long enough that a source
// which just took 3 real denials isn't hammered again immediately, short
// enough that a transient block self-heals the same day without a manual
// reset.
const DEGRADED_TIMEOUT_MS = DEFAULT_SOURCE_POLICY.openForMs;

export async function isSourceDegraded(sourceName: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT open_until FROM source_circuit_state WHERE source_name = $1`,
    [sourceName]
  );
  const row = result.rows[0];
  if (!row || !row.open_until) return false;

  if (new Date(row.open_until).getTime() > Date.now()) {
    return true;
  }

  console.log(
    `🟢 [Circuit Breaker] ${sourceName}: El período de recuperación finalizó. Reactivando fuente.`
  );
  await pool.query(
    `UPDATE source_circuit_state SET failures = 0, open_until = NULL WHERE source_name = $1`,
    [sourceName]
  );
  return false;
}

export async function recordFailure(sourceName: string, policy?: SourcePolicy): Promise<void> {
  const threshold = policy?.failureThreshold ?? FAILURE_THRESHOLD;
  const openForMs = policy?.openForMs ?? DEGRADED_TIMEOUT_MS;
  const result = await pool.query(
    `INSERT INTO source_circuit_state (source_name, failures)
     VALUES ($1, 1)
     ON CONFLICT (source_name) DO UPDATE SET failures = source_circuit_state.failures + 1
     RETURNING failures`,
    [sourceName]
  );
  const failures = result.rows[0].failures;
  console.warn(
    `⚠️ [Circuit Breaker] ${sourceName}: Registrado fallo ${failures}/${threshold}.`
  );

  if (failures >= threshold) {
    const openUntil = new Date(Date.now() + openForMs);
    await pool.query(`UPDATE source_circuit_state SET open_until = $2 WHERE source_name = $1`, [
      sourceName,
      openUntil
    ]);
    console.error(
      `🚨 [Circuit Breaker] ${sourceName}: ${threshold} fallos consecutivos. Marcado como DEGRADADO hasta ${openUntil.toLocaleTimeString()} (persiste entre ticks).`
    );
  }
}

export async function recordSuccess(sourceName: string): Promise<void> {
  await pool.query(
    `UPDATE source_circuit_state SET failures = 0, open_until = NULL WHERE source_name = $1`,
    [sourceName]
  );
}

/**
 * Applies an outcome to the circuit (P4, spec SRC-003).
 *
 * The third effect — `neutral` — is the fix. Before P4 there were only two,
 * and `executeWithResilience` chose between them with `Array.isArray`, so a
 * detail that came back `null` (turned into `[]` by the call site) landed on
 * `recordSuccess` and wiped the failure counter. The live table proved the
 * consequence: not one `-detail` row existed in `source_circuit_state`, while
 * Computrabajo burned 102 detail pages for 0 results over 7 days.
 */
async function applyCircuitEffect(
  circuitKey: string,
  result: SourceFetchResult<unknown>,
  policy: SourcePolicy
): Promise<void> {
  switch (circuitEffectOf(result.outcome)) {
    case "reset":
      await recordSuccess(circuitKey);
      return;
    case "increment":
      await recordFailure(circuitKey, policy);
      return;
    case "neutral":
      // Deliberately nothing: this attempt taught us nothing about the
      // source's health, so it must neither forgive past failures nor
      // invent a new one.
      return;
  }
}

/** Maps an outcome onto the P2 signal vocabulary, so classification agrees. */
function reportOutcomeSignal(result: SourceFetchResult<unknown>): void {
  switch (result.outcome) {
    case "blocked":
      reportSourceSignal("blocked");
      return;
    case "timeout":
      reportSourceSignal("deadline_exceeded");
      return;
    case "misconfigured":
      reportSourceSignal("misconfigured");
      return;
    case "rate_limited":
    case "quota_exhausted":
    case "schema_changed":
    case "failed":
      reportSourceSignal("retries_exhausted");
      return;
    default:
      return;
  }
}

/**
 * Result-returning sibling of `executeWithResilience` (P4).
 *
 * Everything the old wrapper flattened into `[]` — an open circuit, a deny,
 * an exhausted retry budget, a missed deadline — now comes back as a stated
 * outcome. Nothing about the retry/backoff behavior changes; what changes is
 * that the caller is told which of those happened.
 */
export async function executeWithResilienceResult<T>(
  sourceName: string,
  stage: SourceStage,
  fetcher: () => Promise<SourceFetchResult<T>>,
  maxRetries: number = 3,
  ctx?: FetchContext
): Promise<SourceFetchResult<T>> {
  const policy = resolvePolicy(sourceName, stage);
  const circuitKey = sourceName;

  if (isCancelled(ctx)) {
    reportSourceSignal("deadline_exceeded");
    return failedResult<T>("timeout", { class: "AbortError" }, "deadline_exceeded");
  }

  if (await isSourceDegraded(circuitKey)) {
    console.warn(
      `[ResilientEngine] ${sourceName} está en estado DEGRADADO (Circuit Breaker ABIERTO). Omitiendo ejecución sin detener el sistema.`
    );
    reportSourceSignal("circuit_open");
    // Not `empty`: nothing was even asked. Distinguishing the two is the
    // entire point of the phase.
    return failedResult<T>("failed", { class: "CircuitOpen" }, "circuit_open");
  }

  const delays = [1000, 3000, 9000];
  let last: SourceFetchResult<T> | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    reportSourceSignal("request");
    let result: SourceFetchResult<T>;
    try {
      result = await fetcher();
    } catch (err: unknown) {
      result = classifyFetchResult<T>(err, NO_COUNTERS);
      console.warn(
        `⚠️ [ResilientEngine] ${sourceName} - Intento ${attempt}/${maxRetries} falló: ${result.error?.class ?? "error"}`
      );
    }
    last = result;

    // A definitive deny is answered, not retried: attempt 2 and 3 cannot
    // produce a different answer, they only spend requests against a source
    // that already said no.
    if (result.outcome === "blocked") {
      console.warn(`🚫 [ResilientEngine] ${sourceName}: deny definitivo — no se reintenta.`);
      reportOutcomeSignal(result);
      await applyCircuitEffect(circuitKey, result, policy);
      return result;
    }

    // Anything that is not a transport failure is the final answer, including
    // `empty` — "there is nothing there" is a real answer, not a hiccup to
    // retry three times.
    if (circuitEffectOf(result.outcome) !== "increment") {
      reportOutcomeSignal(result);
      await applyCircuitEffect(circuitKey, result, policy);
      return result;
    }

    if (attempt < maxRetries) {
      // P4 (SRC-005): a source that sent Retry-After gets that wait, capped
      // by policy and then by whatever the tick has left. Without the header
      // this is exactly the pre-P4 backoff.
      const requested = result.error?.retryAfterMs;
      const delay =
        requested !== undefined
          ? Math.min(requested, policy.maxRetryAfterMs)
          : delays[attempt - 1] || 3000;

      if (!hasBudget(ctx, delay + BUDGET_ESTIMATES.retry)) {
        console.warn(
          `⏱️ [ResilientEngine] ${sourceName}: sin presupuesto para el reintento ${attempt + 1}/${maxRetries} — se abandona sin dormir.`
        );
        reportSourceSignal("deadline_exceeded");
        const abandoned = failedResult<T>("timeout", { class: "AbortError" }, "deadline_exceeded", result.counters);
        await applyCircuitEffect(circuitKey, abandoned, policy);
        return abandoned;
      }
      console.log(`⏳ [ResilientEngine] Reintentando ${sourceName} en ${delay / 1000}s...`);
      await sleepWithContext(delay, ctx);
      if (isCancelled(ctx)) {
        reportSourceSignal("deadline_exceeded");
        const abandoned = failedResult<T>("timeout", { class: "AbortError" }, "deadline_exceeded", result.counters);
        await applyCircuitEffect(circuitKey, abandoned, policy);
        return abandoned;
      }
    }
  }

  reportSourceSignal("retries_exhausted");
  const exhausted =
    last ?? failedResult<T>("failed", { class: "Error" }, "retries_exhausted");
  await applyCircuitEffect(circuitKey, exhausted, policy);
  return { ...exhausted, reason: "retries_exhausted" };
}

/**
 * Resilient execution wrapper around scraper functions with exponential backoff (1s, 3s, 9s)
 * and Circuit Breaker isolation. Generic over T (not just Job) — reused as-is
 * by the reputation batch pipeline (docs/COMPANY-REPUTATION-PLAN.md, Fase R1),
 * which shares this same source_circuit_state table and retry/backoff logic
 * but fetches ReputationScoreInput rows, not Job rows.
 *
 * P4: now a thin shim over `executeWithResilienceResult`. The signature is
 * unchanged on purpose — the reputation pipeline and the 16 unmigrated
 * adapters must not have to know this phase happened (spec SRC-002).
 *
 * The one behavior that necessarily differs is the one the phase exists to
 * fix: an empty array no longer resets the circuit's failure counter, because
 * `liftJobArray([])` is `empty`, and `empty` is neutral (SRC-003).
 */
export async function executeWithResilience<T>(
  sourceName: string,
  fetcher: () => Promise<T[]>,
  maxRetries: number = 3,
  ctx?: FetchContext
): Promise<T[]> {
  // Stage is inferred from the circuit-key convention already used in
  // production data (`X` for listing, `X-detail` for detail), so existing
  // call sites keep addressing the same rows they always did.
  const stage: SourceStage = sourceName.endsWith("-detail") ? "detail" : "listing";
  const result = await executeWithResilienceResult<T>(
    sourceName,
    stage,
    async () => {
      const results = await fetcher();
      if (!Array.isArray(results)) {
        throw new Error("Resultado inválido (esperado Array)");
      }
      return liftJobArray<T>(results);
    },
    maxRetries,
    ctx
  );
  return result.data;
}

export type { SourceFetchResult };
