import { pool } from "../db/client.js";
import { reportSourceSignal } from "../observability/run-telemetry.js";
import { BUDGET_ESTIMATES, hasBudget, isCancelled, sleepWithContext, type FetchContext } from "./fetch-context.js";

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

const FAILURE_THRESHOLD = 3;
// Persisted (not per-process) circuit breaker: each GitHub Actions tick is a
// fresh Node process, so an in-memory breaker forgets a source was blocked
// the instant that process exits — the next tick, 15 min later, retries from
// zero. 30 min covers roughly two tick cycles: long enough that a source
// which just took 3 real denials isn't hammered again immediately, short
// enough that a transient block self-heals the same day without a manual
// reset.
const DEGRADED_TIMEOUT_MS = 30 * 60 * 1000;

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

export async function recordFailure(sourceName: string): Promise<void> {
  const result = await pool.query(
    `INSERT INTO source_circuit_state (source_name, failures)
     VALUES ($1, 1)
     ON CONFLICT (source_name) DO UPDATE SET failures = source_circuit_state.failures + 1
     RETURNING failures`,
    [sourceName]
  );
  const failures = result.rows[0].failures;
  console.warn(
    `⚠️ [Circuit Breaker] ${sourceName}: Registrado fallo ${failures}/${FAILURE_THRESHOLD}.`
  );

  if (failures >= FAILURE_THRESHOLD) {
    const openUntil = new Date(Date.now() + DEGRADED_TIMEOUT_MS);
    await pool.query(`UPDATE source_circuit_state SET open_until = $2 WHERE source_name = $1`, [
      sourceName,
      openUntil
    ]);
    console.error(
      `🚨 [Circuit Breaker] ${sourceName}: ${FAILURE_THRESHOLD} fallos consecutivos. Marcado como DEGRADADO hasta ${openUntil.toLocaleTimeString()} (persiste entre ticks).`
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
 * Resilient execution wrapper around scraper functions with exponential backoff (1s, 3s, 9s)
 * and Circuit Breaker isolation. Generic over T (not just Job) — reused as-is
 * by the reputation batch pipeline (docs/COMPANY-REPUTATION-PLAN.md, Fase R1),
 * which shares this same source_circuit_state table and retry/backoff logic
 * but fetches ReputationScoreInput rows, not Job rows.
 */
export async function executeWithResilience<T>(
  sourceName: string,
  fetcher: () => Promise<T[]>,
  maxRetries: number = 3,
  ctx?: FetchContext
): Promise<T[]> {
  // P3 (EXE-003): the deadline is checked BEFORE the circuit-breaker query,
  // so an expired tick doesn't even spend a round-trip to Postgres deciding
  // whether to start something it has no budget to finish. `ctx` is optional
  // — without it this behaves exactly as before, which is what lets the
  // reputation pipeline keep calling it unchanged.
  if (isCancelled(ctx)) {
    reportSourceSignal("deadline_exceeded");
    return [];
  }

  if (await isSourceDegraded(sourceName)) {
    console.warn(
      `[ResilientEngine] ${sourceName} está en estado DEGRADADO (Circuit Breaker ABIERTO). Omitiendo ejecución sin detener el sistema.`
    );
    // P2: the attempt learns this `[]` means "skipped", not "empty". Signals
    // are a no-op outside a tracked attempt (e.g. the reputation pipeline).
    reportSourceSignal("circuit_open");
    return [];
  }

  const delays = [1000, 3000, 9000];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      reportSourceSignal("request");
      const results = await fetcher();
      if (Array.isArray(results)) {
        await recordSuccess(sourceName);
        return results;
      }
      throw new Error(`Resultado inválido (esperado Array)`);
    } catch (err: any) {
      console.warn(
        `⚠️ [ResilientEngine] ${sourceName} - Intento ${attempt}/${maxRetries} falló: ${err?.message || err}`
      );
      if (err instanceof FetchBlockedError) {
        console.warn(`🚫 [ResilientEngine] ${sourceName}: deny definitivo — no se reintenta.`);
        reportSourceSignal("blocked");
        await recordFailure(sourceName);
        return [];
      }
      if (attempt < maxRetries) {
        const delay = delays[attempt - 1] || 3000;
        // P3 (EXE-004): don't start a retry the deadline can't cover, and
        // don't sleep through the deadline waiting to start one. Before this,
        // a 9s backoff could burn the tail of the budget only to fire a
        // request that was dead on arrival.
        if (!hasBudget(ctx, delay + BUDGET_ESTIMATES.retry)) {
          console.warn(
            `⏱️ [ResilientEngine] ${sourceName}: sin presupuesto para el reintento ${attempt + 1}/${maxRetries} — se abandona sin dormir.`
          );
          reportSourceSignal("deadline_exceeded");
          return [];
        }
        console.log(`⏳ [ResilientEngine] Reintentando ${sourceName} en ${delay / 1000}s...`);
        await sleepWithContext(delay, ctx);
        if (isCancelled(ctx)) {
          reportSourceSignal("deadline_exceeded");
          return [];
        }
      } else {
        reportSourceSignal("retries_exhausted");
        await recordFailure(sourceName);
      }
    }
  }

  return [];
}
