import { Job } from "../sources/types.js";

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

interface CircuitState {
  failures: number;
  openUntil: number;
}

const circuitStates: Record<string, CircuitState> = {};
const DEGRADED_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function isSourceDegraded(sourceName: string): boolean {
  const state = circuitStates[sourceName];
  if (!state) return false;
  if (Date.now() < state.openUntil) {
    return true;
  }
  // Reset after timeout expires
  if (state.openUntil > 0 && Date.now() >= state.openUntil) {
    console.log(
      `🟢 [Circuit Breaker] ${sourceName}: El período de recuperación finalizó. Reactivando fuente.`
    );
    circuitStates[sourceName] = { failures: 0, openUntil: 0 };
  }
  return false;
}

export function recordFailure(sourceName: string) {
  if (!circuitStates[sourceName]) {
    circuitStates[sourceName] = { failures: 0, openUntil: 0 };
  }
  circuitStates[sourceName].failures++;
  const count = circuitStates[sourceName].failures;
  console.warn(`⚠️ [Circuit Breaker] ${sourceName}: Registrado fallo ${count}/3.`);

  if (count >= 3) {
    circuitStates[sourceName].openUntil = Date.now() + DEGRADED_TIMEOUT_MS;
    console.error(
      `🚨 [Circuit Breaker] ${sourceName}: 3 fallos consecutivos. Marcado como DEGRADADO por 5 minutos (hasta ${new Date(circuitStates[sourceName].openUntil).toLocaleTimeString()}).`
    );
  }
}

export function recordSuccess(sourceName: string) {
  if (circuitStates[sourceName] && circuitStates[sourceName].failures > 0) {
    console.log(
      `✅ [Circuit Breaker] ${sourceName}: Ejecución exitosa. Restableciendo contador de fallos.`
    );
    circuitStates[sourceName] = { failures: 0, openUntil: 0 };
  }
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
  if (isSourceDegraded(sourceName)) {
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
        recordSuccess(sourceName);
        return results;
      }
      throw new Error(`Resultado inválido (esperado Array de Jobs)`);
    } catch (err: any) {
      console.warn(
        `⚠️ [ResilientEngine] ${sourceName} - Intento ${attempt}/${maxRetries} falló: ${err?.message || err}`
      );
      if (err instanceof FetchBlockedError) {
        console.warn(`🚫 [ResilientEngine] ${sourceName}: deny definitivo — no se reintenta.`);
        recordFailure(sourceName);
        return [];
      }
      if (attempt < maxRetries) {
        const delay = delays[attempt - 1] || 3000;
        console.log(`⏳ [ResilientEngine] Reintentando ${sourceName} en ${delay / 1000}s...`);
        await new Promise((res) => setTimeout(res, delay));
      } else {
        recordFailure(sourceName);
      }
    }
  }

  return [];
}
