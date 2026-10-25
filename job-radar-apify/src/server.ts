import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import dotenv from "dotenv";
import {
  getJobsPage,
  getJobById,
  getHomeJobCounts,
  getHomeCompanies,
  getSupersedingTarget,
  isJobExpiredInPlace,
  getActiveCompanyNames,
  getCompanyGroup,
  searchActiveCompanies,
  maskLockedFields,
  updateUserName,
  updateUserPreferredRoles,
  getTransactionsForUser,
  streamCanonicalSitemapJobs,
  SitemapStreamAbortedError
} from "./db/job-repository.js";
import { markRoleForImmediateRescan } from "./db/scheduler-repository.js";
import { wasJobPurged } from "./db/indexing-repository.js";
import {
  getReputationForCompanies,
  resolveCompanyBySlug
} from "./db/company-reputation-repository.js";
import type { ReputationEntry } from "./db/company-reputation-repository.js";
import type { JobFilterParams } from "./lib/job-filters.js";
import { isPlaceholderEmployer } from "./lib/company-key.js";
import { COMPANY_LOGO_DOMAINS, getCompanyLogoUrl } from "./data/company-logo-domains.js";
import { getOfficialCareersUrl } from "./data/official-careers-links.js";
import { getCountryConfig } from "./countries/index.js";
import { PAYWALL_ENABLED } from "./config.js";
import { getHomeCities, isHomeCountry, type HomeData } from "./lib/home-stats.js";
import {
  escapeHtml,
  escapeJsonForScriptTag,
  isPubliclyDescribable,
  buildJobMeta,
  buildJobPosting,
  buildJobPageBody,
  buildJobPagePayload,
  isGoogleEligiblePage,
  buildJobPath,
  buildJobSitemapEntry,
  JOBS_SITEMAP_HEADER,
  JOBS_SITEMAP_FOOTER,
  buildSitemapIndexXml,
  isUuid,
  resolveCategorySlug,
  RETIRED_ROLE_SLUGS,
  buildCategoryMeta,
  buildCategoryInsights,
  buildCategoryInternalLinks,
  buildRelatedCityLinks,
  buildCategorySectionHeadings,
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
import { handleRunsRoute, isRunsRoute } from "./server/routes/runs.js";
import {
  handleAgentReadinessRoute,
  sendStructuredApiError
} from "./server/routes/agent-readiness.js";
import {
  DISCOVERY_LINKS,
  NOT_FOUND_HTML,
  NOT_FOUND_MARKDOWN,
  getHomeContent,
  injectPublicContent,
  injectRouteMeta,
  renderContentMarkdown,
  wantsMarkdown
} from "./lib/agent-readiness.js";
import { ROUTE_META, companiesDirectoryMeta, dashboardDescription } from "./lib/page-meta.js";
import {
  SOURCE_DIRECTORY_SLUGS,
  SOURCES_PAGE_DESCRIPTION,
  SOURCES_PAGE_DISCLOSURES,
  SOURCES_PAGE_HEADING,
  SOURCES_PAGE_INTRO,
  SOURCES_PAGE_LINKS,
  SOURCES_PAGE_PATH,
  SOURCES_PAGE_TITLE,
  getSourcesPageSources
} from "./lib/sources-page.js";
import {
  respondToUnexpectedError,
  checkSensitiveRateLimit,
  readJsonBodyCapped
} from "./server/http-helpers.js";
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
const MAX_CONCURRENT_SITEMAP_STREAMS = 1;
const SITEMAP_MAX_DURATION_MS = 30_000;
let activeSitemapStreams = 0;
// Last COMPLETE sitemap-jobs.xml body this process produced. When a fresh
// read can't be served (DB statement_timeout under load, or a concurrent
// stream), crawlers get this instead of a 503 — Search Console treats a
// failed fetch as "couldn't read", and before this existed the timeout path
// even leaked a truncated 200 that Cloudflare cached (parse error, 0 URLs).
// ~200 B per URL, so ≤ ~10 MB at the 50k cap.
let lastGoodJobsSitemap: string | null = null;
const STALE_SITEMAP_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
const SPA_ROUTES = new Set([
  "/login",
  "/reset-password",
  "/auth/callback",
  "/pricing",
  "/legal/terminos",
  "/legal/privacidad",
  "/legal/uso-aceptable",
  "/legal/cookies",
  "/cuenta",
  "/cuenta/ai/providers",
  "/como-funciona",
  "/fuentes",
  "/preguntas"
]);

const MIN_COMPRESSIBLE_BYTES = 1024;
const COMPRESSIBLE_CONTENT_TYPE = /^(?:text\/|application\/(?:javascript|json|xml))/i;
const STATIC_FILE_CACHE = new Map<string, Buffer>();
const ENCODED_STATIC_CACHE = new Map<string, Promise<Buffer>>();

type SupportedContentEncoding = "br" | "gzip";

function acceptedContentEncoding(req: http.IncomingMessage): SupportedContentEncoding | null {
  const accepted = String(req.headers["accept-encoding"] || "")
    .toLowerCase()
    .split(",")
    .map((value) => value.trim().split(";")[0]);
  if (accepted.includes("br")) return "br";
  if (accepted.includes("gzip")) return "gzip";
  return null;
}

function compressBody(body: Buffer, encoding: SupportedContentEncoding): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const done = (error: Error | null, result: Buffer) => (error ? reject(error) : resolve(result));
    if (encoding === "br") {
      brotliCompress(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } }, done);
      return;
    }
    gzip(body, { level: 6 }, done);
  });
}

