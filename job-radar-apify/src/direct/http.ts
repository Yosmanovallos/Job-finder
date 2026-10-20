import type { HttpGet, HttpRequestInit } from "./types.js";

/**
 * Bounded request for the public ATS APIs (ADR 0006 §9): identifiable
 * User-Agent, 15s timeout, 15 MB body cap, one retry on 429/5xx honoring a
 * short Retry-After. GET unless the caller passes a JSON body (POST, used
 * only for search endpoints that read nothing but the query). Never follows
 * the request anywhere the caller didn't ask.
 */
const USER_AGENT = "BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)";
const TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const MAX_RETRY_WAIT_MS = 10_000;

async function once(url: string, init: HttpRequestInit = {}): Promise<{ status: number; body: string; retryAfterMs: number | null }> {
  const post = init.json !== undefined;
  const response = await fetch(url, {
    method: post ? "POST" : "GET",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: init.accept ?? "application/json",
      ...(post ? { "Content-Type": "application/json" } : {})
    },
    body: post ? JSON.stringify(init.json) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error(`respuesta demasiado grande (${declared} bytes)`);
  }
  const body = await response.text();
  if (body.length > MAX_BODY_BYTES) throw new Error("respuesta demasiado grande");
  const retryAfter = Number(response.headers.get("retry-after"));
  return {
    status: response.status,
    body,
    retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null
  };
}

export const boundedGet: HttpGet = async (url, init) => {
  const first = await once(url, init);
  if (first.status !== 429 && first.status < 500) return first;
  await new Promise((resolve) => setTimeout(resolve, Math.min(first.retryAfterMs ?? 2_000, MAX_RETRY_WAIT_MS)));
  return once(url, init);
};
