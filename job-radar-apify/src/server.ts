import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  getJobsPage,
  getJobsLightCached,
  getJobById,
  getActiveCompanyNames,
  searchActiveCompanies,
  countCanonicalJobsByCompany,
  getRuns,
  maskLockedFields,
  updateUserName,
  updateUserPreferredRoles,
  getTransactionsForUser
} from "./db/job-repository.js";
import { markRoleForImmediateRescan } from "./db/scheduler-repository.js";
import { wasJobPurged } from "./db/indexing-repository.js";
import {
  getReputationForCompanies,
  resolveCompanyBySlug
} from "./db/company-reputation-repository.js";
import type { ReputationEntry } from "./db/company-reputation-repository.js";
import type { JobFilterParams } from "./lib/job-filters.js";
import { COMPANY_LOGO_DOMAINS, getCompanyLogoUrl } from "./data/company-logo-domains.js";
import { getCountryConfig } from "./countries/index.js";
import {
  escapeHtml,
  escapeJsonForScriptTag,
  isPubliclyDescribable,
  buildJobMeta,
  buildJobPosting,
  buildJobDescription,
  buildJobPath,
  buildJobsSitemapXml,
  buildSitemapIndexXml,
  isUuid,
  resolveCategorySlug,
  RETIRED_ROLE_SLUGS,
  buildCategoryMeta,
  buildCategoryPath,
  buildCategoryBreadcrumbList,
  buildCategoryItemList,
  buildCategoriesSitemapXml,
  resolveCompanyNameFromJobs,
  buildCompanyPath,
  buildCompanyMeta,
  buildCompanyOrganizationSchema,
  buildCompaniesItemList,
  SITE_URL
} from "./lib/job-seo.js";
import { verifySession } from "./auth/verify-session.js";
import { startPaymentCheckout } from "./payments/checkout.js";
import { handleWompiWebhook } from "./payments/webhook.js";
import {
  upsertCvProfileRawText,
  getCvProfileStatus,
  deleteCvProfile,
  getCvFacts
} from "./db/cv-profile-repository.js";
import {
  getGenerationForJob,
  getGenerationById,
  updateGenerationDocument,
  updateGenerationTemplate
} from "./db/cv-generation-repository.js";
import {
  parseSingleFileUpload,
  UploadTooLargeError,
  UploadInvalidError
} from "./cv/parse-upload.js";
import {
  extractTextFromUpload,
  UnsupportedFileTypeError,
  TextExtractionError,
  MAX_UPLOAD_BYTES
} from "./cv/extract-text.js";
import { extractAndStoreFacts } from "./cv/extract-facts.js";
import {
  getQuotaStatus,
  QuotaExceededError,
  GenerationConflictError,
  GenerationNotFoundError,
  MODEL_OPTION_CREDIT_COST,
  type ModelOption,
  type Tier as CvTier
} from "./cv/quota.js";
import {
  runCvGenerationPipeline,
  runCvRegenerationPipeline,
  FactualityRejectedError,
  ModelOptionNotAvailableError
} from "./cv/generation-pipeline.js";
import { InactivePromptError } from "./cv/model-gateway.js";
import { getDevGateway } from "./cv/gateway-instance.js";
import { CvDocumentSchema } from "./cv/cv-document-schema.js";
import { cvSectionRewriteV1, type CvSectionRewriteAction } from "./cv/prompts.js";
import { collectFactIds } from "./cv/factuality.js";
import { CV_TEMPLATES, DEFAULT_TEMPLATE_ID, getTemplate } from "./cv/templates/registry.js";
import { handleResumeStudioRoute } from "./server/routes/resume-studio.js";
import { RESUME_STUDIO_ENABLED } from "./config.js";
import { getProviderRegistry } from "./ai-gateway/registry-instance.js";
import { getCredentialResolver } from "./ai-gateway/credential-resolver-instance.js";
import type { RunContext } from "./cv/model-gateway.js";
import {
  respondToUnexpectedError,
  checkSensitiveRateLimit,
  readJsonBodyCapped
} from "./server/http-helpers.js";
// renderCvToPdf/renderCvToDocx are NOT imported here at top level, on
// purpose — pdfkit/docx are sizeable dependency trees that only the two
// download routes below need, and this file's cold boot already pulls in
// enough (busboy, mammoth, pdf-parse, the whole CV pipeline) to notice.
// They're dynamically imported at the point of use instead, so server
// startup time doesn't pay for two renderers most requests never touch.
import {
  getClientIp,
  checkRateLimit,
  isBlocked,
  recordSuspiciousEvent
} from "./lib/security-monitor.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 3000;

// Reputación de empleador (docs/COMPANY-REPUTATION-PLAN.md, Fase R2) — one
// batched query for however many jobs are in the caller's current page
// (never the whole corpus, never N+1 per job). A job whose company has no
// confirmed alias just gets an empty array, never a guessed/fuzzy result.
async function attachReputation<T extends { company: string | null }>(
  jobs: T[]
): Promise<(T & { reputation: ReputationEntry[] })[]> {
  const companies = jobs.flatMap((job) => job.company ? [job.company] : []);
  const reputationMap = await getReputationForCompanies(companies);
  return jobs.map((job) => ({
    ...job,
    reputation: job.company ? reputationMap.get(job.company) || [] : []
  }));
}

// GET /api/companies/search backing (Fase E4) — "Confidencial"/"Empresa
// confidencial" are the fallback placeholders many sources use for an
// undisclosed employer (~1,536 postings combined in the real corpus), never
// a real company, so they're excluded before counting the same way
// getComputrabajoDiscoveryCandidates() already excludes "Confidencial".
// company_reputation_alias's exact-string convention applies here too — no
// fuzzy merge of near-duplicate names (regla 5 de AGENTS.md).
const COMPANY_SEARCH_EXCLUDED = new Set(["Confidencial", "Empresa confidencial"]);

// Mirrors ReputationBadges.tsx's SOURCE_LABELS exactly (that file's own
// comment: "Text attribution only, never a source's logo" — none of these
// sources license logo reuse). Duplicated here, not imported, because the
// canonical copy lives in a .tsx client component this server module has
// no reason to depend on for one 3-entry map.
const REPUTATION_SOURCE_LABELS: Record<string, string> = {
  merco: "Merco Talento",
  gptw: "Great Place to Work",
  computrabajo: "Computrabajo"
};

// A route's own validation always returns its own specific, safe 400
// before ever reaching a catch block — so whatever lands here is either a
// JSON.parse SyntaxError (generic message, safe to show verbatim) or an
// unexpected failure from a DB/network call. The latter's real message
// (a raw pg error can name a table, column or constraint) is never sent to
// the client — only logged server-side, where it's actually actionable.
// General cap on the whole /api/* surface (scraping-scale abuse, blind
// endpoint hammering) — the per-route limits below (sensitive writes) are
// tighter and checked separately inside those routes.
const GENERAL_API_RATE_LIMIT = 120;
const GENERAL_API_RATE_WINDOW_MS = 60 * 1000;
const CV_GENERATE_BODY_MAX_BYTES = 200 * 1024;
const CHECKOUT_START_BODY_MAX_BYTES = 1 * 1024; // { plan?: "pro" | "pro_max" } — tiny payload, generous cap

// Job title/location/date come from the scraped corpus — untrusted text
// (AGENTS.md regla 6). Only real fields the client already has go into the
// prompt's job_requirements (§3.2's documented gap: no description field
// exists to summarize), and only a sanitized form goes into a filename.
function buildJobRequirementsText(jobLocation: unknown, jobDateText: unknown): string {
  const parts: string[] = [];
  if (typeof jobLocation === "string" && jobLocation.trim())
    parts.push(`Ubicación: ${jobLocation.trim().slice(0, 200)}`);
  if (typeof jobDateText === "string" && jobDateText.trim())
    parts.push(`Publicada: ${jobDateText.trim().slice(0, 100)}`);
  return parts.join("\n");
}

// Fase 11 (docs/CV-GENERATION-PLAN.md §6.2 paso 1, §6.5): the client's
// `modelOption` is only ever a hint — the server re-validates it against
// the SESSION's real tier (never a value the client claims) and derives
// the credit cost from `MODEL_OPTION_CREDIT_COST`, never from anything
// the request body sent. Pro can only ever reach "standard"; requesting
// anything else from a Pro session is rejected here, before any quota
// reservation.
const VALID_MODEL_OPTIONS: ReadonlySet<string> = new Set(["standard", "premium", "compare"]);

function validateModelOptionForTier(
  tier: CvTier,
  rawOption: unknown
):
  | { ok: true; modelOption: ModelOption; proMaxCreditCost: number | undefined }
  | { ok: false; error: string } {
  const candidate = rawOption ?? "standard";
  if (typeof candidate !== "string" || !VALID_MODEL_OPTIONS.has(candidate)) {
    return { ok: false, error: "modelOption inválido." };
  }
  const modelOption = candidate as ModelOption;
  if (tier === "pro") {
    if (modelOption !== "standard") {
      return { ok: false, error: "Esta opción de modelo requiere una suscripción Pro Max." };
    }
    return { ok: true, modelOption: "standard", proMaxCreditCost: undefined };
  }
  return { ok: true, modelOption, proMaxCreditCost: MODEL_OPTION_CREDIT_COST[modelOption] };
}

type ByokOverride = Pick<RunContext, "credentialSource" | "providerId" | "modelId" | "apiKey">;

// Fase 11 de docs/RESUME-STUDIO-PLAN.md — mismo criterio que
// `validateModelOptionForTier` justo arriba: el servidor nunca confía en
// lo que el cliente afirma, siempre re-resuelve contra el Provider
// Registry + Credential Resolver reales antes de construir un RunContext.
// `providerId`/`modelId` ausentes (el caso de siempre) es válido y
// significa "sigue con el único modelo Gemini operador-financiado" —
// cambiar de modelo NUNCA requiere BYOK conectado (decisión explícita del
// plan aprobado). Si el cliente manda un `providerId` para el que este
// usuario NO tiene una credencial propia conectada, esto responde con un
// 409 explícito — nunca cae en silencio al modelo del operador con la
// credencial equivocada. Caso encontrado en la verificación de esta fase
// (asesor externo, no la propia verificación con Playwright — el picker
// nunca ofrece esta combinación porque `handleListModels` solo lista
// modelos para proveedores CONECTADOS, así que la UI no puede llegar
// aquí): `CredentialResolver.resolve()` SÍ tiene un fallback real para
// `"google"` (§3.2 del plan aprobado — es el único proveedor con cuenta
// operador-financiada), así que un cliente que llame la API directo con
// `providerId: "google"` y CERO credencial propia recibía
// `source: "operator_fallback"` en vez del 409 — la key del operador
// corriendo un `modelId` elegido por el cliente, saltándose la resolución
// por YAML (que sí tiene pricing real y sí cuenta contra el circuit
// breaker diario, `costUsd()` devuelve $0 para un modelo BYOK sin entrada
// de pricing). Fix: solo se arma un `override` cuando la fuente es
// REALMENTE `"user_byok"` — un `"operator_fallback"` para "google" cae al
// mismo camino que ausencia total de `providerId`/`modelId` (gateway
// resuelve por YAML, exactamente igual que si el cliente nunca hubiera
// mandado nada), coherencia con lo que ya hace el default "Gemini —
// incluido" del picker (nunca manda `providerId`).
async function resolveByokOverride(
  userId: string,
  rawProviderId: unknown,
  rawModelId: unknown
): Promise<{ ok: true; override?: ByokOverride } | { ok: false; status: number; error: string }> {
  if (rawProviderId === undefined && rawModelId === undefined) {
    return { ok: true };
  }
  if (
    typeof rawProviderId !== "string" ||
    !rawProviderId.trim() ||
    typeof rawModelId !== "string" ||
    !rawModelId.trim()
  ) {
    return {
      ok: false,
      status: 400,
      error: "providerId y modelId deben venir juntos, como texto."
    };
  }
  const providerId = rawProviderId.trim();
  const modelId = rawModelId.trim();
  const registry = getProviderRegistry();
  if (!registry.has(providerId)) {
    return { ok: false, status: 404, error: `Proveedor "${providerId}" no reconocido.` };
  }
  const resolved = await getCredentialResolver().resolve(userId, providerId);
  if (!resolved || resolved.source !== "user_byok") {
    return {
      ok: false,
      status: 409,
      error: "Conecta ese proveedor de IA en Cuenta → IA antes de usarlo aquí."
    };
  }
  return {
    ok: true,
    override: { credentialSource: resolved.source, providerId, modelId, apiKey: resolved.apiKey }
  };
}