function mergeVary(existing: string | string[] | number | undefined, value: string): string {
  const names = `${Array.isArray(existing) ? existing.join(",") : existing || ""},${value}`
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return [...new Map(names.map((name) => [name.toLowerCase(), name])).values()].join(", ");
}

async function sendBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  headers: http.OutgoingHttpHeaders,
  body: string | Buffer,
  staticCacheKey?: string
): Promise<void> {
  const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  const contentType = String(headers["Content-Type"] || headers["content-type"] || "");
  const encoding =
    rawBody.length >= MIN_COMPRESSIBLE_BYTES && COMPRESSIBLE_CONTENT_TYPE.test(contentType)
      ? acceptedContentEncoding(req)
      : null;
  let responseBody = rawBody;
  const responseHeaders: http.OutgoingHttpHeaders = { ...headers };

  if (encoding) {
    try {
      const cacheKey = staticCacheKey ? `${staticCacheKey}:${encoding}` : null;
      let compressed = cacheKey ? ENCODED_STATIC_CACHE.get(cacheKey) : undefined;
      if (!compressed) {
        compressed = compressBody(rawBody, encoding);
        if (cacheKey) ENCODED_STATIC_CACHE.set(cacheKey, compressed);
      }
      responseBody = await compressed;
      responseHeaders["Content-Encoding"] = encoding;
      responseHeaders.Vary = mergeVary(responseHeaders.Vary, "Accept-Encoding");
    } catch (error) {
      if (staticCacheKey) ENCODED_STATIC_CACHE.delete(`${staticCacheKey}:${encoding}`);
      console.warn("[server] No se pudo comprimir una respuesta; se enviará sin comprimir.", error);
    }
  }

  responseHeaders["Content-Length"] = String(responseBody.length);
  res.writeHead(status, responseHeaders);
  res.end(req.method === "HEAD" ? undefined : responseBody);
}

async function readStaticFile(filePath: string): Promise<Buffer> {
  const cached = STATIC_FILE_CACHE.get(filePath);
  if (cached) return cached;
  const content = await fs.promises.readFile(filePath);
  STATIC_FILE_CACHE.set(filePath, content);
  return content;
}

function writeWithBackpressure(
  res: http.ServerResponse,
  chunk: string,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return Promise.reject(new SitemapStreamAbortedError());
  if (res.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", onDrain);
      signal.removeEventListener("abort", onAbort);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new SitemapStreamAbortedError());
    };
    res.once("drain", onDrain);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Reputación de empleador (docs/COMPANY-REPUTATION-PLAN.md, Fase R2) — one
// batched query for however many jobs are in the caller's current page
// (never the whole corpus, never N+1 per job). A job whose company has no
// confirmed alias just gets an empty array, never a guessed/fuzzy result.
async function attachReputation<T extends { company: string | null }>(
  jobs: T[]
): Promise<(T & { reputation: ReputationEntry[] })[]> {
  const companies = jobs.flatMap((job) => (job.company ? [job.company] : []));
  const reputationMap = await getReputationForCompanies(companies);
  return jobs.map((job) => ({
    ...job,
    reputation: job.company ? reputationMap.get(job.company) || [] : []
  }));
}

interface CompanyView {
  displayName: string;
  logoUrl: string | null;
  reputation: ReputationEntry[];
  /** The employer's own careers search, for employers whose vacancies can't be read (src/data/official-careers-links.ts). */
  officialCareersUrl: string | null;
}

