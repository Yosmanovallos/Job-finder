import { createHash } from "node:crypto";
import type http from "node:http";
import type { VerifiedSession } from "../../auth/verify-session.js";
import { checkRateLimit } from "../../lib/security-monitor.js";
import {
  CONSENT_ITEMS,
  RESUME_BODY_MAX_BYTES,
  RESUME_POLICY_VERSION,
  resumeInputSchema,
  type ConsentPurpose
} from "../../lib/resume-studio.js";
import {
  createResume,
  deleteAllResumeData,
  deleteResume,
  exportResumeData,
  getConsentState,
  getResume,
  listResumes,
  listResumeVersions,
  recordConsents,
  restoreResumeVersion,
  updateResume,
  ResumeLimitError,
  ResumeNothingToUndoError,
  ResumeStudioUnavailableError,
  ResumeVersionConflictError
} from "../../db/resume-studio-repository.js";
import { readJsonBodyCapped } from "../http-helpers.js";

// AI Resume Studio R1 — /hoja-de-vida/* and /api/resume/* (ADR 0017).
// server.ts only imports this module when RESUME_STUDIO_ENABLED=true and the
// path matches; with the flag off both prefixes fall into the existing 404.
//
// Rules (doc 08 §3):
// - The user is always the one verifySession resolved from the JWT.
// - A resume id that isn't the caller's answers 404, same as one that
//   doesn't exist (no 403 that would confirm it exists).
// - Writes need the two required authorizations; saving on the server also
//   needs the optional «guardar en mi cuenta» one. Reading, exporting and
//   deleting never need consent (they are the holder's rights).
// - Responses are private, no-store; the pages are noindex. No CV content
//   is ever logged.

export interface ResumeRouteDeps {
  getSession: (req: http.IncomingMessage) => Promise<VerifiedSession | null>;
  loadIndexHtml: () => Promise<string>;
}

const WRITE_LIMIT = 60;
const WRITE_WINDOW_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isResumeStudioPath(pathname: string): boolean {
  return (
    pathname === "/hoja-de-vida" ||
    pathname.startsWith("/hoja-de-vida/") ||
    pathname === "/api/resume" ||
    pathname.startsWith("/api/resume/")
  );
}

export function consentTextHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const NO_STORE = "private, no-store";

function json(res: http.ServerResponse, status: number, body?: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": NO_STORE, ...extra });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage, res: http.ServerResponse): Promise<{ ok: true; value: unknown } | null> {
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    json(res, 415, { error: "Formato no soportado" });
    return null;
  }
  const body = await readJsonBodyCapped(req, RESUME_BODY_MAX_BYTES, 10000);
  if (!body.ok) {
    json(res, 413, { error: "Contenido demasiado grande o no válido" });
    return null;
  }
  return body;
}

function consentStatus(state: Partial<Record<ConsentPurpose, boolean>>) {
  const required = CONSENT_ITEMS.filter((item) => item.required).every((item) => state[item.purpose] === true);
  return { policyVersion: RESUME_POLICY_VERSION, granted: state, required, storage: state.cloud_storage === true };
}