function sanitizeFilenamePart(input: string): string {
  const cleaned = input
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .trim()
    .slice(0, 80);
  return cleaned || "CV";
}

// Shared error mapping for POST /api/cv/generate and .../regenerate
// (docs/CV-GENERATION-PLAN.md §9.5) — both run the same pipeline
// (generation-pipeline.ts) and can fail the same ways.
function respondToCvGenerationError(
  res: http.ServerResponse,
  err: unknown,
  routeLabel: string
): void {
  if (err instanceof InactivePromptError) {
    // Generic guard, not dead code: cv_draft/cv_critique pasaron su eval
    // real de Fase 8 (2026-08-08, docs/CV-GENERATION-PLAN.md §10) y ya
    // son `active: true` — este branch ya no dispara para ellos, pero
    // sigue protegiendo cualquier prompt futuro que se agregue todavía
    // inactivo (§11 — "nada se activa sin haber corrido su eval offline
    // primero").
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "La generación de CV con IA todavía no está activada en este entorno."
      })
    );
    return;
  }
  if (err instanceof QuotaExceededError) {
    res.writeHead(402, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Ya usaste toda tu cuota/créditos de este período." }));
    return;
  }
  if (err instanceof ModelOptionNotAvailableError) {
    // Fase 11 (§10 fila 11): "premium"/"compare" no corren un pipeline
    // real todavía — rechazado ANTES de reservar cualquier cuota
    // (generation-pipeline.ts). Nunca alcanzable desde la UI hoy (el
    // selector los deja bloqueados), solo defensa en profundidad contra
    // una solicitud manual.
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: 'Esta opción de modelo todavía no está disponible. Usa "Estándar" por ahora.'
      })
    );
    return;
  }
  if (err instanceof GenerationConflictError) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "Ya hay una generación para esta vacante en curso o completada." })
    );
    return;
  }
  if (err instanceof GenerationNotFoundError) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No se encontró una generación previa para regenerar." }));
    return;
  }
  if (err instanceof FactualityRejectedError) {
    // §6.2 paso 5: cuota nunca se cobra por un fallo del validador — ya
    // garantizado dentro del pipeline (failGeneration/revertRegeneration),
    // este bloque solo decide el mensaje HTTP.
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "No se pudo generar un CV verificable para esta vacante. No se cobró tu cuota — intenta de nuevo."
      })
    );
    return;
  }
  respondToUnexpectedError(res, err, routeLabel, "No se pudo generar el CV.");
}

