import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  getJobsCached,
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
  resolveCompanyBySlug,
  ReputationEntry
} from "./db/company-reputation-repository.js";
import {
  upsertCompanyReview,
  deleteCompanyReview,
  getCompanyReviews
} from "./db/company-reviews-repository.js";
import { applyJobFilters, sortByPreferredRoles, JobFilterParams } from "./lib/job-filters.js";
import { getCompanyLogoUrl } from "./data/company-logo-domains.js";
import { getCountryConfig } from "./countries/index.js";
import {
  escapeHtml,
  escapeJsonForScriptTag,
  isPubliclyDescribable,
  buildJobMeta,
  buildJobPosting,
  buildJobPath,
  buildJobsSitemapXml,
  buildSitemapIndexXml,
  isUuid,
  resolveCategorySlug,
  buildCategoryMeta,
  buildCategoriesSitemapXml,
  resolveCompanyNameFromJobs
} from "./lib/job-seo.js";
import { verifySession } from "./auth/verify-session.js";
import { startPaymentCheckout } from "./payments/checkout.js";
import { handleWompiWebhook } from "./payments/webhook.js";
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
async function attachReputation<T extends { company: string }>(
  jobs: T[]
): Promise<(T & { reputation: ReputationEntry[] })[]> {
  const reputationMap = await getReputationForCompanies(jobs.map((j) => j.company));
  return jobs.map((j) => ({ ...j, reputation: reputationMap.get(j.company) || [] }));
}

// GET /api/companies/search backing (Fase E4) — "Confidencial"/"Empresa
// confidencial" are the fallback placeholders many sources use for an
// undisclosed employer (~1,536 postings combined in the real corpus), never
// a real company, so they're excluded before counting the same way
// getComputrabajoDiscoveryCandidates() already excludes "Confidencial".
// company_reputation_alias's exact-string convention applies here too — no
// fuzzy merge of near-duplicate names (regla 5 de AGENTS.md).
const COMPANY_SEARCH_EXCLUDED = new Set(["Confidencial", "Empresa confidencial"]);

export interface CompanySearchResult {
  company: string;
  count: number;
  // Only set for the small hand-verified subset in company-logo-domains.ts
  // (see its header comment) — null for every other company, which keeps
  // rendering its plain-initial avatar.
  logoUrl: string | null;
}

export interface CompanySearchPage {
  companies: CompanySearchResult[];
  total: number;
}

// offset/limit (not just a fixed top-N) so /empresas (Fase E5, the company
// directory) can page through all 5,525+ distinct companies via infinite
// scroll, same pattern as GET /api/jobs — this same function also still
// backs the small single-page FilterBar dropdown from Fase E4, which just
// never passes an offset.
function searchCompanies(
  jobs: { company?: string }[],
  query: string,
  limit: number,
  offset: number
): CompanySearchPage {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    if (!job.company || COMPANY_SEARCH_EXCLUDED.has(job.company)) continue;
    counts.set(job.company, (counts.get(job.company) || 0) + 1);
  }

  const q = query.trim().toLowerCase();
  let entries = Array.from(counts.entries());
  // Under 2 chars: too short to narrow anything meaningfully — return the
  // top companies by vacancy count instead, so the UI has suggestions to
  // show before the caller has typed enough to filter.
  if (q.length >= 2) {
    entries = entries.filter(([name]) => name.toLowerCase().includes(q));
  }
  // Stable tiebreak (alphabetical) on equal counts — without it, ties order
  // by Map insertion (corpus iteration order), which can reshuffle between
  // two page requests if getJobsCached()'s TTL refreshes in between,
  // silently duplicating or skipping a company across an infinite-scroll
  // page boundary.
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    companies: entries
      .slice(offset, offset + limit)
      .map(([company, count]) => ({ company, count, logoUrl: getCompanyLogoUrl(company) })),
    total: entries.length
  };
}

