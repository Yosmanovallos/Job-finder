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
import { anonymizeAiUsage } from "../../db/resume-studio-ai-repository.js";
import { readJsonBodyCapped } from "../http-helpers.js";
import { CV_FILE_MESSAGES, CvFileError } from "../../resume-studio/cv-file-types.js";

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

async function readBody(req: http.IncomingMessage, res: http.ServerResponse, maxBytes = RESUME_BODY_MAX_BYTES): Promise<{ ok: true; value: unknown } | null> {
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    json(res, 415, { error: "Formato no soportado" });
    return null;
  }
  const body = await readJsonBodyCapped(req, maxBytes, 10000);
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
  const route = pathname.slice("/api/resume".length) || "/";
  // «Mis postulaciones» (R4b) has its own, larger bucket: moving cards on the
  // board must not eat the editor's save budget.
  const isApplications = route === "/applications" || route.startsWith("/applications/");
  if (isWrite && !isApplications && !checkRateLimit(`resume:${userId}`, WRITE_LIMIT, WRITE_WINDOW_MS, "resume-write")) {
    return json(res, 429, { error: "Demasiados cambios seguidos. Intenta en unos minutos." }, { "Retry-After": "600" });
  }
  if (isWrite && isApplications && !checkRateLimit(`resume-applications:${userId}`, APPLICATIONS_LIMIT, WRITE_WINDOW_MS, "resume-applications")) {
    return json(res, 429, { error: "Demasiados cambios seguidos. Intenta en unos minutos." }, { "Retry-After": "600" });
  }

  try {
    // CV file → plain text (R2, doc 06 §5). Nothing is stored: the file
    // lives in memory for this request and only its text goes back.
    if (route === "/import") {
      if (method !== "POST") return json(res, 405, { error: "Método no permitido" });
      if (!checkRateLimit(`resume-import:${userId}`, IMPORT_LIMIT, WRITE_WINDOW_MS, "resume-import")) {
        return json(res, 429, { error: "Subiste muchos archivos seguidos. Intenta en unos minutos." }, { "Retry-After": "600" });
      }
      const { readBodyCapped, extractFilePart, multipartBoundary, parseCvFile, CV_UPLOAD_BODY_MAX_BYTES } = await import("../../resume-studio/cv-file-import.js");
      const boundary = multipartBoundary(req.headers["content-type"]);
      if (!boundary) return json(res, 415, { error: "Envía el archivo como formulario (multipart/form-data)." });
      if (!consentStatus(await getConsentState(userId)).required) {
        req.resume();
        return json(res, 403, { error: "Primero acepta la autorización y los términos.", code: "consent_required" });
      }
      const body = await readBodyCapped(req, CV_UPLOAD_BODY_MAX_BYTES);
      if (!body.ok) {
        const status = body.code === "too_large" ? 413 : 400;
        json(res, status, { error: CV_FILE_MESSAGES[body.code], code: body.code }, { Connection: "close" });
        return;
      }
      const file = extractFilePart(body.body, boundary);
      if (!file || file.length === 0) return json(res, 400, { error: "No llegó ningún archivo.", code: "malformed" });
      try {
        const result = await parseCvFile(file);
        // The text is the user's own CV, but it is still untrusted input for
        // R3's prompts (doc 08 «inyección»): flagged as such.
        return json(res, 200, { ...result, untrusted: true });
      } catch (error) {
        const code = error instanceof CvFileError ? error.code : "malformed";
        const status = code === "busy" ? 429 : code === "too_large" ? 413 : code === "unsupported_type" ? 415 : 422;
        return json(res, status, { error: CV_FILE_MESSAGES[code], code }, code === "busy" ? { "Retry-After": "5" } : {});
      }
    }

    // Vacancy by link (R2, doc 11 §5.3) ---------------------------------
    // Reading a job link involves no CV data, so no consent is needed; a
    // session and a per-user budget are (each link may cost one outside GET).
    if (route === "/job-link" || route === "/job-link/paste") {
      if (method !== "POST") return json(res, 405, { error: "Método no permitido" });
      if (!checkRateLimit(`resume-job-link:${userId}`, JOB_LINK_LIMIT, WRITE_WINDOW_MS, "resume-job-link")) {
        return json(res, 429, { error: "Revisaste muchos links seguidos. Intenta en unos minutos." }, { "Retry-After": "600" });
      }
      const body = await readBody(req, res);
      if (!body) return;
      const value = (body.value ?? {}) as Record<string, unknown>;
      const { jobLinkDeps } = await import("../../resume-studio/job-link/deps.js");
      const { resolveJobLink, resolvePastedJob } = await import("../../resume-studio/job-link/resolve.js");
      if (route === "/job-link") {
        if (typeof value.url !== "string" || !value.url.trim() || value.url.length > 2000) return json(res, 400, { error: "Pega el link de la vacante." });
        const result = await resolveJobLink(value.url, jobLinkDeps());
        if (result.status === "invalid") {
          return json(res, 400, { ...result, error: result.reason === "not_public" ? "Ese link no es una página pública." : "Ese link no es válido." });
        }
        return json(res, 200, result);
      }
      const text = (field: string) => (typeof value[field] === "string" ? (value[field] as string) : null);
      const result = await resolvePastedJob({ url: text("url"), title: text("title") ?? "", company: text("company"), text: text("text") ?? "" }, jobLinkDeps());
      if (result.status === "invalid") {
        const error = result.reason === "title_required" ? "Escribe el cargo de la vacante." : result.reason === "invalid_url" ? "Ese link no es válido." : "Pega la descripción completa de la vacante.";
        return json(res, 400, { ...result, error });
      }
      return json(res, 200, result);
    }

    // Passes, checkout and the clean DOCX (R4, doc 06 §7) -----------------
    if (route === "/pass" || route === "/checkout" || route === "/checkout/confirm" || route === "/download/docx") {
      if (route !== "/pass" && !checkRateLimit(`resume-pay${route}:${userId}`, PAY_LIMIT, WRITE_WINDOW_MS, "resume-pay")) {
        return json(res, 429, { error: "Muchas solicitudes seguidas. Intenta en unos minutos." }, { "Retry-After": "600" });
      }
      const pass = await import("./resume-pass.js");
      const requireConsent = async (): Promise<boolean> => {
        if (consentStatus(await getConsentState(userId)).required) return true;
        json(res, 403, { error: "Primero acepta la autorización y los términos.", code: "consent_required" });
        return false;
      };
      const readLimited = () => readBody(req, res, route === "/download/docx" ? RESUME_BODY_MAX_BYTES + 1024 : 4096);
      return pass.handleResumePass(res, route, method, userId, readLimited, requireConsent, json);
    }

    // AI (R3): CV → JSON and the card agent (doc 11 §5.2) ------------------
    if (route === "/extract" || route === "/tailor/start" || route === "/tailor/card") {
      if (method !== "POST") return json(res, 405, { error: "Método no permitido" });
      const limit = route === "/tailor/card" ? AI_CARD_LIMIT : AI_START_LIMIT;
      if (!checkRateLimit(`resume-ai${route}:${userId}`, limit, WRITE_WINDOW_MS, "resume-ai")) {
        return json(res, 429, { error: "Muchas solicitudes seguidas. Intenta en unos minutos." }, { "Retry-After": "600" });
      }
      const body = await readBody(req, res, AI_BODY_MAX_BYTES);
      if (!body) return;
      // The CV goes to an AI provider: the two required authorizations first.
      if (!consentStatus(await getConsentState(userId)).required) {
        return json(res, 403, { error: "Primero acepta la autorización y los términos.", code: "consent_required" });
      }
      const ai = await import("./resume-ai.js");
      return ai.handleResumeAi(res, route, userId, body.value, json);
    }

    // «Mis postulaciones» (R4b, doc 11 §5.1): free, no pass ---------------
    if (isApplications) {
      const applications = await import("./resume-applications.js");
      const requireStorageConsent = async (): Promise<boolean> => {
        const status = consentStatus(await getConsentState(userId));
        if (!status.required) {
          json(res, 403, { error: "Primero acepta la autorización y los términos.", code: "consent_required" });
          return false;
        }
        if (!status.storage) {
          json(res, 403, { error: "Activa «Guardar mi hoja de vida en mi cuenta» para guardar tus postulaciones.", code: "storage_consent_required" });
          return false;
        }
        return true;
      };
      return applications.handleResumeApplications(res, route, method, userId, () => readBody(req, res), requireStorageConsent, json);
    }

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
        await anonymizeAiUsage(userId);
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
      const deleted = await deleteAllResumeData(userId);
      await anonymizeAiUsage(userId);
      return json(res, 200, { deleted });
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

const IMPORT_LIMIT = 10;
const AI_START_LIMIT = 20;
const AI_CARD_LIMIT = 80;
// CV facts (≤ 64 KB) + vacancy text (≤ 20.000 chars) + the card's own fields.
const AI_BODY_MAX_BYTES = 160 * 1024;
const JOB_LINK_LIMIT = 30;
const PAY_LIMIT = 20;
const APPLICATIONS_LIMIT = 120;

const UUID_IN_PATH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" ? code : error instanceof Error ? error.name : "unknown";
}

/** Field paths only — never the submitted values. */
function issuesOf(error: { issues: { path: (string | number)[]; message: string }[] }): { path: string; message: string }[] {
  return error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}
