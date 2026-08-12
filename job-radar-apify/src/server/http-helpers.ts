import type http from "node:http";
import { checkRateLimit, recordSuspiciousEvent } from "../lib/security-monitor.js";

/**
 * Fase 5 de docs/RESUME-STUDIO-PLAN.md — extraído de `server.ts` (donde
 * vivían como funciones locales desde Fase 7 de CV-GENERATION-PLAN.md)
 * para que `server/routes/resume-studio.ts` los pueda reusar sin crear un
 * import circular (`server.ts` monta ese módulo de rutas, así que ese
 * módulo no puede a su vez importar de `server.ts`). Comportamiento
 * idéntico al de siempre — esto es mover código, no cambiarlo.
 */

export function respondToUnexpectedError(
  res: http.ServerResponse,
  err: any,
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
// triggering a scrape, connecting a BYOK credential) — a much lower bar
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

// Fase 7 (docs/CV-GENERATION-PLAN.md §9.5): reads a JSON body with a hard
// byte cap, WITHOUT `req.destroy()` mid-stream — that was tried for the
// upload endpoint (parse-upload.ts) and reset the raw socket before a
// clean 4xx could flush, so a client saw a connection reset instead of a
// real error. Same fix here: once over cap, stop appending but let the
// stream drain naturally, then respond normally.
export function readJsonBodyCapped(
  req: http.IncomingMessage,
  maxBytes: number
): Promise<{ ok: true; value: any } | { ok: false }> {
  return new Promise((resolve) => {
    let bytes = 0;
    let bodyText = "";
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        tooLarge = true;
        return;
      }
      bodyText += chunk.toString();
    });
    req.on("end", () => {
      if (tooLarge) {
        resolve({ ok: false });
        return;
      }
      try {
        resolve({ ok: true, value: JSON.parse(bodyText || "{}") });
      } catch {
        resolve({ ok: false });
      }
    });
    req.on("error", () => resolve({ ok: false }));
  });
}