export async function handleResumeRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  method: string,
  deps: ResumeRouteDeps
): Promise<void> {
  // ── Pages: the SPA shell, never indexed, never cached ─────────────────────
  if (!pathname.startsWith("/api/")) {
    if (method !== "GET" && method !== "HEAD") return json(res, 405, { error: "Método no permitido" });
    const html = await deps.loadIndexHtml();
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": NO_STORE,
      "X-Robots-Tag": "noindex, nofollow"
    });
    res.end(method === "HEAD" ? undefined : html);
    return;
  }

  const session = await deps.getSession(req);
  if (!session) return json(res, 401, { error: "Inicia sesión para usar tu hoja de vida." });
  const userId = session.id;
  const isWrite = method !== "GET" && method !== "HEAD";
  if (isWrite && !checkRateLimit(`resume:${userId}`, WRITE_LIMIT, WRITE_WINDOW_MS, "resume-write")) {
    return json(res, 429, { error: "Demasiados cambios seguidos. Intenta en unos minutos." }, { "Retry-After": "600" });
  }

  const route = pathname.slice("/api/resume".length) || "/";
  try {
    // Consent ------------------------------------------------------------
    if (route === "/consent") {
      if (method === "GET") {
        return json(res, 200, {
          ...consentStatus(await getConsentState(userId)),
          items: CONSENT_ITEMS.map(({ purpose, required, label, linkLabel, text }) => ({ purpose, required, label, linkLabel, text }))
        });
      }
      if (method !== "POST") return json(res, 405, { error: "Método no permitido" });
      const body = await readBody(req, res);
      if (!body) return;
      const value = body.value as { policyVersion?: unknown; decisions?: Record<string, unknown>; revoke?: unknown } | null;
      if (!value || value.policyVersion !== RESUME_POLICY_VERSION) {
        return json(res, 409, { error: "El texto de la autorización cambió. Recarga la página.", policyVersion: RESUME_POLICY_VERSION });
      }
      // Revocation (Ley 1581 art. 8; doc 06 §4 «revocar = fila nueva»): one
      // granted=false row per purpose, and the stored CV goes with it.
      if (value.revoke === true) {
        const { deletedResumes } = await recordConsents(
          userId,
          CONSENT_ITEMS.map((item) => ({ purpose: item.purpose, granted: false, textHash: consentTextHash(item.text) })),
          true
        );
        return json(res, 201, { ...consentStatus(await getConsentState(userId)), deletedResumes });
      }
      const decisions = value.decisions && typeof value.decisions === "object" ? value.decisions : {};
      for (const item of CONSENT_ITEMS) {
        const decision = decisions[item.purpose];
        if (typeof decision !== "boolean" || (item.required && !decision)) {
          return json(res, 400, { error: "Marca las autorizaciones obligatorias para continuar." });
        }
      }
      if (Object.keys(decisions).some((key) => !CONSENT_ITEMS.some((item) => item.purpose === key))) {
        return json(res, 400, { error: "Autorización desconocida." });
      }
      const { deletedResumes } = await recordConsents(
        userId,
        CONSENT_ITEMS.map((item) => ({ purpose: item.purpose, granted: decisions[item.purpose] === true, textHash: consentTextHash(item.text) })),
        // Without «guardar en mi cuenta» nothing stays on the server: a copy
        // saved under an earlier grant is removed now (the client keeps it
        // in this browser first).
        decisions.cloud_storage !== true
      );
      return json(res, 201, { ...consentStatus(await getConsentState(userId)), deletedResumes });
    }

    // Holder's rights: export and delete everything (no consent needed) ----
    if (route === "/export") {
      if (method !== "GET") return json(res, 405, { error: "Método no permitido" });
      return json(res, 200, await exportResumeData(userId), {
        "Content-Disposition": 'attachment; filename="mi-hoja-de-vida-buscotrabajo.json"'
      });
    }
    if (route === "/data") {
      if (method !== "DELETE") return json(res, 405, { error: "Método no permitido" });
      return json(res, 200, { deleted: await deleteAllResumeData(userId) });
    }

    // Resumes ------------------------------------------------------------
    const parts = route.split("/").filter(Boolean);
    if (parts[0] !== "resumes" || parts.length > 3) return json(res, 404, { error: "No encontrado" });
    const resumeId = parts[1];
    const action = parts[2];
    if (resumeId !== undefined && !UUID.test(resumeId)) return json(res, 404, { error: "Hoja de vida no encontrada" });

    const requireStorageConsent = async (): Promise<boolean> => {
      const status = consentStatus(await getConsentState(userId));
      if (!status.required) {
        json(res, 403, { error: "Primero acepta la autorización y los términos.", code: "consent_required" });
        return false;
      }
      if (!status.storage) {
        json(res, 403, { error: "Activa «Guardar mi hoja de vida en mi cuenta» para guardarla.", code: "storage_consent_required" });
        return false;
      }
      return true;
    };
    const notFound = () => json(res, 404, { error: "Hoja de vida no encontrada" });

    if (resumeId === undefined) {
      if (method === "GET") return json(res, 200, { resumes: await listResumes(userId) });
      if (method !== "POST") return json(res, 405, { error: "Método no permitido" });
      const body = await readBody(req, res);
      if (!body) return;
      const parsed = resumeInputSchema.safeParse(body.value);
      if (!parsed.success) return json(res, 400, { error: "Revisa los campos marcados.", issues: issuesOf(parsed.error) });
      if (!(await requireStorageConsent())) return;
      return json(res, 201, { resume: await createResume(userId, parsed.data) });
    }

    if (action === undefined) {
      if (method === "GET") {
        const resume = await getResume(userId, resumeId);
        return resume ? json(res, 200, { resume }) : notFound();
      }
      if (method === "DELETE") {
        return (await deleteResume(userId, resumeId)) ? json(res, 204) : notFound();
      }
      if (method !== "PUT") return json(res, 405, { error: "Método no permitido" });
      const body = await readBody(req, res);
      if (!body) return;
      const value = body.value as { expectedVersion?: unknown } | null;
      const expectedVersion = value?.expectedVersion;
      if (!Number.isInteger(expectedVersion)) return json(res, 400, { error: "Falta expectedVersion." });
      const { expectedVersion: _ignored, ...rest } = value as Record<string, unknown>;
      const parsed = resumeInputSchema.safeParse(rest);
      if (!parsed.success) return json(res, 400, { error: "Revisa los campos marcados.", issues: issuesOf(parsed.error) });
      if (!(await requireStorageConsent())) return;
      const resume = await updateResume(userId, resumeId, expectedVersion as number, parsed.data);
      return resume ? json(res, 200, { resume }) : notFound();
    }

    if (action === "versions") {
      if (method !== "GET") return json(res, 405, { error: "Método no permitido" });
      const versions = await listResumeVersions(userId, resumeId);
      return versions ? json(res, 200, { versions }) : notFound();
    }

    if (action === "restore" || action === "undo") {
      if (method !== "POST") return json(res, 405, { error: "Método no permitido" });
      const body = await readBody(req, res);
      if (!body) return;
      const value = (body.value ?? {}) as { versionNo?: unknown; expectedVersion?: unknown };
      if (action === "restore" && !Number.isInteger(value.versionNo)) return json(res, 400, { error: "Falta versionNo." });
      if (value.expectedVersion !== undefined && !Number.isInteger(value.expectedVersion)) {
        return json(res, 400, { error: "expectedVersion no válido." });
      }
      if (!(await requireStorageConsent())) return;
      const resume = await restoreResumeVersion(
        userId,
        resumeId,
        action === "undo" ? null : (value.versionNo as number),
        (value.expectedVersion as number | undefined) ?? null
      );
      return resume ? json(res, 200, { resume }) : notFound();
    }

    return json(res, 404, { error: "No encontrado" });
  } catch (error) {
    if (error instanceof ResumeStudioUnavailableError) return json(res, 503, { error: "La hoja de vida aún no está disponible." });
    if (error instanceof ResumeLimitError) return json(res, 409, { error: "Ya tienes una hoja de vida base. Edítala o bórrala.", code: "limit" });
    if (error instanceof ResumeVersionConflictError) {
      return json(res, 409, { error: "Guardaste cambios en otra pestaña. Recarga para ver la última versión.", code: "version_conflict", currentVersion: error.currentVersion });
    }
    if (error instanceof ResumeNothingToUndoError) return json(res, 409, { error: "No hay cambios para deshacer.", code: "nothing_to_undo" });
    // Never the error object itself: a pg error can echo parameter values.
    console.error(`[resume-studio] Error inesperado en ${method} ${route.replace(UUID_IN_PATH, ":id")}: ${errorCode(error)}`);
    return json(res, 500, { error: "No se pudo completar la acción. Intenta de nuevo." });
  }
}

const UUID_IN_PATH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" ? code : error instanceof Error ? error.name : "unknown";
}

/** Field paths only — never the submitted values. */
function issuesOf(error: { issues: { path: (string | number)[]; message: string }[] }): { path: string; message: string }[] {
  return error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}