// Company page (API + SSR): one employer, whatever spelling the slug came
// from. The curated reputation alias table is keyed by exact raw names, so
// reputation is looked up for every live spelling (plus the resolved name)
// and kept once per source — the badge must not vanish just because the
// display name is "Accenture Colombia" while the alias row says "Accenture".
async function resolveCompanyView(resolvedName: string, country: string | undefined): Promise<CompanyView> {
  const group = await getCompanyGroup(resolvedName, country, Object.keys(COMPANY_LOGO_DOMAINS));
  const displayName = group?.displayName ?? resolvedName;
  const names = [...new Set([displayName, ...(group?.variants ?? []), resolvedName])];
  const reputationMap = await getReputationForCompanies(names);
  const seenSources = new Set<string>();
  const reputation: ReputationEntry[] = [];
  for (const name of names) {
    for (const entry of reputationMap.get(name) || []) {
      if (seenSources.has(entry.source)) continue;
      seenSources.add(entry.source);
      reputation.push(entry);
    }
  }
  const logoUrl = names.map((name) => getCompanyLogoUrl(name)).find(Boolean) ?? null;
  return { displayName, logoUrl, reputation, officialCareersUrl: getOfficialCareersUrl(names) };
}

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
const CHECKOUT_START_BODY_MAX_BYTES = 1 * 1024; // { plan?: "pro" | "pro_max" } — tiny payload, generous cap

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

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const method = req.method || "GET";
  const requestStartedAt = Date.now();
  const clientIp = getClientIp(req);

  // Production is behind Render's edge. Hashed Vite assets are immutable,
  // while public HTML can be shared briefly without making vacancies stale.
  // Personalized APIs must never enter a shared cache.
  if (method === "GET" || method === "HEAD") {
    if (pathname.startsWith("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (pathname.startsWith("/api/")) {
      res.setHeader("Cache-Control", "private, no-store");
    } else if (pathname.startsWith("/sitemap")) {
      res.setHeader(
        "Cache-Control",
        "public, max-age=300, s-maxage=900, stale-while-revalidate=900"
      );
    } else {
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=600");
    }
  }

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
    if (pathname.startsWith("/api/v1/")) {
      res.setHeader("Retry-After", "900");
      await sendStructuredApiError(
        req,
        res,
        sendBody,
        429,
        "rate_limit_exceeded",
        "Demasiadas solicitudes.",
        "Espera 15 minutos antes de volver a intentarlo."
      );
    } else {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "900" });
      res.end(JSON.stringify({ error: "Demasiadas solicitudes — intenta de nuevo más tarde." }));
    }
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
    if (pathname.startsWith("/api/v1/")) {
      res.setHeader("Retry-After", "60");
      await sendStructuredApiError(
        req,
        res,
        sendBody,
        429,
        "rate_limit_exceeded",
        "Demasiadas solicitudes.",
        "Espera un minuto antes de volver a intentarlo."
      );
    } else {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
      res.end(JSON.stringify({ error: "Demasiadas solicitudes — intenta de nuevo en un minuto." }));
    }
    return;
  }

  if (
    await handleAgentReadinessRoute(req, res, {
      pathname,
      method,
      parsedUrl,
      clientIp,
      loadIndexHtml: async () =>
        (await readStaticFile(path.join(PUBLIC_DIR, "index.html"))).toString("utf8"),
      sendBody
    })
  ) {
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

  // 3. GET /api/runs (public-safe) + GET /api/admin/runs[/:id] (operator
  //    token) — persisted run observability, see server/routes/runs.ts (P2).
  if (isRunsRoute(pathname) && (await handleRunsRoute(req, res, { pathname, method, parsedUrl }))) {
    return;
  }

  // 3z. GET /api/home-stats?country=CO|VE — every figure the homepage shows,
  //     in one response (it used to be ~13 /api/jobs + /api/companies/search
  //     calls per visit). Same payload for every visitor: no session lookup,
  //     only known countries and the homepage's own city list, so it can't be
  //     turned into an arbitrary-filter query. A part whose query fails comes
  //     back null/empty (the page hides it) and the response is then never
  //     shared by the edge.
  if (pathname === "/api/home-stats" && method === "GET") {
    const country = (parsedUrl.searchParams.get("country") || "").toUpperCase();
    if (!isHomeCountry(country)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "País no soportado" }));
      return;
    }
    const cities = getHomeCities(country);
    const [counts, companies] = await Promise.allSettled([
      getHomeJobCounts(country, cities),
      getHomeCompanies(country, 12, Object.keys(COMPANY_LOGO_DOMAINS))
    ]);
    const jobs = counts.status === "fulfilled" ? counts.value : null;
    const companyPage = companies.status === "fulfilled" ? companies.value : null;
    const latest = jobs ? maskLockedFields(jobs.latestJobs, "free") : [];
    const body: HomeData = {
      totalJobs: jobs?.totalJobs ?? null,
      last7Days: jobs?.last7Days ?? null,
      last24Hours: jobs?.last24Hours ?? null,
      onSite: jobs?.onSite ?? null,
      remote: jobs?.remote ?? null,
      totalCompanies: companyPage?.total ?? null,
      cityCounts: Object.fromEntries(cities.map((city) => [city, jobs?.cityCounts[city] ?? null])),
      latestJobs: latest.map((job) => ({
        jobId: job.jobId,
        title: job.title,
        company: job.company,
        location: job.location,
        source: job.source,
        dateText: job.dateText,
        publishedAt: job.publishedAt
      })),
      companies: (companyPage?.companies ?? []).map((item) => ({
        company: item.company,
        count: item.count,
        logoUrl: getCompanyLogoUrl(item.company)
      }))
    };
    if (!jobs || !companyPage) {
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "home_stats_partial",
          country,
          countsFailed: !jobs,
          companiesFailed: !companyPage
        })
      );
    }
    await sendBody(
      req,
      res,
      200,
      {
        "Content-Type": "application/json",
        "Cache-Control":
          jobs && companyPage ? "public, max-age=60, s-maxage=300, stale-while-revalidate=600" : "private, no-store"
      },
      JSON.stringify(body)
    );
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
    await sendBody(
      req,
      res,
      200,
      { "Content-Type": "application/json" },
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
    let job = await getJobById(id);
    if (!job) {
      // A job-board copy replaced by the company's official vacancy (ADR 0006
      // §10.7): the apply-gate re-fetch gets the official one instead.
      const superseded = await getSupersedingTarget(id);
      if (superseded?.target) job = await getJobById(superseded.target.jobId);
    }
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
    const resolvedName =
      (await resolveCompanyBySlug(slug)) ||
      resolveCompanyNameFromJobs(
        slug,
        companyNames.map((company) => ({ company }))
      );
    // An undisclosed employer ("Confidencial", "Confidential Careers") is
    // not a company: no profile, same as an unknown slug.
    if (!resolvedName || isPlaceholderEmployer(resolvedName) || isPlaceholderEmployer(slug.replace(/-/g, " "))) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Empresa no encontrada" }));
      return;
    }
    // Same employer grouping as the /empresas directory (see the SSR branch).
    const companyView = await resolveCompanyView(resolvedName, country);
    const companyName = companyView.displayName;

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

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        companyName,
        logoUrl: companyView.logoUrl,
        reputation: companyView.reputation,
        officialCareersUrl: companyView.officialCareersUrl,
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
      } catch (e) {
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
          new Set<string>(
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
      } catch (e) {
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
      } catch {
        // Malformed body: keep the default keywords below.
      }

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
  //    Wompi Web Checkout real (sandbox) para el plan Pro o Pro Max mensual.
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
    const requestedPlan = (body.value as { plan?: unknown } | null | undefined)?.plan;
    const plan: "pro" | "pro_max" = requestedPlan === "pro_max" ? "pro_max" : "pro";

    try {
      const checkout = await startPaymentCheckout({
        userId: session.id,
        userEmail: session.email,
        plan
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(checkout));
    } catch (e) {
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
      } catch (e) {
        respondToUnexpectedError(res, e, "POST /api/webhooks/wompi", "Payload inválido.");
      }
    });
    return;
  }

  if (pathname.startsWith("/api/")) {
    await sendStructuredApiError(
      req,
      res,
      sendBody,
      404,
      "route_not_found",
      "La ruta API solicitada no existe.",
      "Consulta /openapi.json o /docs para ver los endpoints públicos disponibles."
    );
    return;
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
      const insights = buildCategoryInsights(category, total, page);
      const internalLinks = buildCategoryInternalLinks(category);
      const relatedCityLinks = buildRelatedCityLinks(category);
      const sectionHeadings = buildCategorySectionHeadings(category);

      // Same "real links in the raw HTML" pattern /dashboard already uses
      // (see 7c below) — this page's whole SEO value is being a crawlable
      // hub linking into the individual job pages, unlike the job-detail
      // branch below (which only needs JSON-LD in <head>, no visible list).
      const items = page
        .map((job) => {
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
      const overviewHtml = `<section data-category-overview aria-label="Resumen de las vacantes">
  <p>${escapeHtml(insights.intro)}</p>
  <dl>
    <div><dt>Empresas en la muestra</dt><dd>${insights.companyCount}</dd></div>
    <div><dt>Fuentes verificables</dt><dd>${insights.sources.length}</dd></div>
    <div><dt>Publicadas en 7 días</dt><dd>${insights.freshLast7Days}</dd></div>
  </dl>
  ${insights.topCompanies.length > 0 ? `<p><strong>Empresas visibles:</strong> ${escapeHtml(insights.topCompanies.join(", "))}.</p>` : ""}
  ${insights.sources.length > 0 ? `<p><strong>Fuentes:</strong> ${escapeHtml(insights.sources.join(", "))}.</p>` : ""}
  ${insights.modalities.length > 0 ? `<p><strong>Modalidades:</strong> ${escapeHtml(insights.modalities.map((item) => `${item.label} (${item.count})`).join(", "))}.</p>` : ""}
  ${insights.latestPublishedLabel ? `<p><strong>Última publicación visible:</strong> ${escapeHtml(insights.latestPublishedLabel)}.</p>` : ""}
  <nav aria-label="Explorar más empleos">${internalLinks.map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join(" · ")}</nav>
</section>`;
      const jobsHeading = page.length > 0 ? `<h2>${escapeHtml(sectionHeadings.jobs)}</h2>\n` : "";
      const relatedCitiesHtml =
        relatedCityLinks.length > 0
          ? `\n<section data-related-cities aria-label="${escapeHtml(sectionHeadings.relatedCities)}"><h2>${escapeHtml(sectionHeadings.relatedCities)}</h2><ul>${relatedCityLinks.map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`).join("")}</ul></section>`
          : "";
      const ssrSnippet = `<h1>${escapeHtml(meta.heading)}</h1>\n${emptyNotice}${overviewHtml}${jobsHeading}<nav aria-label="Vacantes"><ul>\n${items}\n</ul></nav>${relatedCitiesHtml}`;
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
        total,
        insights
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

      await sendBody(req, res, 200, { "Content-Type": "text/html; charset=utf-8" }, indexHtml);
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
      // queries wasJobPurged() with a well-formed jobId. A row that already
      // expired (src/lib/job-freshness.ts) but awaits the next purge is the
      // same permanent removal, so it answers 410 too.
      // A job-board copy replaced by the company's official vacancy (ADR 0006
      // §10.7): 301 to the official page while it is live, so no indexed URL
      // breaks; 410 once the official version closed — never a 404.
      const superseded = id ? await getSupersedingTarget(id) : undefined;
      if (superseded?.target) {
        res.writeHead(301, { Location: buildJobPath(superseded.target) });
        res.end();
        return;
      }
      if (id && (superseded || (await wasJobPurged(id)) || (await isJobExpiredInPlace(id)))) {
        res.writeHead(410, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Vacante ya no disponible | BuscoTrabajo</title><meta name="robots" content="noindex"></head><body><h1>Esta vacante ya no está disponible</h1><p>Fue retirada porque venció: lleva más de 30 días publicada, pasó su fecha límite o la fuente la cerró.</p><p><a href="/dashboard">Ver vacantes activas</a></p></body></html>'
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
      await sendBody(req, res, 200, { "Content-Type": "text/html; charset=utf-8" }, indexHtml);
      return;
    }

    const meta = buildJobMeta(visible);
    // Job SEO V2: USER_VISIBLE and GOOGLE_READY are separate. Every visible
    // job gets the same readable body with the source link in raw HTML; the
    // stored verdict of the shared gate (isGoogleEligiblePage) alone decides
    // robots and JobPosting — the same verdict the sitemap and the Indexing
    // API read, so the four consumers can never disagree.
    const googleReady = isGoogleEligiblePage(visible);
    const jobPosting = googleReady ? buildJobPosting(visible) : null;
    indexHtml = indexHtml.replace(
      '<div id="app"></div>',
      `<div id="app">${buildJobPageBody(visible)}</div>`
    );
    // Google blocks /api/jobs under robots.txt. Without this snapshot React
    // discarded a real SSR job and rendered a false "no longer available".
    // Only embed anonymous, already-public fields; authenticated clients refetch.
    if (!session) {
      // Preserve the public badges previously obtained by the detail API.
      // One company lookup, never a corpus scan; optional enrichment may fail
      // without making an otherwise healthy vacancy unavailable.
      const [publicJob] = await attachReputation([visible]).catch(() => [visible]);
      indexHtml = indexHtml.replace(
        "</head>",
        `  <script>window.__SSR_JOB__=${escapeJsonForScriptTag(buildJobPagePayload(publicJob))};</script>\n</head>`
      );
    }
    indexHtml = indexHtml.replace(/<meta[^>]*name=["']robots["'][^>]*>/i, "");
    if (!googleReady || !jobPosting) {
      indexHtml = indexHtml.replace(
        "</head>",
        `  <meta name="robots" content="noindex,follow">\n</head>`
      );
    }

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
        jobPosting
          ? `  <script type="application/ld+json">${escapeJsonForScriptTag(jobPosting)}</script>\n</head>`
          : "</head>"
      );

    await sendBody(req, res, 200, { "Content-Type": "text/html; charset=utf-8" }, indexHtml);
    return;
  }

  // 7b-bis. GET /fuentes — a crawlable, self-canonical source-transparency
  // page. This route used to fall through to the generic SPA shell, so its
  // raw HTML inherited the homepage title/canonical and contained no H1 or
  // meaningful copy. Keep this content aligned with SourcesAndProblem.tsx
  // through the shared constants in sources-page.ts.
  if (pathname === SOURCES_PAGE_PATH && (method === "GET" || method === "HEAD")) {
    let indexHtml: string;
    try {
      indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf-8");
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Server Error: build not found");
      return;
    }

    const sources = getSourcesPageSources("CO");
    const sourcesList = sources.map((source) => `<li>${escapeHtml(source)}</li>`).join("\n");
    const disclosures = SOURCES_PAGE_DISCLOSURES.map(
      (disclosure) => `<li>${escapeHtml(disclosure)}</li>`
    ).join("\n");
    const links = SOURCES_PAGE_LINKS.map(
      (link) => `<li><a href="${link.href}">${escapeHtml(link.label)}</a></li>`
    ).join("\n");
    const ssrSnippet =
      `<article data-sources-page>` +
      `<h1>${escapeHtml(SOURCES_PAGE_HEADING)}</h1>` +
      `<p>${escapeHtml(SOURCES_PAGE_INTRO)}</p>` +
      `<section><h2>Fuentes disponibles en Colombia</h2><ul>${sourcesList}</ul></section>` +
      `<section><h2>Qué significa que rastreamos una fuente</h2><ul>${disclosures}</ul></section>` +
      `<nav aria-label="Explorar BuscoTrabajo"><ul>${links}</ul></nav>` +
      `</article>`;
    indexHtml = indexHtml.replace('<div id="app"></div>', `<div id="app">${ssrSnippet}</div>`);

    const canonicalUrl = `${SITE_URL}${SOURCES_PAGE_PATH}`;
    indexHtml = indexHtml
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(SOURCES_PAGE_TITLE)}</title>`)
      .replace(
        /<meta[^>]*name=["']description["'][^>]*>/,
        `<meta name="description" content="${escapeHtml(SOURCES_PAGE_DESCRIPTION)}" />`
      )
      .replace(
        /<link[^>]*rel=["']canonical["'][^>]*>/,
        `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`
      )
      .replace(
        /<meta[^>]*property=["']og:title["'][^>]*>/,
        `<meta property="og:title" content="${escapeHtml(SOURCES_PAGE_TITLE)}" />`
      )
      .replace(
        /<meta[^>]*property=["']og:description["'][^>]*>/,
        `<meta property="og:description" content="${escapeHtml(SOURCES_PAGE_DESCRIPTION)}" />`
      )
      .replace(
        /<meta[^>]*name=["']twitter:title["'][^>]*>/,
        `<meta name="twitter:title" content="${escapeHtml(SOURCES_PAGE_TITLE)}" />`
      )
      .replace(
        /<meta[^>]*name=["']twitter:description["'][^>]*>/,
        `<meta name="twitter:description" content="${escapeHtml(SOURCES_PAGE_DESCRIPTION)}" />`
      )
      .replace(
        "</head>",
        `  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />\n</head>`
      );

    await sendBody(req, res, 200, { "Content-Type": "text/html; charset=utf-8" }, indexHtml);
    return;
  }

  // 7b-ter. GET /empresas, /ve/empresas (directory) and
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

    // Search Console still sees historical source names under the employer
    // directory (notably /empresas/elempleo). A source is not an employer
    // profile, so consolidate these stable aliases into the transparent
    // /fuentes page instead of returning a thin 404 or fabricating a page.
    if (!isVeEmpresas && slug && SOURCE_DIRECTORY_SLUGS.has(slug)) {
      res.writeHead(301, { Location: SOURCES_PAGE_PATH });
      res.end();
      return;
    }

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
      const directoryMeta = companiesDirectoryMeta(countryConfig.name);
      const heading = directoryMeta.heading;
      const meta = {
        title: directoryMeta.title,
        description: directoryMeta.description,
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

      await sendBody(req, res, 200, { "Content-Type": "text/html; charset=utf-8" }, indexHtml);
      return;
    }

    // Placeholder employers ("Confidencial", "Confidential Careers",
    // "Empresa Reservada") had indexable 200 pages because job cards linked
    // them. They name no company, so the URL is gone for good: 410 +
    // noindex, decided before any query (same contract as RETIRED_ROLE_SLUGS).
    if (isPlaceholderEmployer(slug.replace(/-/g, " "))) {
      res.writeHead(410, { "Content-Type": "text/html; charset=utf-8" });
      res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Empresa no disponible | BuscoTrabajo</title><meta name="robots" content="noindex"></head><body><h1>Esta empresa no está disponible</h1><p>La fuente no publicó el nombre del empleador, así que no existe una página de empresa para estas vacantes.</p><p><a href="/dashboard">Ver todas las vacantes</a></p></body></html>');
      return;
    }

    // Individual company page — exact same two-step resolution and
    // country-scoping rules as GET /api/companies/:slug (server.ts's own
    // API handler below), so SSR never disagrees with what the client
    // fetch would have shown.
    const companyNames = await getActiveCompanyNames(requestCountry);
    const resolvedName =
      (await resolveCompanyBySlug(slug)) ||
      resolveCompanyNameFromJobs(
        slug,
        companyNames.map((company) => ({ company }))
      );
    if (!resolvedName) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Empresa no encontrada | BuscoTrabajo</title><meta name="robots" content="noindex"></head><body><h1>Empresa no encontrada</h1><p><a href="/dashboard">Ver todas las vacantes</a></p></body></html>'
      );
      return;
    }
    if (isPlaceholderEmployer(resolvedName)) {
      res.writeHead(410, { "Content-Type": "text/html; charset=utf-8" });
      res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Empresa no disponible | BuscoTrabajo</title><meta name="robots" content="noindex"></head><body><h1>Esta empresa no está disponible</h1><p>La fuente no publicó el nombre del empleador, así que no existe una página de empresa para estas vacantes.</p><p><a href="/dashboard">Ver todas las vacantes</a></p></body></html>');
      return;
    }
    // Every spelling of the employer ("accenture" and "accenture-colombia")
    // renders the same page under the directory's display name, and its
    // canonical URL points at that one slug.
    const companyView = await resolveCompanyView(resolvedName, requestCountry);
    const companyName = companyView.displayName;

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

    const reputation = companyView.reputation;
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
      .map((job) => {
        const href = buildJobPath(job);
        return `<li><a href="${href}">${escapeHtml(job.title)}</a> — ${escapeHtml(job.location || countryConfig.name)}</li>`;
      })
      .join("\n");
    const ssrSnippet =
      `<h1>${escapeHtml(companyName)}</h1>\n` +
      (reputationItems ? `<ul aria-label="Reputación">\n${reputationItems}\n</ul>` : "") +
      (companyView.officialCareersUrl
        ? `<p><a href="${escapeHtml(companyView.officialCareersUrl)}" rel="nofollow noopener" target="_blank">Ver todas sus vacantes en su portal oficial</a></p>\n`
        : "") +
      `<nav aria-label="Vacantes"><ul>\n${jobItems}\n</ul></nav>`;
    indexHtml = indexHtml.replace('<div id="app"></div>', `<div id="app">${ssrSnippet}</div>`);

    const ssrCompanyPayload = escapeJsonForScriptTag({
      slug,
      country: requestCountry,
      companyName,
      logoUrl: companyView.logoUrl,
      reputation,
      officialCareersUrl: companyView.officialCareersUrl,
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

    await sendBody(req, res, 200, { "Content-Type": "text/html; charset=utf-8" }, indexHtml);
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
      .filter((job) => isPubliclyDescribable(job))
      .map((job) => {
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
    const dashboardDescriptionText = dashboardDescription(country, countryConfig.name);
    const dashboardCanonical = `${SITE_URL}${pathname}`;
    indexHtml = indexHtml
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(dashboardTitle)}</title>`)
      .replace(
        /<meta[^>]*name=["']description["'][^>]*>/,
        `<meta name="description" content="${escapeHtml(dashboardDescriptionText)}" />`
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
        `<meta property="og:description" content="${escapeHtml(dashboardDescriptionText)}" />`
      )
      .replace(
        /<meta[^>]*name=["']twitter:title["'][^>]*>/,
        `<meta name="twitter:title" content="${escapeHtml(dashboardTitle)}" />`
      )
      .replace(
        /<meta[^>]*name=["']twitter:description["'][^>]*>/,
        `<meta name="twitter:description" content="${escapeHtml(dashboardDescriptionText)}" />`
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

    await sendBody(req, res, 200, { "Content-Type": "text/html; charset=utf-8" }, indexHtml);
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
    await sendBody(req, res, 200, { "Content-Type": "application/xml; charset=utf-8" }, xml);
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
    await sendBody(
      req,
      res,
      200,
      { "Content-Type": "application/xml; charset=utf-8" },
      staticSitemap
    );
    return;
  }

  if (pathname === "/sitemap-jobs.xml" && method === "GET") {
    // Always the public (tier: "free") view, same as any anonymous
    // crawler — a sitemap has no session to resolve a real tier from
    // anyway, and it must never list a page (see isPubliclyDescribable
    // inside buildJobsSitemapXml) it wouldn't also show that visitor.
    const sendLastGoodSitemap = async (): Promise<boolean> => {
      if (lastGoodJobsSitemap === null) return false;
      await sendBody(
        req,
        res,
        200,
        {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": STALE_SITEMAP_CACHE_CONTROL
        },
        lastGoodJobsSitemap
      );
      return true;
    };

    if (activeSitemapStreams >= MAX_CONCURRENT_SITEMAP_STREAMS) {
      if (await sendLastGoodSitemap()) return;
      res.writeHead(503, {
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "30",
        "Cache-Control": "no-store"
      });
      res.end("Sitemap temporalmente ocupado; intenta de nuevo en unos segundos.");
      return;
    }

    activeSitemapStreams += 1;
    const controller = new AbortController();
    let headersStarted = false;
    const abort = () => controller.abort();
    const timeout = setTimeout(abort, SITEMAP_MAX_DURATION_MS);
    req.once("aborted", abort);
    res.once("close", abort);
    const body: string[] = [];
    const write = async (chunk: string) => {
      body.push(chunk);
      await writeWithBackpressure(res, chunk, controller.signal);
    };
    try {
      let wroteEntry = false;
      await streamCanonicalSitemapJobs({
        signal: controller.signal,
        limit: 50_000,
        batchSize: 250,
        statementTimeoutMs: 10_000,
        onReady: async () => {
          res.writeHead(200, {
            "Content-Type": "application/xml; charset=utf-8"
          });
          headersStarted = true;
          await write(JOBS_SITEMAP_HEADER);
        },
        onJob: async (job) => {
          const [visibleJob] = maskLockedFields([job], "free");
          const entry = buildJobSitemapEntry({
            ...visibleJob,
            contentUpdatedAt: job.contentUpdatedAt
          });
          if (!entry) return;
          await write(`${wroteEntry ? "\n" : ""}${entry}`);
          wroteEntry = true;
        }
      });
      await write(JOBS_SITEMAP_FOOTER);
      res.end();
      lastGoodJobsSitemap = body.join("");
    } catch (error) {
      if (error instanceof SitemapStreamAbortedError || controller.signal.aborted) {
        if (!res.writableEnded) res.destroy();
      } else if (!headersStarted) {
        console.error("[sitemap-jobs] No se pudo iniciar el stream:", error);
        if (await sendLastGoodSitemap()) return;
        res.writeHead(503, {
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": "60",
          "Cache-Control": "no-store"
        });
        res.end("Sitemap temporalmente no disponible.");
      } else {
        console.error("[sitemap-jobs] El stream falló después de iniciar la respuesta:", error);
        res.destroy();
      }
    } finally {
      clearTimeout(timeout);
      req.off("aborted", abort);
      res.off("close", abort);
      activeSitemapStreams -= 1;
    }
    return;
  }

  if (pathname === "/sitemap-categories.xml" && method === "GET") {
    // Static taxonomy (CITY_OPTIONS + DEFAULT_ROLES_200) — no DB query
    // needed, unlike sitemap-jobs.xml above.
    const xml = buildCategoriesSitemapXml();
    await sendBody(req, res, 200, { "Content-Type": "application/xml; charset=utf-8" }, xml);
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
  if ((pathname === "/" || pathname === "/ve") && (method === "GET" || method === "HEAD")) {
    const isVe = pathname === "/ve";
    const homeContent = getHomeContent(isVe ? "VE" : "CO");
    if (wantsMarkdown(req.headers.accept)) {
      await sendBody(
        req,
        res,
        200,
        {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "private, no-store",
          Vary: "Accept",
          Link: DISCOVERY_LINKS
        },
        renderContentMarkdown(homeContent)
      );
      return;
    }
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
    indexHtml = injectPublicContent(indexHtml, homeContent);

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

    // The homepage's desktop LCP is its dashboard screenshot
    // (HomeLanding.tsx), which the client-rendered page would otherwise
    // only request after the JS bundle runs. Wide screens only: phones
    // never render that art.
    indexHtml = indexHtml.replace(
      "</head>",
      `    <link rel="preload" as="image" href="/home/dash-desktop.webp" imagesrcset="/home/dash-desktop-960.webp 960w, /home/dash-desktop.webp 1600w" imagesizes="680px" type="image/webp" media="(min-width: 768px)" fetchpriority="high" />\n</head>`
    );

    if (isVe) {
      // Real, already-established facts only (AGENTS.md #5): VE's own
      // source list (SOURCES_BY_COUNTRY.VE — 7 sources, not CO's 10; no
      // Elempleo/Magneto/Workana coverage for Venezuela today), never a
      // find-and-replace of the Colombia copy. Without this, Googlebot's
      // first (non-JS) look at "/ve" saw a title/description that literally
      // said "Colombia" — a content-parity problem, not just a linking one.
      // injectPublicContent() already applied Venezuela's shared canonical
      // title and description. Only the Open Graph locale differs here —
      // keeping one content model prevents SSR and React from drifting.
      indexHtml = indexHtml.replace(
        /<meta property="og:locale" content="[^"]*" \/>/,
        `<meta property="og:locale" content="es_VE" />`
      );
    }

    await sendBody(
      req,
      res,
      200,
      {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        Vary: "Accept",
        Link: DISCOVERY_LINKS
      },
      indexHtml
    );
    return;
  }

  // /pricing sells the Pro plans, which unlock nothing while the paywall is
  // off (job-repository.ts gives every tier every job). Send old links and
  // bookmarks home instead of to a live checkout for an empty plan. Same
  // flag as the client route, so turning the paywall back on restores the
  // page; the bounded max-age keeps browsers from pinning the 301 forever.
  if (pathname === "/pricing" && !PAYWALL_ENABLED && (method === "GET" || method === "HEAD")) {
    res.writeHead(301, { Location: "/", "Cache-Control": "public, max-age=3600" });
    res.end();
    return;
  }

  // 6. Static Files (HTML, CSS, JS) + SPA fallback. Any path without a file
  // extension is a client-side route (/dashboard, /pricing, /legal/terminos,
  // etc.) — those must serve index.html so React Router can mount and take
  // over, otherwise a refresh or direct link on any non-"/" route 404s.
  const hasFileExtension = path.extname(pathname) !== "";
  if (!hasFileExtension && !SPA_ROUTES.has(pathname)) {
    const markdown = wantsMarkdown(req.headers.accept);
    await sendBody(
      req,
      res,
      404,
      {
        "Content-Type": markdown ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        Vary: "Accept"
      },
      markdown ? NOT_FOUND_MARKDOWN : NOT_FOUND_HTML
    );
    return;
  }

  // Client-rendered routes with no SSR body of their own (/como-funciona,
  // /preguntas, /legal/*, sign-in/account pages): they used to ship the
  // homepage's <title>, description and canonical="/" — every one of them
  // declared itself a duplicate of the home. Inject their own head (and H1
  // where they have one) from the same registry the React pages read.
  const routeMeta = !hasFileExtension ? ROUTE_META[pathname] : undefined;
  if (routeMeta && (method === "GET" || method === "HEAD")) {
    try {
      const indexHtml = (await readStaticFile(path.join(PUBLIC_DIR, "index.html"))).toString("utf-8");
      await sendBody(
        req,
        res,
        200,
        { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Accept" },
        injectRouteMeta(indexHtml, pathname, routeMeta)
      );
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Server Error: build not found");
    }
    return;
  }

  const filePath = path.join(PUBLIC_DIR, hasFileExtension ? pathname : "index.html");

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
    ".txt": "text/plain",
    // Homepage images (static/home/). Without these they fell through to
    // text/plain, which browsers may refuse to render as an image.
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon"
  };

  const contentType = mimeTypes[ext] || "text/plain";

  try {
    const content = await readStaticFile(filePath);
    await sendBody(
      req,
      res,
      200,
      { "Content-Type": contentType },
      content,
      pathname.startsWith("/assets/") ? filePath : undefined
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<h1>404 Not Found</h1>");
    } else {
      res.writeHead(500);
      res.end(`Server Error: ${code || "UNKNOWN"}`);
    }
  }
}

async function warmDashboardFirstPages(): Promise<void> {
  const startedAt = Date.now();
  for (const country of ["CO", "VE"] as const) {
    await getJobsPage({
      filters: { country },
      limit: 24,
      offset: 0,
      includeDetails: true
    });
  }
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "dashboard_cache_warmed",
      durationMs: Date.now() - startedAt,
      countries: ["CO", "VE"]
    })
  );
}

// Render only routes production traffic to a new instance after it starts
// listening. Warm the two public dashboard projections first so the first
// visitor after a deploy (or an edge cache MISS) does not pay for the full
// canonical DISTINCT/COUNT query. Tests use disposable databases and do not
// need this production readiness step.
if (!process.env.JOB_RADAR_TEST_MODE) {
  const warmup = warmDashboardFirstPages();
  const timeout = new Promise<"timeout">((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 20_000);
    timer.unref();
  });
  const outcome = await Promise.race([
    warmup.then(() => "ready" as const).catch(() => "failed" as const),
    timeout
  ]);
  if (outcome === "timeout") {
    console.warn("[dashboard-cache] Warmup exceeded 20 seconds; starting while it finishes.");
    void warmup.catch(() => {
      console.warn("[dashboard-cache] Warmup failed; the first request will retry normally.");
    });
  } else if (outcome === "failed") {
    console.warn("[dashboard-cache] Warmup failed; the first request will retry normally.");
  }
}

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 JOB RADAR DASHBOARD RUNNING AT: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
  console.log(
    "ℹ️  El scraping corre fuera de este proceso (GitHub Actions, scripts/run-scrape-tick.ts) — el servidor web nunca scrapea."
  );
});