// Native Node HTTP Server
const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((error: unknown) => {
    console.error("[server] Error no capturado en una solicitud:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Error interno del servidor." }));
    } else if (!res.writableEnded) {
      res.end();
    }
  });
});

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const method = req.method || "GET";
  const requestStartedAt = Date.now();
  const clientIp = getClientIp(req);

  // Minimal structured request/security log — one JSON line per response,
  // to stdout (Render and most hosts capture that as searchable logs with
  // no extra service needed). 401/403 flag auth-bypass attempts; a 404 on
  // /api/* flags enumeration against a real route shape with a guessed
  // resource (e.g. /api/companies/:slug, /api/jobs/:id with a made-up
  // value — both return a real 404 from inside their own handler). Does
  // NOT catch someone probing a path that matches no route at all
  // (/api/whatever-i-guessed) — the SPA fallback at the bottom of this
  // handler serves index.html (200) for anything unmatched, same as a
  // normal page nav; that's a real gap, not something this check pretends
  // to cover. 401/403 also feed recordSuspiciousEvent, same counter the
  // rate limiter's rejections feed — either kind of abuse can trip the
  // alert/auto-block thresholds in security-monitor.ts.
  res.on("finish", () => {
    const status = res.statusCode;
    const suspicious =
      status === 401 || status === 403 || (status === 404 && pathname.startsWith("/api/"));
    if (status === 401 || status === 403) {
      recordSuspiciousEvent(clientIp, `${method} ${pathname} -> ${status}`);
    }
    const logLine = {
      ts: new Date().toISOString(),
      method,
      path: pathname,
      status,
      durationMs: Date.now() - requestStartedAt,
      ip: clientIp
    };
    (suspicious ? console.warn : console.log)(JSON.stringify(logLine));
  });

  // 1b. Temporary auto-block (Fase L3) — checked before anything else, so a
  // blocked IP never reaches a route handler at all. Time-boxed and
  // in-memory (see security-monitor.ts) — never a permanent ban list.
  if (isBlocked(clientIp)) {
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "900" });
    res.end(JSON.stringify({ error: "Demasiadas solicitudes — intenta de nuevo más tarde." }));
    return;
  }

  // 1c. General rate limit across all of /api/* (Fase L1) — checked once
  // here rather than per-route, since it's meant to catch corpus-scale
  // scraping/hammering regardless of which specific endpoint it's aimed at.
  // /api/health is exempt: hosting platforms and uptime monitors typically
  // poll it every few seconds, well past what any user-facing limit should
  // allow — rate-limiting it would produce false "service down" alerts, not
  // catch an attacker.
  if (
    pathname.startsWith("/api/") &&
    pathname !== "/api/health" &&
    !checkRateLimit(clientIp, GENERAL_API_RATE_LIMIT, GENERAL_API_RATE_WINDOW_MS, "general")
  ) {
    recordSuspiciousEvent(clientIp, `rate-limit general ${pathname}`);
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
    res.end(JSON.stringify({ error: "Demasiadas solicitudes — intenta de nuevo en un minuto." }));
    return;
  }

  // 1d. Resume Studio + BYOK route module (docs/RESUME-STUDIO-PLAN.md, Fase
  // 1) — reservado bajo /api/ai/ y /api/resume-studio/ para que las rutas
  // que llegan desde Fase 5 en adelante (CRUD de credenciales, registry de
  // proveedores/modelos) tengan un módulo propio en vez de sumarse a la
  // cadena de 26 ramas de abajo. `RESUME_STUDIO_ENABLED` es el kill-switch
  // de despliegue (config.ts) — apagado por defecto, así que hoy esto
  // nunca delega a nada (el módulo en sí tampoco maneja ninguna ruta
  // todavía, ver server/routes/resume-studio.ts).
  if (
    RESUME_STUDIO_ENABLED &&
    (pathname.startsWith("/api/ai/") || pathname.startsWith("/api/resume-studio/"))
  ) {
    const handled = await handleResumeStudioRoute(req, res, {
      pathname,
      method,
      parsedUrl,
      clientIp
    });
    if (handled) return;
  }

  // 2. Health Check Endpoint
  if (pathname === "/api/health" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage()
      })
    );
    return;
  }

  // 3. GET /api/runs
  if (pathname === "/api/runs" && method === "GET") {
    const runs = await getRuns();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ runs, count: runs.length }));
    return;
  }

  // 4. GET /api/jobs — tier is always resolved server-side from a verified
  //    session; free/anonymous callers get the 48h freshness paywall masking.
  //    PostgreSQL filters/counts/paginates; only the requested page enters
  //    the Node heap.
  if (pathname === "/api/jobs" && method === "GET") {
    const session = await verifySession(req);
    const tier = session?.tier || "free";
    const params = parsedUrl.searchParams;
    const filters: JobFilterParams = {
      search: params.get("search") || undefined,
      sources: params.getAll("sources").length ? params.getAll("sources") : undefined,
      cities: params.getAll("cities").length ? params.getAll("cities") : undefined,
      modality: params.get("modality") || undefined,
      freshness: params.get("freshness") || undefined,
      roles: params.getAll("roles").length ? params.getAll("roles") : undefined,
      company: params.get("company") || undefined,
      country: params.get("country") || undefined
    };
    const limit = Math.min(Math.max(parseInt(params.get("limit") || "24", 10) || 24, 1), 100);
    const offset = Math.max(parseInt(params.get("offset") || "0", 10) || 0, 0);
    const result = await getJobsPage({
      filters,
      preferredRoles: session?.preferredRoles,
      limit,
      offset,
      includeDetails: true
    });
    const visibleJobs = maskLockedFields(result.jobs, tier);
    const page = await attachReputation(visibleJobs);
    // A manual role filter (checked in FilterBar) is an explicit, stronger
    // signal than the soft onboarding preference — only reorder by
    // preference when the caller didn't already filter by role themselves.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jobs: page,
        count: page.length,
        total: result.total,
        hasMore: offset + page.length < result.total
      })
    );
    return;
  }

  // 4a. GET /api/jobs/:id — used by the apply-gate flow to re-fetch one
  //     specific job by id after login, independent of whatever page of the
  //     paginated list the browser last had loaded (that job may not even
  //     be on the first page once preference-sorted).
  if (pathname.startsWith("/api/jobs/") && method === "GET") {
    const id = pathname.slice("/api/jobs/".length);
    const session = await verifySession(req);
    const tier = session?.tier || "free";
    // Gate on membership in the deduped light corpus, not just "the row
    // exists" — getJobById() reads straight off `jobs` by primary key, which
    // would also return a row DISTINCT ON collapsed as a non-canonical
    // duplicate (same (title, company, location) group, older/losing
    // published_at). Serving that id 200 would resurrect exactly the
    // soft-404/near-duplicate class §1.18 fixed, just for this API instead
    // of the SSR page.
    const job = await getJobById(id);
    if (!job) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Vacante no encontrada" }));
      return;
    }
    const [visible] = maskLockedFields([job], tier);
    const [withReputation] = await attachReputation([visible]);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ job: withReputation }));
    return;
  }

  // 4a-search. GET /api/companies/search?q=&limit=&offset= — company
  // autocomplete for the /dashboard filter (Fase E4) AND the paginated
  // /empresas directory (Fase E5, infinite scroll). Exact pathname check,
  // checked BEFORE the :slug route below — "/api/companies/search" also
  // matches that route's startsWith("/api/companies/") prefix, so this
  // must win first or "search" gets treated as a company slug.
  if (pathname === "/api/companies/search" && method === "GET") {
    const params = parsedUrl.searchParams;
    const q = params.get("q") || "";
    const limit = Math.min(Math.max(parseInt(params.get("limit") || "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(params.get("offset") || "0", 10) || 0, 0);
    const country = params.get("country") || undefined;
    const companyPage = await searchActiveCompanies(
      q,
      country,
      limit,
      offset,
      Object.keys(COMPANY_LOGO_DOMAINS)
    );
    // Country-scoped same as GET /api/jobs (country = $1 OR country IS NULL)
    // — a company directory browsed from Venezuela must never surface a
    // Colombia-only employer, and vice versa (remote-hiring companies still
    // show in both, same as remote jobs do).
    const companies = companyPage.companies.map((item) => ({
      ...item,
      logoUrl: getCompanyLogoUrl(item.company)
    }));
    const total = companyPage.total;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ companies, total, hasMore: offset + limit < total }));
    return;
  }

  // 4a-bis. GET /api/companies/:slug — company page (dashboard navigation,
  // see docs/COMPANY-REPUTATION-PLAN.md's "empresas" note; not one of the
  // R0-R5 reputation fases, a later extension reusing that pipeline).
  // Two-step resolution: try the curated alias table first (the ~116
  // companies with real Merco/GPTW reputation — resolveCompanyBySlug),
  // then fall back to matching any real company from the live job corpus
  // (resolveCompanyNameFromJobs) so every company a job actually links to
  // gets a working page, just without a reputation section when there's
  // no curated data for it. Only a slug matching neither is a real 404 —
  // never a guessed/invented page.
  if (pathname.startsWith("/api/companies/") && method === "GET") {
    const slug = pathname.slice("/api/companies/".length);
    const country = parsedUrl.searchParams.get("country") || undefined;

    const session = await verifySession(req);
    const tier = session?.tier || "free";
    const companyNames = await getActiveCompanyNames(country);
    // Same country scoping as the search endpoint above, applied BEFORE
    // resolution — resolveCompanyNameFromJobs()'s fallback only matches
    // against this country-scoped view, so a slug that only resolves via a
    // job from the other country correctly falls through to the 404 below
    // instead of resolving into a company page with zero jobs to show.
    const companyName =
      (await resolveCompanyBySlug(slug)) ||
      resolveCompanyNameFromJobs(slug, companyNames.map((company) => ({ company })));
    if (!companyName) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Empresa no encontrada" }));
      return;
    }

    const matched = await getJobsPage({
      filters: { company: companyName, country },
      limit: 60,
      offset: 0,
      includeDetails: false
    });
    // resolveCompanyBySlug() (the curated Merco/GPTW alias table) is
    // country-agnostic, so it can resolve a real companyName that simply
    // has no jobs in this country's scoped view (e.g. a Colombia-only
    // curated company hit while browsing from /ve/empresas). Treating that
    // as "not found here" — not an empty-but-200 company page — is what
    // keeps the two countries' directories from ever cross-linking.
    if (country && matched.total === 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Empresa no encontrada" }));
      return;
    }
    const page = maskLockedFields(matched.jobs, tier);
    const reputationMap = await getReputationForCompanies([companyName]);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        companyName,
        logoUrl: getCompanyLogoUrl(companyName),
        reputation: reputationMap.get(companyName) || [],
        jobs: page,
        total: matched.total
      })
    );
    return;
  }

  // 4b. GET /api/me — returns the caller's verified profile/tier (never trusts the client)
  if (pathname === "/api/me" && method === "GET") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: session.id,
        email: session.email,
        name: session.name,
        tier: session.tier,
        subscriptionEnd: session.subscriptionEnd,
        preferredRoles: session.preferredRoles,
        // Fase 13 de docs/RESUME-STUDIO-PLAN.md — cutover: el gate pasó de
        // "opt-in por usuario" a "kill-switch de despliegue opt-out".
        // `RESUME_STUDIO_ENABLED` solo, ya no `&& session.resumeStudioBeta`
        // — mismo criterio que `GET /api/cv/overlay-bootstrap` abajo, el
        // frontend nunca vuelve a hacer ese AND. `users.resume_studio_beta`
        // se queda en el schema (regla de migraciones aditivas, nunca se
        // borra una columna) y sigue viajando hasta `VerifiedSession`
        // (`verify-session.ts`) — simplemente ya nadie la lee para decidir
        // esto; revertir el cutover es tan simple como restaurar el `&&`.
        resumeStudioActive: RESUME_STUDIO_ENABLED
      })
    );
    return;
  }

  // 4c. PATCH /api/me — lets a user edit their own display name. The id
  // updated is always the one verifySession resolved from the JWT, never
  // anything from the request body.
  if (pathname === "/api/me" && method === "PATCH") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }

    let bodyText = "";
    req.on("data", (chunk) => {
      bodyText += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(bodyText || "{}");
        const name = typeof parsed.name === "string" ? parsed.name.trim().slice(0, 255) : "";
        if (!name) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "El nombre no puede estar vacío" }));
          return;
        }

        const updated = await updateUserName(session.id, name);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: updated.id,
            email: updated.email,
            name: updated.name,
            tier: updated.subscriptionTier,
            subscriptionEnd: updated.subscriptionEnd
          })
        );
      } catch (e: any) {
        respondToUnexpectedError(res, e, "PATCH /api/me", "No se pudo actualizar el nombre.");
      }
    });
    return;
  }

  // 4c-bis. PATCH /api/me/roles — saves the roles picked in the post-signup
  // onboarding step. Same id-from-session rule as PATCH /api/me: never a
  // client-supplied id. An empty array is a valid, deliberate choice.
  if (pathname === "/api/me/roles" && method === "PATCH") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }

    let bodyText = "";
    req.on("data", (chunk) => {
      bodyText += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(bodyText || "{}");
        if (!Array.isArray(parsed.roles)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "roles debe ser un arreglo" }));
          return;
        }
        const roles = Array.from(
          new Set(
            parsed.roles
              .filter((r: unknown) => typeof r === "string")
              .map((r: string) => r.trim())
              .filter((r: string) => r.length > 0 && r.length <= 100)
          )
        ).slice(0, 10);

        const updated = await updateUserPreferredRoles(session.id, roles);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: updated.id,
            email: updated.email,
            name: updated.name,
            tier: updated.subscriptionTier,
            subscriptionEnd: updated.subscriptionEnd,
            preferredRoles: updated.preferredRoles
          })
        );
      } catch (e: any) {
        respondToUnexpectedError(
          res,
          e,
          "PATCH /api/me/roles",
          "No se pudieron guardar los puestos."
        );
      }
    });
    return;
  }

  // 4d. GET /api/transactions — payment history for the caller's own Account
  // page, scoped to their verified id (never a client-supplied one).
  if (pathname === "/api/transactions" && method === "GET") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    const transactions = await getTransactionsForUser(session.id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ transactions }));
    return;
  }

  // 5. POST /api/run-scraper (requiere sesión autenticada) — scraping always
  // runs out-of-process now (GitHub Actions tick, see scripts/run-scrape-tick.ts),
  // never inline on the web dyno. This just marks the requested role(s) as
  // due-now so the next scheduled tick (within ~15 min) picks them up.
  if (pathname === "/api/run-scraper" && method === "POST") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    if (!checkSensitiveRateLimit(clientIp, res, "POST /api/run-scraper")) return;

    let bodyText = "";
    req.on("data", (chunk) => {
      bodyText += chunk.toString();
    });
    req.on("end", async () => {
      let keywords: string[] = [];
      try {
        if (bodyText) {
          const parsed = JSON.parse(bodyText);
          if (Array.isArray(parsed.keywords)) {
            keywords = parsed.keywords;
          }
        }
      } catch (e) {}

      if (keywords.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Falta 'keywords' (roles a re-escanear)" }));
        return;
      }

      for (const roleName of keywords) {
        await markRoleForImmediateRescan(roleName);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          message:
            "Marcado para el próximo ciclo programado (~15 min), no se ejecuta en este proceso."
        })
      );
    });
    return;
  }

  // 6. POST /api/checkout/start (requiere sesión autenticada) — inicia un
  //    Wompi Web Checkout real (sandbox) para el plan Pro o Pro Max mensual
  //    (Fase 10, docs/CV-GENERATION-PLAN.md §10).
  if (pathname === "/api/checkout/start" && method === "POST") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    if (!checkSensitiveRateLimit(clientIp, res, "POST /api/checkout/start")) return;

    const body = await readJsonBodyCapped(req, CHECKOUT_START_BODY_MAX_BYTES);
    if (!body.ok) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Cuerpo de la solicitud inválido." }));
      return;
    }
    // Nunca confiar en un valor de plan arbitrario del cliente (AGENTS.md
    // implícito en todo este archivo) — solo estos dos strings exactos
    // resuelven a un monto real; cualquier otra cosa cae a "pro", nunca
    // a un monto inventado por el cliente.
    const requestedPlan = body.value?.plan;
    const plan: "pro" | "pro_max" = requestedPlan === "pro_max" ? "pro_max" : "pro";

    try {
      const checkout = await startPaymentCheckout({
        userId: session.id,
        userEmail: session.email,
        plan
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(checkout));
    } catch (e: any) {
      respondToUnexpectedError(
        res,
        e,
        "POST /api/checkout/start",
        "No se pudo iniciar el checkout."
      );
    }
    return;
  }

  // 7. POST /api/webhooks/wompi — endpoint público, la confianza viene de la
  //    verificación de firma (nunca del payload por sí solo).
  if (pathname === "/api/webhooks/wompi" && method === "POST") {
    let bodyText = "";
    req.on("data", (chunk) => {
      bodyText += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(bodyText);
        const result = await handleWompiWebhook(payload);
        if (!result.verified) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Firma inválida" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (e: any) {
        respondToUnexpectedError(res, e, "POST /api/webhooks/wompi", "Payload inválido.");
      }
    });
    return;
  }

  // 7a-zero. GET /api/cv/overlay-bootstrap?jobId= (perf follow-up a Fase 11,
  // 2026-08-09) — reemplaza los 3 fetches paralelos que CvAdjustOverlay.tsx
  // disparaba al abrir (`/api/cv/profile` + `/api/cv/quota` +
  // `/api/cv/generations?jobId=`). Medido en vivo contra la Postgres real
  // de este proyecto (Supabase, no local): cada uno de esos 3 requests paga
  // por separado el costo de `verifySession` (llamada de red a Supabase
  // Auth + upsert en `users`) — el más lento (`/api/cv/quota`) tardaba
  // ~2.1s solo, y el overlay esperaba a los tres antes de salir de
  // "Cargando...". Un solo `verifySession` + las 3 lecturas en paralelo
  // (`Promise.all`, no dependen entre sí salvo `facts`, que depende de
  // `generation.document`) corta esa espera a una fracción. Los 3
  // endpoints viejos NO se eliminan — `/api/cv/profile` sigue siendo el
  // que usa el polling de "Procesando tu CV..." mientras corre la Etapa A
  // (§9.3), un uso legítimamente distinto de este bootstrap de apertura.
  if (pathname === "/api/cv/overlay-bootstrap" && method === "GET") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    if (session.tier !== "pro" && session.tier !== "pro_max") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Esta función requiere una suscripción Pro." }));
      return;
    }
    const jobId = parsedUrl.searchParams.get("jobId") || "";
    if (!isUuid(jobId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "jobId inválido o ausente." }));
      return;
    }
    try {
      const tier: CvTier = session.tier === "pro_max" ? "pro_max" : "pro";
      const [profile, quota, generation] = await Promise.all([
        getCvProfileStatus(session.id),
        getQuotaStatus(session.id, tier),
        getGenerationForJob(session.id, jobId)
      ]);
      const facts = generation?.document ? await getCvFacts(session.id) : null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          profile,
          quota: { ...quota, tier },
          generation: {
            id: generation?.id ?? null,
            status: generation?.status ?? null,
            document: generation?.document ?? null,
            // Fase 12 (docs/RESUME-STUDIO-PLAN.md) — original inmutable de la
            // IA para el modo Comparar. `document` sigue siendo la fuente de
            // verdad para el editor; este campo es solo lectura, nunca se
            // vuelve a mandar en un PATCH.
            generatedDocument: generation?.generatedDocument ?? null,
            facts: facts ?? null,
            templateId: generation?.templateId ?? DEFAULT_TEMPLATE_ID
          },
          // Fase 13 de docs/RESUME-STUDIO-PLAN.md — mismo cutover que
          // `resumeStudioActive` en `GET /api/me` arriba: `resumeStudio.active`
          // ahora es solo `RESUME_STUDIO_ENABLED`, ya no
          // `&& session.resumeStudioBeta`. Las dos respuestas DEBEN
          // acordar siempre — ver el comentario de `GET /api/me` para el
          // razonamiento completo.
          resumeStudio: { active: RESUME_STUDIO_ENABLED }
        })
      );
    } catch (e: any) {
      respondToUnexpectedError(
        res,
        e,
        "GET /api/cv/overlay-bootstrap",
        "No se pudo cargar el editor de CV."
      );
    }
    return;
  }

  // 7a. /api/cv/profile (docs/CV-GENERATION-PLAN.md §9.3/§9.5, Fase 2a) —
  // Etapa 0 solamente (subir → extraer texto → guardar raw_text).
  // `facts_json` se queda NULL hasta que la Etapa A (Fase 2b) corra
  // contra un modelo real — nunca se finge con un cliente falso solo para
  // poblar esa columna. Gated a `tier === "pro"`: "pro_max" todavía no
  // existe como tier real (VerifiedSession.tier es 'free' | 'pro'; Fase 10
  // extiende esto cuando exista el cobro de Pro Max). Free tier no tiene
  // ningún acceso, ni siquiera para subir un CV que no podría usar.
  if (
    pathname === "/api/cv/profile" &&
    (method === "POST" || method === "GET" || method === "DELETE")
  ) {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    if (session.tier !== "pro" && session.tier !== "pro_max") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Esta función requiere una suscripción Pro." }));
      return;
    }

    if (method === "GET") {
      try {
        const status = await getCvProfileStatus(session.id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status));
      } catch (e: any) {
        respondToUnexpectedError(res, e, "GET /api/cv/profile", "No se pudo consultar el CV.");
      }
      return;
    }

    if (!checkSensitiveRateLimit(clientIp, res, `${method} /api/cv/profile`)) return;

    if (method === "DELETE") {
      try {
        await deleteCvProfile(session.id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (e: any) {
        respondToUnexpectedError(res, e, "DELETE /api/cv/profile", "No se pudo borrar el CV.");
      }
      return;
    }

    // POST — sube un CV nuevo; reemplaza cualquiera que existiera antes.
    try {
      const upload = await parseSingleFileUpload(req, { maxBytes: MAX_UPLOAD_BYTES });
      const { text, truncated } = await extractTextFromUpload(upload.buffer, upload.mimeType);
      await upsertCvProfileRawText(session.id, text);
      // Fase 6 wiring (docs/CV-GENERATION-PLAN.md, nota bajo la tabla de
      // Fase 2b): dispara la Etapa A sin bloquear esta respuesta — el
      // cliente ve `facts_json` llenarse por separado sondeando
      // GET /api/cv/profile (hasFacts), nunca esperando aquí a un modelo.
      void extractAndStoreFacts(session.id, text);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", truncated }));
    } catch (e: any) {
      if (e instanceof UploadTooLargeError) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: `El archivo supera el máximo de ${MAX_UPLOAD_BYTES} bytes.` })
        );
        return;
      }
      if (e instanceof UnsupportedFileTypeError || e instanceof UploadInvalidError) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
        return;
      }
      if (e instanceof TextExtractionError) {
        // El mensaje real del parser nunca se devuelve al cliente tal
        // cual (podría, en principio, incluir fragmentos derivados del
        // contenido del archivo) — respondToUnexpectedError abajo maneja
        // el resto de errores con la misma disciplina (§8.2: nunca
        // contenido del CV en la respuesta ni en el log).
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "No se pudo leer el archivo. Verifica que sea un PDF o DOCX válido."
          })
        );
        return;
      }
      respondToUnexpectedError(res, e, "POST /api/cv/profile", "No se pudo procesar el CV.");
    }
    return;
  }

  // 7a-bis. GET /api/cv/quota (Fase 6, Vista 1 §9.3: "Te quedan X de Y
  // generaciones") — lectura pura, mismo gate 401/403 que /api/cv/profile.
  // `getQuotaStatus` nunca reserva ni bloquea nada; la decisión real de si
  // una generación puede proceder sigue siendo solo de
  // `reserveGenerationQuota` (§6.2), no de este endpoint de display.
  if (pathname === "/api/cv/quota" && method === "GET") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    if (session.tier !== "pro" && session.tier !== "pro_max") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Esta función requiere una suscripción Pro." }));
      return;
    }
    try {
      // Fase 10: mismo motivo que en generate/regenerate — un Pro Max
      // hardcodeado a "pro" aquí vería "3 de 3" en vez de sus 14 créditos
      // reales, aunque la reserva transaccional (que sí ya usaba el tier
      // real) cobrara correcto — el display y la reserva deben acordar.
      const tier: CvTier = session.tier === "pro_max" ? "pro_max" : "pro";
      const status = await getQuotaStatus(session.id, tier);
      // Fase 11: el cliente necesita el tier real para decidir si dice
      // "generaciones" (Pro) o "créditos" (Pro Max) — nunca inferirlo de
      // `limit` (frágil, coincide con el número por casualidad).
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...status, tier }));
    } catch (e: any) {
      respondToUnexpectedError(res, e, "GET /api/cv/quota", "No se pudo consultar la cuota.");
    }
    return;
  }

  // 7a-ter. POST /api/cv/generate (docs/CV-GENERATION-PLAN.md §9.5, Fase 7,
  // selector de modelo real desde Fase 11 §10 fila 11) — runs the real
  // pipeline (Etapa B -> D -> validador -> E, generation-pipeline.ts)
  // against the live gateway. `modelOption` now comes from the request
  // body, but is ALWAYS re-validated against `session.tier`
  // (`validateModelOptionForTier`) — the client's claim is never trusted
  // (§6.2 paso 1). Only "standard" runs a real pipeline today
  // (`generation-pipeline.ts`'s `AVAILABLE_MODEL_OPTIONS`) — "premium"/
  // "compare" are rejected (501, `ModelOptionNotAvailableError`) BEFORE
  // any quota reservation happens; the insufficient-credits scenario for
  // those options is proven directly against `reserveGenerationQuota`
  // (tests/validate-cv-quota.ts, Grupo 5), not through this route. Both
  // are otherwise unreachable from the UI (selector leaves them blocked,
  // §10 fila 11).
  // `cv_draft`/`cv_critique` pasaron su eval de Fase 8 y ya son
  // `active: true` (2026-08-08, §10) — esta ruta genera CVs reales ahora,
  // contra `getDevGateway()` (aún apuntando a modelos gratuitos por
  // decisión explícita, ver gateway-instance.ts).
  if (pathname === "/api/cv/generate" && method === "POST") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    if (session.tier !== "pro" && session.tier !== "pro_max") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Esta función requiere una suscripción Pro." }));
      return;
    }
    if (!checkSensitiveRateLimit(clientIp, res, "POST /api/cv/generate")) return;

    const body = await readJsonBodyCapped(req, CV_GENERATE_BODY_MAX_BYTES);
    if (!body.ok) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Cuerpo de la solicitud inválido." }));
      return;
    }
    const {
      jobId,
      jobTitle,
      jobCompany,
      jobLocation,
      jobDateText,
      modelOption: rawModelOption
    } = body.value ?? {};
    if (
      typeof jobId !== "string" ||
      !isUuid(jobId) ||
      typeof jobTitle !== "string" ||
      !jobTitle.trim() ||
      typeof jobCompany !== "string" ||
      !jobCompany.trim()
    ) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Faltan jobId/jobTitle/jobCompany válidos." }));
      return;
    }
    const tier: CvTier = session.tier === "pro_max" ? "pro_max" : "pro";
    const optionResult = validateModelOptionForTier(tier, rawModelOption);
    if (!optionResult.ok) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: optionResult.error }));
      return;
    }

    try {
      const facts = await getCvFacts(session.id);
      if (!facts) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Sube y procesa tu CV base antes de generar uno adaptado a esta vacante."
          })
        );
        return;
      }
      const result = await runCvGenerationPipeline({
        userId: session.id,
        tier,
        proMaxCreditCost: optionResult.proMaxCreditCost,
        jobId,
        jobTitle: jobTitle.trim().slice(0, 500),
        jobCompany: jobCompany.trim().slice(0, 255),
        modelOption: optionResult.modelOption,
        facts,
        jobRequirements: buildJobRequirementsText(jobLocation, jobDateText),
        gateway: getDevGateway()
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: result.generationId, document: result.document, facts }));
    } catch (e) {
      respondToCvGenerationError(res, e, "POST /api/cv/generate");
    }
    return;
  }

  // 7a-quater. GET /api/cv/generations?jobId= (§9.2/§9.5) — read-only,
  // decides Vista 1 (setup) vs Vista 2 (editor) on open. Only a
  // `completed` row routes to the editor; a `reserved` (mid-flight) or
  // `failed` row behaves like "no generation exists yet" on the client.
  if (pathname === "/api/cv/generations" && method === "GET") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    if (session.tier !== "pro" && session.tier !== "pro_max") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Esta función requiere una suscripción Pro." }));
      return;
    }
    const jobId = parsedUrl.searchParams.get("jobId") || "";
    if (!isUuid(jobId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "jobId inválido o ausente." }));
      return;
    }
    try {
      const generation = await getGenerationForJob(session.id, jobId);
      // The editor (§9.4) reorders/hides real skill/education/certification
      // ids and needs their names to render — it can only ever choose among
      // ids that already exist in CvFacts (never invent one), so shipping
      // the vault alongside the document here is what makes that possible
      // without a second endpoint. Fetched only when there's a document to
      // edit; ownership is already the same session that owns the CV.
      const facts = generation?.document ? await getCvFacts(session.id) : null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: generation?.id ?? null,
          status: generation?.status ?? null,
          document: generation?.document ?? null,
          facts: facts ?? null
        })
      );
    } catch (e: any) {
      respondToUnexpectedError(
        res,
        e,
        "GET /api/cv/generations",
        "No se pudo consultar la generación."
      );
    }
    return;
  }

  // 7a-quater-bis. POST /api/cv/generations/:id/sections/rewrite (Fase 8
  // de docs/RESUME-STUDIO-PLAN.md) — reescribe UNA sola sección (Claim) a
  // la vez para las acciones "Mejorar"/"Adaptar"/"Más ejecutivo" del
  // Resume Studio. Nunca escribe en `document_json` — solo devuelve la
  // propuesta; el cliente decide Aceptar/Descartar y, si acepta, la
  // persiste por el mismo PATCH que ya usa "Guardar cambios" (nunca un
  // segundo camino de escritura). Sin cargo de cuota/créditos en esta
  // fase — `quota.ts` está scopeado por vacante (`reserveGenerationQuota`,
  // §6.2), y esto no es una generación nueva; protegido en cambio por
  // `checkSensitiveRateLimit` (10/60s por IP) + el circuit breaker diario
  // ya existente del gateway (`max_daily_cloud_cost_usd`). Nota explícita
  // para la Fase 14 (cutover de facturación): ambos son protecciones
  // agregadas, no por-usuario — un usuario podría agotar el presupuesto
  // diario completo del operador con acciones de sección repetidas; no se
  // resuelve aquí a propósito, mismo criterio que Fase 2 dejó pendiente el
  // fix de cache key para BYOK hasta su propia fase.
  {
    const match = pathname.match(/^\/api\/cv\/generations\/([^/]+)\/sections\/rewrite$/);
    if (match && method === "POST") {
      const generationId = match[1]!;
      if (!isUuid(generationId)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No se encontró esa generación." }));
        return;
      }
      const session = await verifySession(req);
      if (!session) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No autenticado" }));
        return;
      }
      if (session.tier !== "pro" && session.tier !== "pro_max") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Esta función requiere una suscripción Pro." }));
        return;
      }
      if (!checkSensitiveRateLimit(clientIp, res, "POST /api/cv/generations/:id/sections/rewrite"))
        return;

      const body = await readJsonBodyCapped(req, CV_GENERATE_BODY_MAX_BYTES);
      if (!body.ok) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Cuerpo de la solicitud inválido." }));
        return;
      }
      const { sectionLabel, currentText, action, providerId, modelId } = (body.value ??
        {}) as Record<string, unknown>;
      const VALID_ACTIONS: CvSectionRewriteAction[] = ["mejorar", "adaptar", "ejecutivo"];
      if (
        typeof sectionLabel !== "string" ||
        !sectionLabel.trim() ||
        typeof currentText !== "string" ||
        !currentText.trim() ||
        typeof action !== "string" ||
        !VALID_ACTIONS.includes(action as CvSectionRewriteAction)
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Faltan sectionLabel/currentText/action válidos." }));
        return;
      }

      // Fase 11 — modelo elegido en el ModelPicker del Studio, opcional.
      const byokResolution = await resolveByokOverride(session.id, providerId, modelId);
      if (!byokResolution.ok) {
        res.writeHead(byokResolution.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: byokResolution.error }));
        return;
      }

      try {
        const generation = await getGenerationById(generationId, session.id);
        if (!generation) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "No se encontró una generación completada con ese id." })
          );
          return;
        }
        const facts = await getCvFacts(session.id);
        if (!facts) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Tu CV base ya no está disponible." }));
          return;
        }

        const { output } = await getDevGateway().run(
          cvSectionRewriteV1,
          {
            facts,
            jobTitle: generation.jobTitle,
            jobCompany: generation.jobCompany,
            sectionLabel: sectionLabel.trim().slice(0, 200),
            currentText: currentText.trim().slice(0, 4000),
            action: action as CvSectionRewriteAction,
            requestNonce: randomUUID()
          },
          { userId: session.id, cvGenerationId: generationId, ...(byokResolution.override ?? {}) }
        );

        // Nunca confiar solo en que el schema haya validado la FORMA de
        // supporting_fact_ids — se re-verifica aquí que cada id citado
        // exista de verdad en la bóveda de ESTE usuario (AGENTS.md regla
        // 5), la misma garantía que factuality.ts aplica al documento
        // completo, aplicada a una sola sección. Si falla, nunca se
        // devuelve la propuesta al cliente.
        const authorized = collectFactIds(facts);
        const invalidIds = output.supporting_fact_ids.filter((id) => !authorized.has(id));
        if (invalidIds.length > 0) {
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error:
                "La propuesta de la IA citó datos que no existen en tu perfil — no se pudo verificar. Intenta de nuevo."
            })
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ proposal: output }));
      } catch (e) {
        if (e instanceof InactivePromptError) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Esta función todavía no está activada en este entorno." })
          );
          return;
        }
        respondToUnexpectedError(
          res,
          e,
          "POST /api/cv/generations/:id/sections/rewrite",
          "No se pudo generar una propuesta para esta sección."
        );
      }
      return;
    }
  }

  // 7a-quater-ter. PATCH /api/cv/generations/:id/template (Fase 10 de
  // docs/RESUME-STUDIO-PLAN.md) — cambia SOLO `template_id`. Nunca toca
  // `document_json`, nunca llama al gateway/pipeline de IA — verificable
  // con un grep: ni este bloque ni `updateGenerationTemplate()` importan
  // nada de `cv/model-gateway.js`/`cv/generation-pipeline.js`/
  // `ai-gateway/*`. DOCX se queda en un solo formato ATS sin importar la
  // plantilla elegida (decisión §2 del plan aprobado) — por eso este
  // endpoint no toca nada de `render-docx.ts`.
  {
    const match = pathname.match(/^\/api\/cv\/generations\/([^/]+)\/template$/);
    if (match && method === "PATCH") {
      const generationId = match[1]!;
      if (!isUuid(generationId)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No se encontró esa generación." }));
        return;
      }
      const session = await verifySession(req);
      if (!session) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No autenticado" }));
        return;
      }
      if (session.tier !== "pro" && session.tier !== "pro_max") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Esta función requiere una suscripción Pro." }));
        return;
      }
      const body = await readJsonBodyCapped(req, 1024);
      if (!body.ok) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Cuerpo de la solicitud inválido." }));
        return;
      }
      const { templateId } = (body.value ?? {}) as Record<string, unknown>;
      if (typeof templateId !== "string" || !CV_TEMPLATES.some((t) => t.id === templateId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "templateId inválido." }));
        return;
      }
      try {
        const updated = await updateGenerationTemplate(generationId, session.id, templateId);
        if (!updated) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "No se encontró una generación completada con ese id." })
          );
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", templateId }));
      } catch (e) {
        respondToUnexpectedError(
          res,
          e,
          "PATCH /api/cv/generations/:id/template",
          "No se pudo cambiar la plantilla."
        );
      }
      return;
    }
  }

  // 7a-quinquies. /api/cv/generations/:id[/pdf|/docx|/regenerate] (§9.5) —
  // PATCH saves an edit (free, no LLM, no factuality re-check — §11: that
  // validator governs what the AI generates on its own, never what the
  // user edits into their own document afterward). GET pdf/docx render
  // on-demand (Etapa F, free) over whatever `document_json` is right now.
  // POST regenerate re-runs the real pipeline over an existing completed
  // row (accumulates quota, §6.2 — see quota.ts's reserveRegenerationQuota).
  {
    const match = pathname.match(/^\/api\/cv\/generations\/([^/]+)(?:\/(pdf|docx|regenerate))?$/);
    const validCombo =
      match &&
      ((method === "PATCH" && !match[2]) ||
        (method === "GET" && (match[2] === "pdf" || match[2] === "docx")) ||
        (method === "POST" && match[2] === "regenerate"));

    if (validCombo) {
      const generationId = match[1]!;
      const action = match[2];

      if (!isUuid(generationId)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No se encontró esa generación." }));
        return;
      }

      const session = await verifySession(req);
      if (!session) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No autenticado" }));
        return;
      }
      if (session.tier !== "pro" && session.tier !== "pro_max") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Esta función requiere una suscripción Pro." }));
        return;
      }

      if (method === "PATCH") {
        if (!checkSensitiveRateLimit(clientIp, res, "PATCH /api/cv/generations/:id")) return;
        const body = await readJsonBodyCapped(req, CV_GENERATE_BODY_MAX_BYTES);
        if (!body.ok) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Cuerpo de la solicitud inválido." }));
          return;
        }
        const parsed = CvDocumentSchema.safeParse(body.value);
        if (!parsed.success) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "El documento no tiene la forma esperada.",
              issues: parsed.error.issues.map((i) => i.path.join("."))
            })
          );
          return;
        }
        try {
          const updated = await updateGenerationDocument(generationId, session.id, parsed.data);
          if (!updated) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: "No se encontró una generación completada con ese id." })
            );
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
        } catch (e: any) {
          respondToUnexpectedError(
            res,
            e,
            "PATCH /api/cv/generations/:id",
            "No se pudo guardar el CV."
          );
        }
        return;
      }

      if (method === "GET") {
        try {
          const generation = await getGenerationById(generationId, session.id);
          if (!generation) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: "No se encontró una generación completada con ese id." })
            );
            return;
          }
          const facts = await getCvFacts(session.id);
          if (!facts) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Tu CV base ya no está disponible — no se puede generar el documento."
              })
            );
            return;
          }
          const filenameBase = `CV - ${sanitizeFilenamePart(generation.jobTitle)}`;
          if (action === "pdf") {
            const { renderCvToPdf } = await import("./cv/render-pdf.js");
            const buf = await renderCvToPdf(
              generation.document,
              facts,
              getTemplate(generation.templateId)
            );
            res.writeHead(200, {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="${filenameBase}.pdf"`
            });
            res.end(buf);
          } else {
            const { renderCvToDocx } = await import("./cv/render-docx.js");
            const buf = await renderCvToDocx(generation.document, facts);
            res.writeHead(200, {
              "Content-Type":
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "Content-Disposition": `attachment; filename="${filenameBase}.docx"`
            });
            res.end(buf);
          }
        } catch (e: any) {
          respondToUnexpectedError(
            res,
            e,
            `GET /api/cv/generations/:id/${action}`,
            "No se pudo generar el documento."
          );
        }
        return;
      }

      // POST .../regenerate
      if (!checkSensitiveRateLimit(clientIp, res, "POST /api/cv/generations/:id/regenerate"))
        return;
      const body = await readJsonBodyCapped(req, CV_GENERATE_BODY_MAX_BYTES);
      if (!body.ok) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Cuerpo de la solicitud inválido." }));
        return;
      }
      const {
        jobLocation,
        jobDateText,
        modelOption: rawModelOption,
        providerId: regenProviderId,
        modelId: regenModelId
      } = body.value ?? {};
      const regenTier: CvTier = session.tier === "pro_max" ? "pro_max" : "pro";
      const regenOptionResult = validateModelOptionForTier(regenTier, rawModelOption);
      if (!regenOptionResult.ok) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: regenOptionResult.error }));
        return;
      }
      // Fase 11 — modelo elegido en el ModelPicker del Studio, opcional.
      const regenByokResolution = await resolveByokOverride(
        session.id,
        regenProviderId,
        regenModelId
      );
      if (!regenByokResolution.ok) {
        res.writeHead(regenByokResolution.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: regenByokResolution.error }));
        return;
      }
      try {
        const existing = await getGenerationById(generationId, session.id);
        if (!existing) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "No se encontró una generación completada con ese id." })
          );
          return;
        }
        const facts = await getCvFacts(session.id);
        if (!facts) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Sube y procesa tu CV base antes de regenerar." }));
          return;
        }
        // Fase 11 (§10 fila 11): "Regenerar desde cero" deja elegir de
        // nuevo la opción de modelo (§9.4) — mismo `validateModelOptionForTier`
        // que /api/cv/generate, nunca confía en lo que mandó el cliente.
        const result = await runCvRegenerationPipeline({
          userId: session.id,
          tier: regenTier,
          proMaxCreditCost: regenOptionResult.proMaxCreditCost,
          generationId,
          modelOption: regenOptionResult.modelOption,
          facts,
          jobTitle: existing.jobTitle,
          jobCompany: existing.jobCompany,
          jobRequirements: buildJobRequirementsText(jobLocation, jobDateText),
          gateway: getDevGateway(),
          credentialOverride: regenByokResolution.override
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: result.generationId, document: result.document, facts }));
      } catch (e) {
        respondToCvGenerationError(res, e, "POST /api/cv/generations/:id/regenerate");
      }
      return;
    }
  }

  // 7b. GET /empleos/:id/:slug — server-rendered per-job page for
  // crawlers (SEO Fase 1, ver docs/SEO-PLAN.md). The `:slug` segment is
  // purely decorative for click-through readability; matching is always by
  // `:id` (a jobId, stable), so a stale slug from a since-edited title never
  // 404s — the canonical tag below just points at the freshly computed one.
  // Reuses the same getJobById()+maskLockedFields() the public /api/jobs/:id
  // route already uses, so a crawler (unauthenticated, same as an anonymous
  // visitor) can never see more than a real visitor would — no separate
  // cloaking-risk logic to keep in sync if PAYWALL_ENABLED is ever turned
  // back on.
  // Handles both the Colombia (unprefixed) and Venezuela (/ve-prefixed)
  // category pages under one branch — job DETAIL pages never get the /ve
  // prefix (see the guard just below), only the city/role "hub" pages do,
  // and only for roles (city pages have exactly one URL each, see
  // ResolvedCategory's comment in job-seo.ts).
  const isVeEmpleos = pathname.startsWith("/ve/empleos/");
  if ((pathname.startsWith("/empleos/") || isVeEmpleos) && method === "GET") {
    const basePath = isVeEmpleos ? pathname.slice(3) : pathname;
    const segments = basePath.slice("/empleos/".length).split("/").filter(Boolean);
    const id = segments[0];

    // A job's real URL is always the unprefixed /empleos/:id — there's no
    // /ve/empleos/:id equivalent (see job-seo.ts's buildJobPath, unchanged
    // by the Venezuela work). A UUID under the /ve prefix isn't a route
    // this app ever generates a link to, so it's a real 404, not a
    // fallthrough to the job-detail lookup below with an ambiguous id.
    if (isVeEmpleos && isUuid(id || "")) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Página no encontrada | BuscoTrabajo</title><meta name="robots" content="noindex"></head><body><h1>Página no encontrada</h1><p><a href="/dashboard">Ver todas las vacantes</a></p></body></html>'
      );
      return;
    }

    // 7b-cat. Category "hub" pages (SEO Fase 4, ver docs/SEO-PLAN.md §4.4).
    // A jobId is always a UUID (gen_random_uuid()) — a city/role slug never
    // is, so isUuid() alone disambiguates this from the job-detail branch
    // below without a new route prefix. Always the public (tier: "free")
    // view, same as the sitemap routes: a category page has no session-
    // specific content to gate, only the same maskLockedFields output any
    // anonymous visitor already gets.
    if (id && !isUuid(id)) {
      const requestCountry = isVeEmpleos ? "VE" : "CO";
      const category = resolveCategorySlug(id, requestCountry);
      if (!category) {
        // A role slug that used to resolve (crawled/sitemapped before a
        // taxonomy swap, see job-seo.ts's RETIRED_ROLE_SLUGS comment) is a
        // real "no longer here", not the same as a slug that never existed
        // — same distinction wasJobPurged() already makes for job URLs.
        if (RETIRED_ROLE_SLUGS.has(id.toLowerCase())) {
          res.writeHead(410, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Categoría ya no disponible | BuscoTrabajo</title><meta name="robots" content="noindex"></head><body><h1>Esta categoría ya no está disponible</h1><p>El rol fue retirado de la lista de búsqueda activa.</p><p><a href="/dashboard">Ver todas las vacantes</a></p></body></html>'
          );
          return;
        }
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Categoría no encontrada | BuscoTrabajo</title><meta name="robots" content="noindex"></head><body><h1>Categoría no encontrada</h1><p><a href="/dashboard">Ver todas las vacantes</a></p></body></html>'
        );
        return;
      }

      // country is always set here — for "ciudad" it's the matched city's
      // own country (Bogotá/Caracas are never ambiguous), for "rol" it's
      // requestCountry. Before this field existed, a role page had no
      // country filter at all and would silently mix both countries' jobs
      // under a URL whose own heading claimed just one — see
      // ResolvedCategory's comment.
      const filterParams: JobFilterParams =
        category.kind === "ciudad"
          ? { cities: [category.label], country: category.country }
          : { roles: [category.label], country: category.country };
      // isPubliclyDescribable filters out any locked job the same way
      // buildJobsSitemapXml/the job-detail branch already do — a category
      // page must never list a job it can't also link a working page for.
      const matched = await getJobsPage({
        filters: filterParams,
        limit: 60,
        offset: 0,
        includeDetails: false
      });
      const page = maskLockedFields(matched.jobs, "free").filter(isPubliclyDescribable);
      const total = matched.total;

      let indexHtml: string;
      try {
        indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf-8");
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Server Error: build not found");
        return;
      }

      const meta = buildCategoryMeta(category, total);

      // Same "real links in the raw HTML" pattern /dashboard already uses
      // (see 7c below) — this page's whole SEO value is being a crawlable
      // hub linking into the individual job pages, unlike the job-detail
      // branch below (which only needs JSON-LD in <head>, no visible list).
      const items = page
        .map((job: any) => {
          const href = buildJobPath(job);
          const title = escapeHtml(job.title);
          const company = escapeHtml(job.company || "Confidencial");
          const location = escapeHtml(
            job.location || getCountryConfig(job.country || category.country).name
          );
          const source = escapeHtml(job.source || "");
          return `<li><a href="${href}">${title}</a> — ${company} · ${location} · ${source}</li>`;
        })
        .join("\n");
      const emptyNotice = total === 0 ? "<p>No hay vacantes en esta categoría por ahora.</p>" : "";
      const ssrSnippet = `<h1>${escapeHtml(meta.heading)}</h1>\n${emptyNotice}<nav aria-label="Vacantes"><ul>\n${items}\n</ul></nav>`;
      indexHtml = indexHtml.replace('<div id="app"></div>', `<div id="app">${ssrSnippet}</div>`);

      // Same fix /dashboard already had (Fase 1, §5.4) applied here too —
      // CategoryLanding.tsx previously always re-fetched /api/jobs on
      // mount even though this response already has the real data,
      // discarding a perfectly good SSR page if that redundant client
      // fetch failed for ANY reason (rate limit, a network hiccup, a slow
      // response Google's crawler gave up waiting on). That's exactly how
      // a real, populated category page turns into a false "esta
      // categoría no existe" in front of a crawler that only ever sees
      // the final DOM — confirmed happening in production
      // (https://buscotrabajo.co/empleos/caracas showed "0 vacantes" +
      // soft-404 in Search Console's URL Inspection while the SSR route
      // itself was serving real data the whole time). Embedding it here
      // removes the redundant fetch's failure mode entirely for the
      // common case.
      const ssrCategoryPayload = escapeJsonForScriptTag({
        slug: id,
        country: category.country,
        jobs: page,
        total
      });
      indexHtml = indexHtml.replace(
        "</head>",
        `  <script>window.__SSR_CATEGORY__=${ssrCategoryPayload};</script>\n</head>`
      );

      // BreadcrumbList + ItemList (SEO Fase 6, seo-technical §1.7's flagged
      // gap: category pages carried no listing schema of their own). Built
      // from the exact same `meta`/`page` this branch already renders into
      // the visible <nav> above — no separate query, nothing that could
      // drift from what a visitor/crawler actually sees on the page.
      const categoryBreadcrumb = buildCategoryBreadcrumbList(meta);
      const categoryItemList = buildCategoryItemList(meta, page);
      indexHtml = indexHtml.replace(
        "</head>",
        `  <script type="application/ld+json">${escapeJsonForScriptTag(categoryBreadcrumb)}</script>\n` +
          `  <script type="application/ld+json">${escapeJsonForScriptTag(categoryItemList)}</script>\n</head>`
      );

      indexHtml = indexHtml
        .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
        .replace(
          /<meta[^>]*name=["']description["'][^>]*>/,
          `<meta name="description" content="${escapeHtml(meta.description)}" />`
        )
        .replace(
          /<link[^>]*rel=["']canonical["'][^>]*>/,
          `<link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />`
        );

      // Hreflang: role pages only ("rol"), never city pages. A role label
      // genuinely has two URLs — /empleos/<rol> (CO) and /ve/empleos/<rol>
      // (VE), see ResolvedCategory's comment — so they're real regional
      // alternates of each other, same situation as "/"/"/ve" (§5.7 riesgo
      // 1) and the /dashboard pair fixed above. A city page has no sibling
      // at all (buildCategoryPath's comment: "/empleos/caracas" is the only
      // URL for Caracas) — emitting a self-only hreflang set there would be
      // exactly what seo-hreflang flags as Critical (missing reciprocal),
      // so this must stay gated on kind === "rol".
      if (category.kind === "rol") {
        const coRoleUrl = `${SITE_URL}${buildCategoryPath({ ...category, country: "CO" })}`;
        const veRoleUrl = `${SITE_URL}${buildCategoryPath({ ...category, country: "VE" })}`;
        const roleHreflangTags =
          `    <link rel="alternate" hreflang="es-CO" href="${coRoleUrl}" />\n` +
          `    <link rel="alternate" hreflang="es-VE" href="${veRoleUrl}" />\n` +
          `    <link rel="alternate" hreflang="x-default" href="${coRoleUrl}" />`;
        indexHtml = indexHtml.replace(
          /<link[^>]*rel=["']canonical["'][^>]*>/,
          (canonicalTag) => `${canonicalTag}\n${roleHreflangTags}`
        );
      }

      indexHtml = indexHtml
        .replace(
          /<meta[^>]*property=["']og:title["'][^>]*>/,
          `<meta property="og:title" content="${escapeHtml(meta.title)}" />`
        )
        .replace(
          /<meta[^>]*property=["']og:description["'][^>]*>/,
          `<meta property="og:description" content="${escapeHtml(meta.description)}" />`
        )
        .replace(
          /<meta[^>]*name=["']twitter:title["'][^>]*>/,
          `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`
        )
        .replace(
          /<meta[^>]*name=["']twitter:description["'][^>]*>/,
          `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`
        );

      // Empty category (0 real matches today): a valid 200, honest copy,
      // but noindex — same "thin content" mitigation docs/SEO-PLAN.md §6
      // already applies elsewhere, so an empty category never sits in
      // Google's index looking like a doorway page until it fills up.
      if (total === 0) {
        indexHtml = indexHtml
          .replace(/<meta[^>]*name=["']robots["'][^>]*>/i, "")
          .replace("</head>", `  <meta name="robots" content="noindex">\n</head>`);
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(indexHtml);
      return;
    }

    const session = await verifySession(req);
    const tier = session?.tier || "free";
    // Single-row fetch (getJobById), not the full cached corpus — this route
    // only ever needs one job's body. The light corpus below is still loaded
    // for the same-company count, which never needs description/requirements
    // — AND to gate `job`: getJobById() reads straight off `jobs` by primary
    // key, which would also return a row DISTINCT ON collapsed as a
    // non-canonical duplicate of some other row's (title, company, location)
    // group (older/losing published_at). Serving that id 200 with a full
    // JobPosting would resurrect exactly the soft-404/near-duplicate class
    // §1.18 fixed — only an id that's still the canonical pick in `jobs`
    // (the same deduped view the sitemap/links are built from) may resolve.
    const job = await getJobById(id);

    if (!id || !job) {
      // SEO Fase 5 (docs/SEO-PLAN.md §5.6): distinguish "this id existed and
      // expired" (410 — a real, permanent removal Google should trust and
      // drop, not keep re-checking) from "this id never existed" (plain
      // 404). `id` is always a real UUID here — the category branch above
      // already intercepted any non-UUID segment — so this only ever
      // queries wasJobPurged() with a well-formed jobId.
      if (id && (await wasJobPurged(id))) {
        res.writeHead(410, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Vacante ya no disponible | BuscoTrabajo</title><meta name="robots" content="noindex"></head><body><h1>Esta vacante ya no está disponible</h1><p>Fue retirada porque venció (más de 30 días publicada).</p><p><a href="/dashboard">Ver vacantes activas</a></p></body></html>'
        );
        return;
      }

      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Vacante no encontrada | BuscoTrabajo</title><meta name="robots" content="noindex"></head><body><h1>Vacante no encontrada</h1><p><a href="/dashboard">Ver todas las vacantes</a></p></body></html>'
      );
      return;
    }

    const [visible] = maskLockedFields([job], tier);
    // Free uniqueness signal for the JobPosting description (SEO Fase 9,
    // docs/SEO-PLAN.md §9.3): `jobs` is the light corpus already loaded above
    // (getJobsLightCached), so counting same-company rows is an in-memory
    // filter over cached data, not a new Postgres query.
    // Never for "Confidencial"/"Empresa confidencial" (COMPANY_SEARCH_EXCLUDED,
    // §78 above): those are undisclosed-employer placeholders shared by
    // thousands of unrelated postings, not one company — counting them would
    // fabricate a claim like "Confidencial tiene 2366 vacantes más activas"
    // (confirmed live via Search Console's Soft 404 report, 2026-08-09: this
    // exact pattern is what made real, non-thin job pages read as templated
    // near-duplicates to Google).
    const companyActiveCount =
      job.company && !COMPANY_SEARCH_EXCLUDED.has(job.company)
        ? await countCanonicalJobsByCompany(job.company)
        : undefined;

    let indexHtml: string;
    try {
      indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf-8");
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Server Error: build not found");
      return;
    }

    if (!isPubliclyDescribable(visible)) {
      // <48h and the paywall is active for this caller — same info an
      // anonymous visitor already gets on the dashboard's PaywallCard, no
      // more. Deliberately not indexed: there isn't enough public data yet
      // to justify a page a crawler should rank, and it'll get a full page
      // once it ages past the lock window (or PAYWALL_ENABLED is off, as
      // it is today, in which case this branch never triggers).
      const title = `Vacante reservada para suscriptores Pro | BuscoTrabajo`;
      indexHtml = indexHtml
        .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
        .replace(/<meta[^>]*name=["']robots["'][^>]*>/i, "")
        .replace("</head>", `  <meta name="robots" content="noindex">\n</head>`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(indexHtml);
      return;
    }

    const meta = buildJobMeta(visible);
    const jobPosting = buildJobPosting(visible, { companyActiveCount });

    // SEO fix (2026-08-04): this branch only ever rewrote <head> tags —
    // <div id="app"> stayed empty until React hydrated, so a crawler that
    // reads raw HTML (Googlebot's first, non-JS pass) saw a titled page with
    // zero body content and no <h1> at all, on the single highest-volume
    // page pattern in the site (~22k job pages). Mirrors the same "real
    // facts already computed above, embedded as plain HTML" pattern the
    // category branch (7b-cat) and /dashboard (7c) already use — same
    // buildJobDescription() call already used for the JobPosting JSON-LD
    // above, so this can never say something different from the structured
    // data next to it.
    const jobDetailSnippet = `<h1>${escapeHtml(visible.title)}</h1>\n<p>${escapeHtml(buildJobDescription(visible, { companyActiveCount }))}</p>`;
    indexHtml = indexHtml.replace(
      '<div id="app"></div>',
      `<div id="app">${jobDetailSnippet}</div>`
    );

    indexHtml = indexHtml
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
      .replace(
        /<meta[^>]*name=["']description["'][^>]*>/,
        `<meta name="description" content="${escapeHtml(meta.description)}" />`
      )
      .replace(
        /<link[^>]*rel=["']canonical["'][^>]*>/,
        `<link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />`
      )
      .replace(
        /<meta[^>]*property=["']og:title["'][^>]*>/,
        `<meta property="og:title" content="${escapeHtml(meta.title)}" />`
      )
      .replace(
        /<meta[^>]*property=["']og:description["'][^>]*>/,
        `<meta property="og:description" content="${escapeHtml(meta.description)}" />`
      )
      .replace(
        /<meta[^>]*name=["']twitter:title["'][^>]*>/,
        `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`
      )
      .replace(
        /<meta[^>]*name=["']twitter:description["'][^>]*>/,
        `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`
      )
      .replace(
        "</head>",
        `  <script type="application/ld+json">${escapeJsonForScriptTag(jobPosting)}</script>\n</head>`
      );

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(indexHtml);
    return;
  }

  // 7b-bis. GET /empresas, /ve/empresas (directory) and
  // /empresas/:slug, /ve/empresas/:slug (individual company) — same SSR
  // principle as /empleos/:id/:slug and the category branch above, applied
  // to a page type that was deliberately left CSR-only when it first
  // shipped (see docs/COMPANY-REPUTATION-PLAN.md §8: "sin SSR todavía —
  // es navegación de dashboard, no una fase SEO"). Confirmed live via the
  // real Search Console API (SEO-IMPROVEMENT-PLAN.md §1.15) that
  // `/empresas` was "unknown to Google" — this closes that gap the same
  // way §1.1 closed it for /dashboard.
  const isVeEmpresas = pathname === "/ve/empresas" || pathname.startsWith("/ve/empresas/");
  if (
    (pathname === "/empresas" || pathname.startsWith("/empresas/") || isVeEmpresas) &&
    method === "GET"
  ) {
    const basePath = isVeEmpresas ? pathname.slice(3) : pathname;
    const slug =
      basePath === "/empresas" ? null : basePath.slice("/empresas/".length).split("/")[0] || null;
    const requestCountry = isVeEmpresas ? "VE" : "CO";
    const countryConfig = getCountryConfig(requestCountry);

    let indexHtml: string;
    try {
      indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf-8");
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Server Error: build not found");
      return;
    }

    if (!slug) {
      // Directory hub — same PAGE_SIZE the client's first paint already
      // uses (CompaniesDirectory.tsx), so the SSR payload matches what
      // the client would have fetched anyway instead of a different page.
      const companyPage = await searchActiveCompanies(
        "",
        requestCountry,
        48,
        0,
        Object.keys(COMPANY_LOGO_DOMAINS)
      );
      const companies = companyPage.companies.map((item) => ({
        ...item,
        logoUrl: getCompanyLogoUrl(item.company)
      }));
      const total = companyPage.total;
      const heading = `Empresas en ${countryConfig.name}`;
      const meta = {
        title: `${heading} | BuscoTrabajo`,
        description: `Explora empresas con vacantes activas en ${countryConfig.name} en BuscoTrabajo — su reputación y ofertas.`,
        canonicalUrl: `${SITE_URL}${isVeEmpresas ? "/ve" : ""}/empresas`
      };

      const items = companies
        .map((c) => {
          const href = buildCompanyPath(c.company, requestCountry);
          return `<li><a href="${href}">${escapeHtml(c.company)}</a> — ${c.count} vacante${c.count === 1 ? "" : "s"}</li>`;
        })
        .join("\n");
      const ssrSnippet = `<h1>${escapeHtml(heading)}</h1>\n<nav aria-label="Empresas"><ul>\n${items}\n</ul></nav>`;
      indexHtml = indexHtml.replace('<div id="app"></div>', `<div id="app">${ssrSnippet}</div>`);

      const ssrCompaniesPayload = escapeJsonForScriptTag({
        companies,
        total,
        hasMore: 48 < total,
        country: requestCountry
      });
      indexHtml = indexHtml.replace(
        "</head>",
        `  <script>window.__SSR_COMPANIES__=${ssrCompaniesPayload};</script>\n</head>`
      );

      const companiesItemList = buildCompaniesItemList(heading, companies, requestCountry);
      indexHtml = indexHtml.replace(
        "</head>",
        `  <script type="application/ld+json">${escapeJsonForScriptTag(companiesItemList)}</script>\n</head>`
      );

      indexHtml = indexHtml
        .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
        .replace(
          /<meta[^>]*name=["']description["'][^>]*>/,
          `<meta name="description" content="${escapeHtml(meta.description)}" />`
        )
        .replace(
          /<link[^>]*rel=["']canonical["'][^>]*>/,
          `<link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />`
        );

      // Reciprocal hreflang — /empresas and /ve/empresas are two real,
      // genuinely different directories (each country's own companies),
      // same reasoning as /dashboard/ /ve/dashboard's pair.
      const coEmpresasUrl = `${SITE_URL}/empresas`;
      const veEmpresasUrl = `${SITE_URL}/ve/empresas`;
      const empresasHreflangTags =
        `    <link rel="alternate" hreflang="es-CO" href="${coEmpresasUrl}" />\n` +
        `    <link rel="alternate" hreflang="es-VE" href="${veEmpresasUrl}" />\n` +
        `    <link rel="alternate" hreflang="x-default" href="${coEmpresasUrl}" />`;
      indexHtml = indexHtml.replace(
        /<link[^>]*rel=["']canonical["'][^>]*>/,
        (canonicalTag) => `${canonicalTag}\n${empresasHreflangTags}`
      );

      indexHtml = indexHtml
        .replace(
          /<meta[^>]*property=["']og:title["'][^>]*>/,
          `<meta property="og:title" content="${escapeHtml(meta.title)}" />`
        )
        .replace(
          /<meta[^>]*property=["']og:description["'][^>]*>/,
          `<meta property="og:description" content="${escapeHtml(meta.description)}" />`
        )
        .replace(
          /<meta[^>]*name=["']twitter:title["'][^>]*>/,
          `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`
        )
        .replace(
          /<meta[^>]*name=["']twitter:description["'][^>]*>/,
          `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`
        );

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(indexHtml);
      return;
    }

    // Individual company page — exact same two-step resolution and
    // country-scoping rules as GET /api/companies/:slug (server.ts's own
    // API handler below), so SSR never disagrees with what the client
    // fetch would have shown.
    const companyNames = await getActiveCompanyNames(requestCountry);
    const companyName =
      (await resolveCompanyBySlug(slug)) ||
      resolveCompanyNameFromJobs(slug, companyNames.map((company) => ({ company })));
    if (!companyName) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Empresa no encontrada | BuscoTrabajo</title><meta name="robots" content="noindex"></head><body><h1>Empresa no encontrada</h1><p><a href="/dashboard">Ver todas las vacantes</a></p></body></html>'
      );
      return;
    }

    const matched = await getJobsPage({
      filters: { company: companyName, country: requestCountry },
      limit: 60,
      offset: 0,
      includeDetails: false
    });
    // A curated (resolveCompanyBySlug) company can resolve to a real name
    // that simply has no jobs in this country's scoped view — treated as
    // "not found here", never an empty-but-200 page, same rule the API
    // enforces (server.ts's /api/companies/:slug handler).
    if (matched.total === 0) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Empresa no encontrada | BuscoTrabajo</title><meta name="robots" content="noindex"></head><body><h1>Empresa no encontrada</h1><p><a href="/dashboard">Ver todas las vacantes</a></p></body></html>'
      );
      return;
    }
    // Never link a job in the visible SSR list that wouldn't also render
    // for the same anonymous visitor — same filter the sitemap/category
    // branches already apply.
    const page = maskLockedFields(matched.jobs, "free").filter(isPubliclyDescribable);

    const reputationMap = await getReputationForCompanies([companyName]);
    const reputation = reputationMap.get(companyName) || [];
    const meta = buildCompanyMeta(companyName, matched.total, requestCountry);

    const reputationItems = reputation
      .map((r) => {
        // Same source-label map and "score null -> Certificación" rule as
        // ReputationBadges.tsx (the client component rendering this same
        // data) — kept in sync manually since that map lives in a .tsx
        // file this server module doesn't import from.
        const label = REPUTATION_SOURCE_LABELS[r.source] || r.source;
        const scoreText = r.score !== null ? `${r.score} (${r.scoreScale})` : "Certificación";
        const reviewText = r.reviewCount !== null ? ` · ${r.reviewCount} reseñas` : "";
        return `<li>${escapeHtml(label)}: ${escapeHtml(scoreText)}${reviewText}</li>`;
      })
      .join("\n");
    const jobItems = page
      .map((job: any) => {
        const href = buildJobPath(job);
        return `<li><a href="${href}">${escapeHtml(job.title)}</a> — ${escapeHtml(job.location || countryConfig.name)}</li>`;
      })
      .join("\n");
    const ssrSnippet =
      `<h1>${escapeHtml(companyName)}</h1>\n` +
      (reputationItems ? `<ul aria-label="Reputación">\n${reputationItems}\n</ul>` : "") +
      `<nav aria-label="Vacantes"><ul>\n${jobItems}\n</ul></nav>`;
    indexHtml = indexHtml.replace('<div id="app"></div>', `<div id="app">${ssrSnippet}</div>`);

    const ssrCompanyPayload = escapeJsonForScriptTag({
      slug,
      country: requestCountry,
      companyName,
      logoUrl: getCompanyLogoUrl(companyName),
      reputation,
      jobs: page,
      total: matched.total
    });
    indexHtml = indexHtml.replace(
      "</head>",
      `  <script>window.__SSR_COMPANY__=${ssrCompanyPayload};</script>\n</head>`
    );

    const organizationSchema = buildCompanyOrganizationSchema(companyName, meta, reputation);
    indexHtml = indexHtml.replace(
      "</head>",
      `  <script type="application/ld+json">${escapeJsonForScriptTag(organizationSchema)}</script>\n</head>`
    );

    indexHtml = indexHtml
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
      .replace(
        /<meta[^>]*name=["']description["'][^>]*>/,
        `<meta name="description" content="${escapeHtml(meta.description)}" />`
      )
      .replace(
        /<link[^>]*rel=["']canonical["'][^>]*>/,
        `<link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />`
      )
      .replace(
        /<meta[^>]*property=["']og:title["'][^>]*>/,
        `<meta property="og:title" content="${escapeHtml(meta.title)}" />`
      )
      .replace(
        /<meta[^>]*property=["']og:description["'][^>]*>/,
        `<meta property="og:description" content="${escapeHtml(meta.description)}" />`
      )
      .replace(
        /<meta[^>]*name=["']twitter:title["'][^>]*>/,
        `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`
      )
      .replace(
        /<meta[^>]*name=["']twitter:description["'][^>]*>/,
        `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`
      );

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(indexHtml);
    return;
  }

  // 7c. GET /dashboard and /ve/dashboard — same SSR principle as
  // /empleos/:id/:slug above, applied to the dashboard itself. Confirmed via
  // Search Console (2026-07) that Google's own rendered snapshot of this
  // page showed "0 de 0 vacantes": the real listings only ever existed
  // behind the browser's fetch() to /api/jobs, and whatever rendering
  // budget Googlebot allotted ran out before that fetch resolved. This
  // injects the same first page /api/jobs would return directly into the
  // HTML, so a crawler sees real vacancies immediately regardless of
  // JS/API timing. React still owns the interactive experience —
  // createRoot().render() (not hydrateRoot) replaces this markup the
  // instant the bundle executes, so a real visitor sees at most a brief
  // flash of it, never a mismatch warning.
  const isVeDashboard = pathname === "/ve/dashboard";
  if ((pathname === "/dashboard" || isVeDashboard) && method === "GET") {
    // SEO fix (2026-08-04): this branch used to only ever handle the
    // unprefixed "/dashboard" (Colombia) — "/ve/dashboard" fell through to
    // the generic SPA static-file fallback further down, which serves
    // index.html completely unmodified. That meant Googlebot's first,
    // non-JS pass on /ve/dashboard saw Colombia's <title> and a
    // canonical of "https://buscotrabajo.co/" — telling Google to treat
    // Venezuela's own dashboard as a duplicate of the homepage instead of
    // indexing it, until Dashboard.tsx's usePageMeta() effect corrected it
    // client-side. Extending this branch (same head-tag-rewrite pattern
    // job/category pages already use, filtered by the real country) closes
    // that gap the same way it was already closed for /dashboard's job
    // list content in the original session.
    const country = isVeDashboard ? "VE" : "CO";
    const countryConfig = getCountryConfig(country);

    // Note on tier: verifySession() reads the Authorization header, which a
    // plain page navigation never carries (only the client's own later
    // fetch() calls attach it) — so `tier` here is always "free" regardless
    // of who's actually visiting. That's fine for the crawler-facing
    // markup below (a crawler is anonymous anyway) and is exactly why the
    // embedded JSON further down is only ever consumed client-side for an
    // anonymous, default-filter first load — see Dashboard.tsx's comment
    // where it reads window.__SSR_JOBS__. A real Pro session always
    // re-fetches for real once its token resolves, same as it already did
    // before this change.
    const session = await verifySession(req);
    const tier = session?.tier || "free";
    const result = await getJobsPage({
      filters: { country },
      limit: 24,
      offset: 0,
      includeDetails: true
    });
    const visibleJobs = maskLockedFields(result.jobs, tier);
    // Filtered by the real requested country — without this the embedded
    // window.__SSR_JOBS__ payload would mix both countries, which
    // Dashboard.tsx's SSR shortcut would then trust verbatim on first
    // paint — exactly the CO/VE mixing this app's country separation
    // exists to prevent.
    // Reputation attached here too (not just /api/jobs) so the very first
    // anonymous paint — which reads window.__SSR_JOBS__ below instead of
    // re-fetching /api/jobs, see Dashboard.tsx — can show it immediately
    // if that first page's selected job happens to have it.
    const firstPage = await attachReputation(visibleJobs);
    const total = result.total;
    const hasMore = total > firstPage.length;

    let indexHtml: string;
    try {
      indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf-8");
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Server Error: build not found");
      return;
    }

    // Locked jobs (isLocked, only possible if PAYWALL_ENABLED is ever
    // turned back on) never had company/location/url unmasked — no link to
    // build, so they're skipped here entirely rather than linked with
    // placeholder data. The JSON embed below keeps them (with nulled
    // fields, same as /api/jobs) since the client already knows how to
    // render PaywallCard for those.
    const items = firstPage
      .filter((job: any) => isPubliclyDescribable(job))
      .map((job: any) => {
        const href = buildJobPath(job);
        const title = escapeHtml(job.title);
        const company = escapeHtml(job.company || "Confidencial");
        const location = escapeHtml(job.location || countryConfig.name);
        const source = escapeHtml(job.source || "");
        return `<li><a href="${href}">${title}</a> — ${company} · ${location} · ${source}</li>`;
      })
      .join("\n");

    // <h1> added alongside the existing nav (2026-08-04 fix, see comment
    // above) — the baseline drift capture (Fase 2) showed this page's raw
    // HTML had zero heading elements. Real per-country text, mirrored
    // verbatim by Dashboard.tsx's own sr-only <h1> so the DOM never
    // disagrees with itself once React replaces this markup.
    const dashboardHeading = `Vacantes de Empleo en ${countryConfig.name}`;
    const ssrSnippet = `<h1>${escapeHtml(dashboardHeading)}</h1>\n<nav aria-label="Vacantes recientes"><ul>\n${items}\n</ul></nav>`;
    indexHtml = indexHtml.replace('<div id="app"></div>', `<div id="app">${ssrSnippet}</div>`);

    // Head tags: same real facts Dashboard.tsx's usePageMeta() already
    // computes and applies client-side post-hydration (src/lib/use-page-
    // meta.ts) — this just makes them true in the raw HTML too, instead of
    // only after JS runs.
    const dashboardTitle = `Vacantes de Empleo en ${countryConfig.name} | BuscoTrabajo`;
    const dashboardDescription = `Explora vacantes actualizadas de LinkedIn, Computrabajo${country === "CO" ? ", Elempleo" : ""} y más en ${countryConfig.name}, filtradas y sin duplicados. Gratis para vacantes con más de 48h publicadas.`;
    const dashboardCanonical = `${SITE_URL}${pathname}`;
    indexHtml = indexHtml
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(dashboardTitle)}</title>`)
      .replace(
        /<meta[^>]*name=["']description["'][^>]*>/,
        `<meta name="description" content="${escapeHtml(dashboardDescription)}" />`
      )
      .replace(
        /<link[^>]*rel=["']canonical["'][^>]*>/,
        `<link rel="canonical" href="${escapeHtml(dashboardCanonical)}" />`
      );

    // Self + reciprocal + x-default hreflang — same trio "/" and "/ve"
    // already carry (§5.7 riesgo 1). Needed here specifically because this
    // change just gave "/ve/dashboard" its own self-canonical for the first
    // time (it used to canonicalize to "/", so it never competed with
    // "/dashboard" for ranking); without this pair Google would see two
    // near-duplicate, both-self-canonical pages with nothing declaring them
    // as regional alternates of each other — trading the old duplicate-
    // content problem for a new one instead of fixing it.
    const dashboardHreflangTags =
      `    <link rel="alternate" hreflang="es-CO" href="${SITE_URL}/dashboard" />\n` +
      `    <link rel="alternate" hreflang="es-VE" href="${SITE_URL}/ve/dashboard" />\n` +
      `    <link rel="alternate" hreflang="x-default" href="${SITE_URL}/dashboard" />`;
    indexHtml = indexHtml.replace(
      /<link[^>]*rel=["']canonical["'][^>]*>/,
      (canonicalTag) => `${canonicalTag}\n${dashboardHreflangTags}`
    );

    indexHtml = indexHtml
      .replace(
        /<meta property="og:locale" content="[^"]*" \/>/,
        `<meta property="og:locale" content="${country === "VE" ? "es_VE" : "es_CO"}" />`
      )
      .replace(
        /<meta[^>]*property=["']og:title["'][^>]*>/,
        `<meta property="og:title" content="${escapeHtml(dashboardTitle)}" />`
      )
      .replace(
        /<meta[^>]*property=["']og:description["'][^>]*>/,
        `<meta property="og:description" content="${escapeHtml(dashboardDescription)}" />`
      )
      .replace(
        /<meta[^>]*name=["']twitter:title["'][^>]*>/,
        `<meta name="twitter:title" content="${escapeHtml(dashboardTitle)}" />`
      )
      .replace(
        /<meta[^>]*name=["']twitter:description["'][^>]*>/,
        `<meta name="twitter:description" content="${escapeHtml(dashboardDescription)}" />`
      );

    // Lets the client skip its own redundant first fetch to /api/jobs when
    // nothing (auth, filters) has changed what it would ask for — see the
    // safety notes above and in Dashboard.tsx. escapeJsonForScriptTag (not
    // plain JSON.stringify) matters here for the same reason it does on
    // the /empleos/ route: job titles are scraped, untrusted text.
    // `country` stamped alongside the jobs so the client's gate
    // (Dashboard.tsx) can check "is this payload for the country I'm
    // actually mounted at" directly, instead of inferring it from which
    // exact-match route served the response — a visitor whose stored
    // country preference differs from the URL they first hit can still
    // land on this component with a different `country` than the request
    // that embedded this script tag (see Dashboard.tsx's comment), so the
    // payload has to describe itself rather than be trusted by pathname.
    const ssrJobsPayload = escapeJsonForScriptTag({ jobs: firstPage, total, hasMore, country });
    indexHtml = indexHtml.replace(
      "</head>",
      `  <script>window.__SSR_JOBS__=${ssrJobsPayload};</script>\n</head>`
    );

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(indexHtml);
    return;
  }

  // 7d. Sitemap (SEO Fase 2, ver docs/SEO-PLAN.md). /sitemap.xml — the URL
  // robots.txt already points at — is now an index instead of a flat list,
  // referencing the static marketing pages (unchanged, still the source
  // file at static/sitemap.xml) and a dynamic one for every job. All three
  // routes intercept ahead of the static-file fallback below, which would
  // otherwise just serve the old flat public/sitemap.xml verbatim (it still
  // exists on disk — this only changes what's served at that URL).
  if (pathname === "/sitemap.xml" && method === "GET") {
    const xml = buildSitemapIndexXml([
      "https://buscotrabajo.co/sitemap-pages.xml",
      "https://buscotrabajo.co/sitemap-jobs.xml",
      "https://buscotrabajo.co/sitemap-categories.xml"
    ]);
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    res.end(xml);
    return;
  }

  if (pathname === "/sitemap-pages.xml" && method === "GET") {
    // The static marketing-page list itself didn't change — just serving
    // the already-built file (public/sitemap.xml, copied verbatim from
    // static/sitemap.xml at build time) under its new URL instead of
    // duplicating that list here.
    let staticSitemap: string;
    try {
      staticSitemap = fs.readFileSync(path.join(PUBLIC_DIR, "sitemap.xml"), "utf-8");
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Server Error: build not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    res.end(staticSitemap);
    return;
  }

  if (pathname === "/sitemap-jobs.xml" && method === "GET") {
    // Always the public (tier: "free") view, same as any anonymous
    // crawler — a sitemap has no session to resolve a real tier from
    // anyway, and it must never list a page (see isPubliclyDescribable
    // inside buildJobsSitemapXml) it wouldn't also show that visitor.
    const jobs = await getJobsLightCached(50000);
    const visibleJobs = maskLockedFields(jobs, "free");
    const xml = buildJobsSitemapXml(visibleJobs);
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    res.end(xml);
    return;
  }

  if (pathname === "/sitemap-categories.xml" && method === "GET") {
    // Static taxonomy (CITY_OPTIONS + DEFAULT_ROLES_200) — no DB query
    // needed, unlike sitemap-jobs.xml above.
    const xml = buildCategoriesSitemapXml();
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    res.end(xml);
    return;
  }

  // 5b. Home ("/" and "/ve") — SEO Fase 9 (docs/SEO-PLAN.md §9.3/§5.7 risk 1).
  // Neither route had server-side head injection before this: both served
  // the exact same static index.html, which (a) hardcoded the Colombia
  // canonical on "/ve" too — telling Google "/ve" is a duplicate to
  // consolidate into "/", the opposite of what's wanted — and (b) had no
  // hreflang linking the two regional variants at all. This only rewrites
  // <head> tags (title/description/og/canonical/hreflang); it does not
  // attempt full SSR of the landing content (§5.7 risk 2, still open).
  if ((pathname === "/" || pathname === "/ve") && method === "GET") {
    const isVe = pathname === "/ve";
    let indexHtml: string;
    try {
      indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf-8");
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Server Error: build not found");
      return;
    }

    // SEO fix (2026-08-04): this route only ever rewrote <head> tags (the
    // §5.7 "no SSR for the landing" risk docs/SEO-PLAN.md already flags as
    // known/deferred) — <div id="app"> stayed completely empty until
    // HeroDemo.tsx mounted, so the baseline drift capture (Fase 2) showed
    // zero heading elements on both "/" and "/ve". This does not attempt
    // the full landing SSR that risk defers — only the same real <h1> text
    // HeroDemo.tsx already renders client-side, verbatim, so raw HTML and
    // post-hydration DOM never disagree.
    const heroCountryConfig = getCountryConfig(isVe ? "VE" : "CO");
    const heroHeading = `Encuentra todas las vacantes de ${heroCountryConfig.name} en un solo lugar`;
    indexHtml = indexHtml.replace(
      '<div id="app"></div>',
      `<div id="app"><h1>${escapeHtml(heroHeading)}</h1></div>`
    );

    const selfUrl = isVe ? `${SITE_URL}/ve` : `${SITE_URL}/`;
    indexHtml = indexHtml.replace(
      /<link[^>]*rel=["']canonical["'][^>]*>/,
      `<link rel="canonical" href="${escapeHtml(selfUrl)}" />`
    );

    // Self + reciprocal + x-default — the three checks seo-hreflang (the
    // claude-seo skill this session cross-referenced) flags first: a
    // missing self-referencing tag or a one-directional pair (A→B without
    // B→A) are both "Critical" there. x-default points at "/" (Colombia)
    // since it's this site's original/primary market, not a country guess.
    const hreflangTags =
      `    <link rel="alternate" hreflang="es-CO" href="${SITE_URL}/" />\n` +
      `    <link rel="alternate" hreflang="es-VE" href="${SITE_URL}/ve" />\n` +
      `    <link rel="alternate" hreflang="x-default" href="${SITE_URL}/" />`;
    indexHtml = indexHtml.replace(
      /<link[^>]*rel=["']canonical["'][^>]*>/,
      (canonicalTag) => `${canonicalTag}\n${hreflangTags}`
    );

    if (isVe) {
      // Real, already-established facts only (AGENTS.md #5): VE's own
      // source list (SOURCES_BY_COUNTRY.VE — 7 sources, not CO's 10; no
      // Elempleo/Magneto/Workana coverage for Venezuela today), never a
      // find-and-replace of the Colombia copy. Without this, Googlebot's
      // first (non-JS) look at "/ve" saw a title/description that literally
      // said "Colombia" — a content-parity problem, not just a linking one.
      const veTitle = "BuscoTrabajo — Vacantes de Empleo en Venezuela, Todas en un Solo Lugar";
      const veDescription =
        "Encuentra vacantes de empleo en Venezuela de LinkedIn, Computrabajo, Torre, GetOnBoard y otros portales, deduplicadas y verificadas en un solo dashboard. Gratis para vacantes con más de 48h publicadas.";
      indexHtml = indexHtml
        .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(veTitle)}</title>`)
        .replace(
          /<meta\s+name=["']description["'][^>]*\/>/,
          `<meta name="description" content="${escapeHtml(veDescription)}" />`
        )
        .replace(
          /<meta property="og:locale" content="[^"]*" \/>/,
          `<meta property="og:locale" content="es_VE" />`
        )
        .replace(
          /<meta property="og:title" content="[^"]*" \/>/,
          `<meta property="og:title" content="${escapeHtml(veTitle)}" />`
        )
        .replace(
          /<meta\s+property=["']og:description["'][^>]*\/>/,
          `<meta property="og:description" content="${escapeHtml(veDescription)}" />`
        );
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(indexHtml);
    return;
  }

  // 6. Static Files (HTML, CSS, JS) + SPA fallback. Any path without a file
  // extension is a client-side route (/dashboard, /pricing, /legal/terminos,
  // etc.) — those must serve index.html so React Router can mount and take
  // over, otherwise a refresh or direct link on any non-"/" route 404s.
  const hasFileExtension = path.extname(pathname) !== "";
  let filePath = path.join(PUBLIC_DIR, hasFileExtension ? pathname : "index.html");

  const ext = path.extname(filePath);
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    // sitemap.xml was falling back to text/plain (the default below), which
    // is exactly the kind of thing Search Console's sitemap validator
    // rejects as "invalid" — robots.txt is correctly text/plain already.
    ".xml": "application/xml",
    ".txt": "text/plain"
  };

  const contentType = mimeTypes[ext] || "text/plain";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<h1>404 Not Found</h1>");
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
}

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 JOB RADAR DASHBOARD RUNNING AT: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
  console.log(
    "ℹ️  El scraping corre fuera de este proceso (GitHub Actions, scripts/run-scrape-tick.ts) — el servidor web nunca scrapea."
  );
});
