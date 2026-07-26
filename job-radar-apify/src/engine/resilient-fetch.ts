import { Job } from "../sources/types.js";
import { pool } from "../db/client.js";

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
 * and Circuit Breaker isolation.
 */
export async function executeWithResilience(
  sourceName: string,
  fetcher: () => Promise<Job[]>,
  maxRetries: number = 3
): Promise<Job[]> {
  if (await isSourceDegraded(sourceName)) {
    console.warn(
      `[ResilientEngine] ${sourceName} está en estado DEGRADADO (Circuit Breaker ABIERTO). Omitiendo ejecución sin detener el sistema.`
    );
    return [];
  }

  const delays = [1000, 3000, 9000];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const results = await fetcher();
      if (Array.isArray(results)) {
        await recordSuccess(sourceName);
        return results;
      }
      throw new Error(`Resultado inválido (esperado Array de Jobs)`);
    } catch (err: any) {
      console.warn(
        `⚠️ [ResilientEngine] ${sourceName} - Intento ${attempt}/${maxRetries} falló: ${err?.message || err}`
      );
      if (err instanceof FetchBlockedError) {
        console.warn(`🚫 [ResilientEngine] ${sourceName}: deny definitivo — no se reintenta.`);
        await recordFailure(sourceName);
        return [];
      }
      if (attempt < maxRetries) {
        const delay = delays[attempt - 1] || 3000;
        console.log(`⏳ [ResilientEngine] Reintentando ${sourceName} en ${delay / 1000}s...`);
        await new Promise((res) => setTimeout(res, delay));
      } else {
        await recordFailure(sourceName);
      }
    }
  }

  return [];
}
