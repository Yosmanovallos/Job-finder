import type { IncomingMessage, ServerResponse } from "node:http";
import { getRunDetail, listRuns, toPublicRun } from "../../db/run-repository.js";
import { decodeRunCursor, errorClassOf, isUuid, type RunCursor } from "../../observability/run-telemetry.js";
import { checkOpsAdminAuthorization } from "../ops-auth.js";

// P2 — run observability surfaces (openspec p2-run-observability).
// GET /api/runs keeps its historical `{runs: [{id, name, count}], count}`
// shape with additive fields; /api/admin/runs[/:id] is operator-only.

export interface RunsRouteContext {
  pathname: string;
  method: string;
  parsedUrl: URL;
}

const PUBLIC_DEFAULT_LIMIT = 20;
const RUNS_MAX_LIMIT = 50;
const ATTEMPTS_DEFAULT_LIMIT = 100;
const ATTEMPTS_MAX_LIMIT = 200;
const ADMIN_PREFIX = "/api/admin/runs/";

export function isRunsRoute(pathname: string): boolean {
  return pathname === "/api/runs" || pathname === "/api/admin/runs" || pathname.startsWith(ADMIN_PREFIX);
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function clampLimit(raw: string | null, fallback: number, max: number): number {
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

function readCursor(params: URLSearchParams, name: string): { ok: true; cursor: RunCursor | null } | { ok: false } {
  const raw = params.get(name);
  if (raw === null) return { ok: true, cursor: null };
  const cursor = decodeRunCursor(raw);
  return cursor ? { ok: true, cursor } : { ok: false };
}

// A failed read is never presented as an empty history (OBS-008).
function unavailable(res: ServerResponse, error: unknown): void {
  console.error(`[runs] Historial de ejecuciones no disponible (${errorClassOf(error)}).`);
  sendJson(res, 503, { error: "Historial de ejecuciones no disponible temporalmente." });
}

export async function handleRunsRoute(req: IncomingMessage, res: ServerResponse, ctx: RunsRouteContext): Promise<boolean> {
  const { pathname, method, parsedUrl } = ctx;
  if (method !== "GET" || !isRunsRoute(pathname)) return false;
  const params = parsedUrl.searchParams;

  if (pathname === "/api/runs") {
    const before = readCursor(params, "before");
    if (!before.ok) {
      sendJson(res, 400, { error: "Cursor inválido." });
      return true;
    }
    try {
      const page = await listRuns({
        limit: clampLimit(params.get("limit"), PUBLIC_DEFAULT_LIMIT, RUNS_MAX_LIMIT),
        before: before.cursor,
        includeTest: false
      });
      const runs = page.runs.map(toPublicRun);
      sendJson(res, 200, { runs, count: runs.length, nextCursor: page.nextCursor });
    } catch (error) {
      unavailable(res, error);
    }
    return true;
  }

  const auth = checkOpsAdminAuthorization(req.headers.authorization, process.env.OPS_ADMIN_TOKEN);
  if (auth === "disabled") {
    sendJson(res, 404, { error: "No encontrado." });
    return true;
  }
  if (auth === "unauthorized") {
    sendJson(res, 401, { error: "No autorizado." }, { "WWW-Authenticate": "Bearer" });
    return true;
  }

  if (pathname === "/api/admin/runs") {
    const before = readCursor(params, "before");
    if (!before.ok) {
      sendJson(res, 400, { error: "Cursor inválido." });
      return true;
    }
    try {
      const page = await listRuns({
        limit: clampLimit(params.get("limit"), PUBLIC_DEFAULT_LIMIT, RUNS_MAX_LIMIT),
        before: before.cursor,
        includeTest: params.get("includeTest") === "true"
      });
      sendJson(res, 200, { runs: page.runs, count: page.runs.length, nextCursor: page.nextCursor });
    } catch (error) {
      unavailable(res, error);
    }
    return true;
  }

  const id = pathname.slice(ADMIN_PREFIX.length);
  if (!isUuid(id)) {
    sendJson(res, 404, { error: "Ejecución no encontrada." });
    return true;
  }
  const after = readCursor(params, "after");
  if (!after.ok) {
    sendJson(res, 400, { error: "Cursor inválido." });
    return true;
  }
  try {
    const detail = await getRunDetail(id, {
      limit: clampLimit(params.get("limit"), ATTEMPTS_DEFAULT_LIMIT, ATTEMPTS_MAX_LIMIT),
      after: after.cursor
    });
    if (detail) sendJson(res, 200, detail);
    else sendJson(res, 404, { error: "Ejecución no encontrada." });
  } catch (error) {
    unavailable(res, error);
  }
  return true;
}
