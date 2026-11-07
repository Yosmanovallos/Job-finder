import type http from "node:http";
import { checkRateLimit, recordSuspiciousEvent } from "../lib/security-monitor.js";

/**
 * Helpers HTTP compartidos, extraídos de `server.ts` para que los módulos
 * de `server/routes/` los puedan reusar sin crear un import circular.
 */

export function respondToUnexpectedError(
  res: http.ServerResponse,
  err: unknown,
  routeLabel: string,
  fallbackMessage: string
): void {
  if (err instanceof SyntaxError) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "JSON inválido en el cuerpo de la solicitud" }));
    return;
  }
  console.error(`[${routeLabel}] Error inesperado:`, err);
  res.writeHead(500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: fallbackMessage }));
}

// For endpoints that write data or cost real money/quota to call (checkout,
// triggering a scrape) — a much lower bar
// than the general read cap.
export const SENSITIVE_RATE_LIMIT = 10;
export const SENSITIVE_RATE_WINDOW_MS = 60 * 1000;

export function checkSensitiveRateLimit(
  ip: string,
  res: http.ServerResponse,
  routeLabel: string
): boolean {
  if (checkRateLimit(ip, SENSITIVE_RATE_LIMIT, SENSITIVE_RATE_WINDOW_MS, "sensitive")) return true;
  recordSuspiciousEvent(ip, `rate-limit ${routeLabel}`);
  res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
  res.end(JSON.stringify({ error: "Demasiadas solicitudes — intenta de nuevo en un minuto." }));
  return false;
}

// Reads a JSON body with a hard byte cap, WITHOUT `req.destroy()`
// mid-stream — that was tried for an upload endpoint and reset the raw socket before a
// clean 4xx could flush, so a client saw a connection reset instead of a
// real error. Stop buffering on excess, abort or optional deadline and allow
// a clean error response while any remaining input drains.
export function readJsonBodyCapped(
  req: http.IncomingMessage,
  maxBytes: number,
  timeoutMs?: number
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  return new Promise((resolve) => {
    let settled = false;
    let bytes = 0;
    let bodyText = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: { ok: true; value: unknown } | { ok: false }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      // Keep the once-error listener to absorb a late stream error after a timeout.
      req.off("aborted", onError);
      resolve(result);
    };
    const onError = () => finish({ ok: false });
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        finish({ ok: false });
        req.resume();
        return;
      }
      bodyText += chunk.toString();
    };
    const onEnd = () => {
      try {
        finish({ ok: true, value: JSON.parse(bodyText || "{}") });
      } catch {
        finish({ ok: false });
      }
    };
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    req.once("aborted", onError);
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        finish({ ok: false });
        req.resume();
      }, timeoutMs);
    }
  });
}