// A route's own validation always returns its own specific, safe 400
// before ever reaching a catch block — so whatever lands here is either a
// JSON.parse SyntaxError (generic message, safe to show verbatim) or an
// unexpected failure from a DB/network call. The latter's real message
// (a raw pg error can name a table, column or constraint) is never sent to
// the client — only logged server-side, where it's actually actionable.
function respondToUnexpectedError(
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

// General cap on the whole /api/* surface (scraping-scale abuse, blind
// endpoint hammering) — the per-route limits below (sensitive writes) are
// tighter and checked separately inside those routes.
const GENERAL_API_RATE_LIMIT = 120;
const GENERAL_API_RATE_WINDOW_MS = 60 * 1000;
// For endpoints that write data or cost real money/quota to call (reviews,
// checkout, triggering a scrape) — a much lower bar than the general read cap.
const SENSITIVE_RATE_LIMIT = 10;
const SENSITIVE_RATE_WINDOW_MS = 60 * 1000;

function checkSensitiveRateLimit(
  ip: string,
  res: http.ServerResponse,
  routeLabel: string
): boolean {
  if (checkRateLimit(ip, SENSITIVE_RATE_LIMIT, SENSITIVE_RATE_WINDOW_MS)) return true;
  recordSuspiciousEvent(ip, `rate-limit ${routeLabel}`);
  res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
  res.end(JSON.stringify({ error: "Demasiadas solicitudes — intenta de nuevo en un minuto." }));
  return false;
}

// Native Node HTTP Server
const server = http.createServer(async (req, res) => {
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
    !checkRateLimit(clientIp, GENERAL_API_RATE_LIMIT, GENERAL_API_RATE_WINDOW_MS)
  ) {
    recordSuspiciousEvent(clientIp, `rate-limit general ${pathname}`);
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
    res.end(JSON.stringify({ error: "Demasiadas solicitudes — intenta de nuevo en un minuto." }));
    return;
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
  //    Filters + pagination happen here, in Node, against the full active
  //    corpus (never in the browser) — as the corpus grows past a few
  //    thousand rows, shipping everything to the client on every visit stops
  //    being viable, so only the requested page is ever serialized out.
  if (pathname === "/api/jobs" && method === "GET") {
    const session = await verifySession(req);
    const tier = session?.tier || "free";
    // 50k comfortably covers the corpus for years of growth at current
    // scraping cadence — this is a fetch-into-Node cap, not a limit on what
    // reaches the browser (that's the separate limit/offset pagination below).
    const jobs = await getJobsCached(50000);
    const visibleJobs = maskLockedFields(jobs, tier);

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
    let filtered = applyJobFilters(visibleJobs, filters);
    // A manual role filter (checked in FilterBar) is an explicit, stronger
    // signal than the soft onboarding preference — only reorder by
    // preference when the caller didn't already filter by role themselves.
    if (!filters.roles && session?.preferredRoles) {
      filtered = sortByPreferredRoles(filtered, session.preferredRoles);
    }

    const limit = Math.min(Math.max(parseInt(params.get("limit") || "24", 10) || 24, 1), 100);
    const offset = Math.max(parseInt(params.get("offset") || "0", 10) || 0, 0);
    const page = await attachReputation(filtered.slice(offset, offset + limit));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jobs: page,
        count: page.length,
        total: filtered.length,
        hasMore: offset + limit < filtered.length
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
    const jobs = await getJobsCached(50000);
    const job = jobs.find((j: any) => j.jobId === id);
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
    const jobs = await getJobsCached(50000);
    // Country-scoped same as GET /api/jobs (country = $1 OR country IS NULL)
    // — a company directory browsed from Venezuela must never surface a
    // Colombia-only employer, and vice versa (remote-hiring companies still
    // show in both, same as remote jobs do).
    const countryJobs = country ? applyJobFilters(jobs, { country }) : jobs;
    const { companies, total } = searchCompanies(countryJobs, q, limit, offset);

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
    const jobs = await getJobsCached(50000);
    const visibleJobs = maskLockedFields(jobs, tier);
    // Same country scoping as the search endpoint above, applied BEFORE
    // resolution — resolveCompanyNameFromJobs()'s fallback only matches
    // against this country-scoped view, so a slug that only resolves via a
    // job from the other country correctly falls through to the 404 below
    // instead of resolving into a company page with zero jobs to show.
    const countryJobs = country ? applyJobFilters(visibleJobs, { country }) : visibleJobs;

    const companyName =
      (await resolveCompanyBySlug(slug)) || resolveCompanyNameFromJobs(slug, countryJobs);
    if (!companyName) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Empresa no encontrada" }));
      return;
    }

    const matched = applyJobFilters(countryJobs, { company: companyName });
    // resolveCompanyBySlug() (the curated Merco/GPTW alias table) is
    // country-agnostic, so it can resolve a real companyName that simply
    // has no jobs in this country's scoped view (e.g. a Colombia-only
    // curated company hit while browsing from /ve/empresas). Treating that
    // as "not found here" — not an empty-but-200 company page — is what
    // keeps the two countries' directories from ever cross-linking.
    if (country && matched.length === 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Empresa no encontrada" }));
      return;
    }
    const page = matched.slice(0, 60);
    // Independent of each other (both only need companyName, already
    // resolved above) — run concurrently instead of one full DB round trip
    // after another. Added getCompanyReviews here in Fase E2 as a third
    // sequential await, which measurably slowed this endpoint; this
    // parallelizes it back down to one round trip's worth of latency.
    const [reputationMap, userReviews] = await Promise.all([
      getReputationForCompanies([companyName]),
      getCompanyReviews(companyName, session?.id || null)
    ]);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        companyName,
        logoUrl: getCompanyLogoUrl(companyName),
        reputation: reputationMap.get(companyName) || [],
        userReviews,
        jobs: page,
        total: matched.length
      })
    );
    return;
  }

  // 4a-ter. POST/DELETE /api/companies/:slug/reviews — native BuscoTrabajo
  // reviews (Fase E2, distinto de la reputación externa agregada arriba).
  // Requiere sesión real (isAuthenticated basta, sin depender de onboarding
  // completado) — nunca un id ni un companyName de confianza ciega del
  // cliente más allá del slug de la URL, que se resuelve con la misma
  // regla de dos pasos que el GET (alias curado → corpus de vacantes real).
  // Un slug que no resuelve a ninguna empresa real es 404: no se puede
  // reseñar algo que no existe en el sistema.
  if (
    pathname.startsWith("/api/companies/") &&
    pathname.endsWith("/reviews") &&
    (method === "POST" || method === "DELETE")
  ) {
    const slug = pathname.slice("/api/companies/".length, -"/reviews".length);

    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    if (!checkSensitiveRateLimit(clientIp, res, "POST/DELETE /reviews")) return;

    const jobs = await getJobsCached(50000);
    const visibleJobs = maskLockedFields(jobs, session.tier);
    const companyName =
      (await resolveCompanyBySlug(slug)) || resolveCompanyNameFromJobs(slug, visibleJobs);
    if (!companyName) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Empresa no encontrada" }));
      return;
    }

    if (method === "DELETE") {
      await deleteCompanyReview(session.id, companyName);
      const userReviews = await getCompanyReviews(companyName, session.id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ userReviews }));
      return;
    }

    let bodyText = "";
    req.on("data", (chunk) => {
      bodyText += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(bodyText || "{}");
        const rating = parsed.rating;
        if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "rating debe ser un entero entre 1 y 5" }));
          return;
        }

        let comment: string | null = null;
        if (parsed.comment !== undefined && parsed.comment !== null) {
          if (typeof parsed.comment !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "comment debe ser texto" }));
            return;
          }
          const trimmed = parsed.comment.trim();
          if (trimmed.length > 1000) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "comment no puede superar 1000 caracteres" }));
            return;
          }
          comment = trimmed.length > 0 ? trimmed : null;
        }

        await upsertCompanyReview({ userId: session.id, companyName, rating, comment });
        const userReviews = await getCompanyReviews(companyName, session.id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ userReviews }));
      } catch (e: any) {
        respondToUnexpectedError(
          res,
          e,
          "POST /api/companies/:slug/reviews",
          "No se pudo guardar la reseña."
        );
      }
    });
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
        preferredRoles: session.preferredRoles
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
  //    Wompi Web Checkout real (sandbox) para el plan Pro mensual.
  if (pathname === "/api/checkout/start" && method === "POST") {
    const session = await verifySession(req);
    if (!session) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autenticado" }));
      return;
    }
    if (!checkSensitiveRateLimit(clientIp, res, "POST /api/checkout/start")) return;

    try {
      const checkout = await startPaymentCheckout({ userId: session.id, userEmail: session.email });
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

  // 7b. GET /empleos/:id/:slug — server-rendered per-job page for
  // crawlers (SEO Fase 1, ver docs/SEO-PLAN.md). The `:slug` segment is
  // purely decorative for click-through readability; matching is always by
  // `:id` (a jobId, stable), so a stale slug from a since-edited title never
  // 404s — the canonical tag below just points at the freshly computed one.
  // Reuses the same getJobsCached()+maskLockedFields() the public
  // /api/jobs/:id route already uses, so a crawler (unauthenticated, same
  // as an anonymous visitor) can never see more than a real visitor would —
  // no separate cloaking-risk logic to keep in sync if PAYWALL_ENABLED is
  // ever turned back on.
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
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Categoría no encontrada | BuscoTrabajo</title><meta name="robots" content="noindex"></head><body><h1>Categoría no encontrada</h1><p><a href="/dashboard">Ver todas las vacantes</a></p></body></html>'
        );
        return;
      }

      const jobs = await getJobsCached(50000);
      const visibleJobs = maskLockedFields(jobs, "free");
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
      const matched = applyJobFilters(visibleJobs, filterParams).filter(isPubliclyDescribable);
      const total = matched.length;
      const page = matched.slice(0, 60);

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
          const location = escapeHtml(job.location || getCountryConfig(job.country || category.country).name);
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
    const jobs = await getJobsCached(50000);
    const job = jobs.find((j: any) => j.jobId === id);

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
    const jobPosting = buildJobPosting(visible);

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

  // 7c. GET /dashboard — same SSR principle as /empleos/:id/:slug above,
  // applied to the dashboard itself. Confirmed via Search Console (2026-07)
  // that Google's own rendered snapshot of this page showed "0 de 0
  // vacantes": the real listings only ever existed behind the browser's
  // fetch() to /api/jobs, and whatever rendering budget Googlebot allotted
  // ran out before that fetch resolved. This injects the same first page
  // /api/jobs would return directly into the HTML, so a crawler sees real
  // vacancies immediately regardless of JS/API timing. React still owns the
  // interactive experience — createRoot().render() (not hydrateRoot)
  // replaces this markup the instant the bundle executes, so a real visitor
  // sees at most a brief flash of it, never a mismatch warning.
  if (pathname === "/dashboard" && method === "GET") {
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
    const jobs = await getJobsCached(50000);
    const visibleJobs = maskLockedFields(jobs, tier);
    // This exact-match branch only ever serves the unprefixed "/dashboard"
    // URL — Colombia by every other country-detection convention in this
    // app (see country-context.ts) — never "/ve/dashboard" (no SSR branch
    // exists for that path, see the comment above this route). Without this
    // filter the embedded window.__SSR_JOBS__ payload mixed both countries,
    // which Dashboard.tsx's SSR shortcut would then trust verbatim on first
    // paint — exactly the CO/VE mixing this app's country separation exists
    // to prevent.
    const allFiltered = applyJobFilters(visibleJobs, { country: "CO" });
    // Reputation attached here too (not just /api/jobs) so the very first
    // anonymous paint — which reads window.__SSR_JOBS__ below instead of
    // re-fetching /api/jobs, see Dashboard.tsx — can show it immediately
    // if that first page's selected job happens to have it.
    const firstPage = await attachReputation(allFiltered.slice(0, 24));
    const total = allFiltered.length;
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
        const location = escapeHtml(job.location || "Colombia");
        const source = escapeHtml(job.source || "");
        return `<li><a href="${href}">${title}</a> — ${company} · ${location} · ${source}</li>`;
      })
      .join("\n");

    const ssrSnippet = `<nav aria-label="Vacantes recientes"><ul>\n${items}\n</ul></nav>`;
    indexHtml = indexHtml.replace('<div id="app"></div>', `<div id="app">${ssrSnippet}</div>`);

    // Lets the client skip its own redundant first fetch to /api/jobs when
    // nothing (auth, filters) has changed what it would ask for — see the
    // safety notes above and in Dashboard.tsx. escapeJsonForScriptTag (not
    // plain JSON.stringify) matters here for the same reason it does on
    // the /empleos/ route: job titles are scraped, untrusted text.
    const ssrJobsPayload = escapeJsonForScriptTag({ jobs: firstPage, total, hasMore });
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
    const jobs = await getJobsCached(50000);
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
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 JOB RADAR DASHBOARD RUNNING AT: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
  console.log(
    "ℹ️  El scraping corre fuera de este proceso (GitHub Actions, scripts/run-scrape-tick.ts) — el servidor web nunca scrapea."
  );
});
