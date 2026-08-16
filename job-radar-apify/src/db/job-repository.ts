import crypto from "crypto";
import dotenv from "dotenv";
import { pool } from "./client.js";
import { Job, JobDetail, normalizeJobUrl } from "../sources/types.js";
import { getCountryConfig } from "../countries/index.js";
import { saveRunToCache, getAllCachedRuns } from "../cache-manager.js";
import { validateJobs } from "./job-validator.js";
import { PAYWALL_ENABLED } from "../config.js";
import { buildJobUrl, isPubliclyDescribable } from "../lib/job-seo.js";
import { enqueueIndexingNotifications } from "./indexing-repository.js";

dotenv.config();

export type SubscriptionTier = "free" | "pro" | "pro_max";

// SHA256 helper for url_hash. Delegates URL normalization to
// normalizeJobUrl (sources/types.ts) so the DB-level hash and the
// in-memory per-adapter dedup (deduplicateJobs) always agree on what
// counts as "the same URL" — they used to have separate, drifting
// implementations, which is how a job id living in the query string
// (e.g. Indeed's `?jk=`) went unnoticed on one side.
export function computeUrlHash(url: string): string {
  return crypto.createHash("sha256").update(normalizeJobUrl(url)).digest("hex");
}

/**
 * Secondary dedup key based on content (title + company + location).
 * Catches the same posting even when its URL varies between searches.
 */
// Fallback is the job's own country's name — NOT a literal "colombia" — so a
// Venezuela job with no location can never collide with a Colombia job with
// no location just because they share the same fallback bucket (they used
// to, before jobs.country existed). This is provably a no-op for every row
// that predates the Venezuela expansion: pre-existing rows all have
// country='CO' (or NULL, meaning remote), and getCountryConfig treats both
// as Colombia (see countries/index.ts's DEFAULT_COUNTRY) — same as
// getCountryConfig('CO').name.toLowerCase() === "colombia", the exact
// literal this replaces. See scripts/verify-fingerprint-compat.ts, which
// confirms that empirically against the real corpus before this ships.
export function computeContentFingerprint(job: Job): string {
  const normalized = [
    job.title.toLowerCase().trim(),
    (job.company || "confidencial").toLowerCase().trim(),
    (job.location || getCountryConfig(job.country).name).toLowerCase().trim()
  ].join("|");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Saves a list of scraped jobs to Postgres with url_hash deduplication and sources array merging.
 */
export interface InsertedJobRef {
  id: string;
  url: string;
  source: string;
}

export async function saveJobs(
  jobs: Job[],
  roleOrigin: string = "General"
): Promise<{ savedCount: number; duplicateCount: number; insertedJobs: InsertedJobRef[] }> {
  let savedCount = 0;
  let duplicateCount = 0;
  // Collected across the loop, enqueued in one batched INSERT after it —
  // SEO Fase 3 (Google Indexing API), see indexing-repository.ts. Doing
  // this per-iteration would triple the query count of a loop that already
  // runs over every scraped job on every 15-min tick.
  const newlyInsertedUrls: string[] = [];
  // Fase de enriquecimiento (fuentes HTML con fetch de detalle) — solo las
  // filas realmente nuevas de esta corrida, nunca las re-vistas. Ver
  // ScrapeWorker.processRoleJob, que es el único consumidor.
  const insertedJobs: InsertedJobRef[] = [];

  const { valid, discarded } = validateJobs(jobs);
  if (discarded.length > 0) {
    console.warn(
      `🛑 [Reviewer] ${discarded.length} vacante(s) descartada(s) por no cumplir el contrato:`
    );
    for (const { job, reason } of discarded) {
      console.warn(`   - "${job.title || "(sin título)"}" (${job.source || "?"}): ${reason}`);
    }
  }

  for (const job of valid) {
    const hash = computeUrlHash(job.url);
    const fingerprint = computeContentFingerprint(job);
    const publishedAt =
      job.publishedAt && !isNaN(new Date(job.publishedAt).getTime())
        ? new Date(job.publishedAt).toISOString()
        : new Date().toISOString();

    // Check content fingerprint FIRST — if a job with the same
    // title+company+location already exists (regardless of URL), just
    // merge the source and skip insertion entirely.
    const existingByFingerprint = await pool.query(
      `SELECT id, url_hash, sources, source FROM jobs
       WHERE content_fingerprint = $1 AND url_hash != $2 AND is_active = TRUE
       LIMIT 1`,
      [fingerprint, hash]
    );

    if (existingByFingerprint.rows.length > 0) {
      // Duplicate by content: merge source into the existing record
      const existing = existingByFingerprint.rows[0];
      const sources: string[] = Array.isArray(existing.sources) ? existing.sources : [];
      // last_seen_at bumped unconditionally (not just when sources[] grows)
      // — the whole point is "this job was rediscovered just now," which is
      // true on every match here, source-array change or not. See
      // docs/SEO-PLAN.md §9.2 / migrate-last-seen-at.ts.
      if (!sources.includes(job.source)) {
        await pool.query(
          `UPDATE jobs SET sources = sources || to_jsonb($2::text), last_seen_at = NOW() WHERE id = $1`,
          [existing.id, job.source]
        );
      } else {
        await pool.query(`UPDATE jobs SET last_seen_at = NOW() WHERE id = $1`, [existing.id]);
      }
      duplicateCount++;
      continue;
    }

    const result = await pool.query(
      `INSERT INTO jobs (url_hash, content_fingerprint, title, company, location, url, source, sources, date_text, published_at, role_origin, country,
                          description, requirements, technologies, employment_type, salary_min, salary_max, salary_currency, salary_raw, applicant_count)
       VALUES ($1, $11, $2, $3, $4, $5, $6, jsonb_build_array($10::text), $7, $8, $9, $12,
               $13, $14::jsonb, $15::jsonb, $16, $17, $18, $19, $20, $21)
       ON CONFLICT (url_hash) DO UPDATE SET
         sources = CASE
           WHEN jobs.sources @> to_jsonb(EXCLUDED.source::text) THEN jobs.sources
           ELSE jobs.sources || to_jsonb(EXCLUDED.source::text)
         END,
         -- The fix for the URL-churn bug (docs/SEO-PLAN.md §9.2): this was
         -- the missing line. Without it, a job re-scraped every 15 minutes
         -- for months still looked "first seen 30+ days ago" to
         -- purgeOldJobs(), got hard-deleted, and came back with a brand-new
         -- id/URL on the very next tick — resetting any indexing signal
         -- Google had accumulated on the old URL. created_at intentionally
         -- stays untouched (it answers "when was this job first posted,"
         -- not "is it still live").
         --
         -- Deliberately NOT setting description/requirements/technologies/
         -- employment_type/salary_*/applicant_count here: those only get
         -- written on first INSERT of a genuinely new row. A job re-seen on
         -- a later tick is already in the table — it keeps whatever detail
         -- (or lack of it) it had when first captured, never backfilled.
         last_seen_at = NOW()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        hash,
        job.title,
        job.company,
        job.location,
        job.url,
        job.source,
        job.dateText,
        publishedAt,
        roleOrigin,
        job.source,
        fingerprint,
        // undefined -> NULL (pg driver), same as any other unset field —
        // callers that don't stamp country (tests, ad-hoc scripts) simply
        // get a NULL row, same as a remote job. ON CONFLICT deliberately
        // does NOT update country on a re-scrape of an existing URL: a
        // job's country is a fact about where it was posted, not about
        // which tick most recently re-discovered it.
        job.country ?? null,
        job.description ?? null,
        JSON.stringify(job.requirements ?? []),
        JSON.stringify(job.technologies ?? []),
        job.employmentType ?? null,
        job.salaryMin ?? null,
        job.salaryMax ?? null,
        job.salaryCurrency ?? null,
        job.salaryRaw ?? null,
        job.applicantCount ?? null
      ]
    );

    if (result.rows[0]?.inserted) {
      savedCount++;
      const savedJob = { ...job, jobId: result.rows[0].id, publishedAt };
      if (isPubliclyDescribable(savedJob)) {
        newlyInsertedUrls.push(buildJobUrl(savedJob));
      }
      insertedJobs.push({ id: result.rows[0].id, url: job.url, source: job.source });
    } else {
      duplicateCount++;
    }
  }

  if (newlyInsertedUrls.length > 0) {
    try {
      await enqueueIndexingNotifications(
        newlyInsertedUrls.map((url) => ({ url, type: "URL_UPDATED" as const }))
      );
    } catch (err) {
      // Never let an indexing-queue write fail the actual save — jobs are
      // already committed above, this is a best-effort SEO side-channel.
      console.warn(`⚠️ [saveJobs] Failed to enqueue indexing notifications:`, err);
    }
  }

  // Also persist run metadata to local JSON cache for GET /api/runs (history
  // browsing, not paywall-relevant). `data/jobs-cache.json` is tracked in
  // git — description/requirements can run into thousands of characters
  // per job across hundreds of roles, so they're stripped here rather than
  // let this file balloon; the full detail already lives in Postgres.
  try {
    const runId = `run_${Date.now()}`;
    const lightweightJobs = (jobs as any[]).map(({ description, requirements, ...rest }) => rest);
    saveRunToCache({
      id: runId,
      name: `${roleOrigin} (${jobs.length} Vacantes)`,
      role: roleOrigin,
      timestamp: new Date().toISOString(),
      jobs: lightweightJobs
    });
  } catch (e) {
    console.warn("[JobRepository] Warning: Could not save run to local cache file:", e);
  }

  console.log(
    `💾 [JobRepository] Guardado en Postgres: ${savedCount} nuevas vacantes, ${duplicateCount} fusionadas en deduplicación.`
  );
  return { savedCount, duplicateCount, insertedJobs };
}

/**
 * Writes detail-page enrichment (description, requirements, technologies,
 * employment type, salary fields, applicant count) onto a specific,
 * already-saved row. Only ever called by ScrapeWorker right after
 * saveJobs(), scoped to that call's own insertedJobs — never on a re-scrape
 * of an existing job, so this is the one place besides the original INSERT
 * that can populate these columns, and it only ever targets a row this
 * exact process just created.
 */
export async function updateJobDetail(id: string, detail: JobDetail): Promise<void> {
  // COALESCE, not a blind overwrite: the search-results fetch for some
  // sources (Torre today) already stores description/technologies/
  // employmentType inline at INSERT time (see saveJobs()). If that same
  // source ever gets a fetchDetail too, a field this detail fetch didn't
  // find (passed as NULL below) must keep whatever real value is already
  // on the row, not erase it.
  await pool.query(
    `UPDATE jobs SET
       description = COALESCE($2, description),
       requirements = COALESCE($3::jsonb, requirements),
       technologies = COALESCE($4::jsonb, technologies),
       employment_type = COALESCE($5, employment_type),
       salary_min = COALESCE($6, salary_min),
       salary_max = COALESCE($7, salary_max),
       salary_currency = COALESCE($8, salary_currency),
       salary_raw = COALESCE($9, salary_raw),
       applicant_count = COALESCE($10, applicant_count)
     WHERE id = $1`,
    [
      id,
      detail.description ?? null,
      detail.requirements ? JSON.stringify(detail.requirements) : null,
      detail.technologies ? JSON.stringify(detail.technologies) : null,
      detail.employmentType ?? null,
      detail.salaryMin ?? null,
      detail.salaryMax ?? null,
      detail.salaryCurrency ?? null,
      detail.salaryRaw ?? null,
      detail.applicantCount ?? null
    ]
  );
}

// The active corpus is inherently bounded — `purgeOldJobs` deletes anything
// older than 30 days — so this comfortably covers the full corpus in one
// response without needing real pagination. The dashboard's filters are
// designed to run instantly client-side over the whole array (see
// `tests/validate-dashboard-filters.ts`); a default this low used to mean
// `/api/jobs` silently returned only the 100 most-recent jobs, so any search
// or filter that didn't match one of those happened to return nothing even
// though matching jobs existed elsewhere in the table.
const DEFAULT_JOBS_LIMIT = 5000;

/**
 * Retrieves jobs from Postgres with real, unmasked data — used by internal
 * consumers (social digest generator, admin tooling, tests) that need the
 * actual company/location/url. `isLocked` (published within the last 48h) is
 * computed in SQL so callers can decide what to do with it; the paywall
 * masking itself lives in `maskLockedFields`, applied only to the public
 * `/api/jobs` HTTP response — never here, so internal jobs never see nulls.
 */
export async function getJobs(
  limit: number = DEFAULT_JOBS_LIMIT,
  offset: number = 0
): Promise<any[]> {
  // DISTINCT ON (title, company, location) ensures the dashboard never shows
  // visual duplicates, regardless of how many URL variants exist in the table.
  // The subquery deduplicates, picking the most-recently-published row for
  // each unique (title, company, location) group; the outer query re-sorts
  // chronologically so the dashboard's default order is preserved.
  const result = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))))
              id, url_hash, title, company, location, url, source, sources, date_text, published_at, role_origin, country,
              description, requirements, technologies, employment_type, salary_min, salary_max, salary_currency, salary_raw, applicant_count,
              (published_at > NOW() - INTERVAL '48 hours') AS is_locked
       FROM jobs
       WHERE is_active = TRUE
       ORDER BY lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))), published_at DESC, id DESC
     ) deduped
     ORDER BY published_at DESC, id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return result.rows.map((row) => {
    const sources: string[] = Array.isArray(row.sources) ? row.sources : [];
    const alsoIn = sources.filter((s) => s !== row.source);

    return {
      jobId: row.id,
      title: row.title,
      company: row.company,
      location: row.location,
      url: row.url,
      dateText: row.date_text,
      source: row.source,
      sources,
      alsoIn,
      role_origin: row.role_origin,
      country: row.country,
      publishedAt: row.published_at,
      isLocked: row.is_locked,
      description: row.description,
      requirements: Array.isArray(row.requirements) ? row.requirements : [],
      technologies: Array.isArray(row.technologies) ? row.technologies : [],
      employmentType: row.employment_type,
      applicantCount: row.applicant_count,
      salary: buildSalaryLabel(row)
    };
  });
}

// Same DISTINCT ON dedupe as getJobs(), but omits description/requirements/
// technologies from the SELECT list. Those three columns (jsonb + long text)
// are most of getJobs()'s row weight at this corpus size, yet most callers
// (sitemap, category hub pages, /empresas, /dashboard SSR, company search)
// only ever read title/company/location/url/salary — never the job body.
// Egress incident 2026-08-15: those callers' shared cache (getJobsCached)
// was refetching the full heavy corpus every 120s regardless, and public
// bot/crawler traffic (not the 32 real MAU) drove that into 81GB/5GB quota
// exceeded. Callers that DO need the body for one specific job (the
// /empleos/:id and /api/jobs/:id detail routes) use getJobById() instead of
// pulling every row's description just to find one.
export async function getJobsLight(
  limit: number = DEFAULT_JOBS_LIMIT,
  offset: number = 0
): Promise<any[]> {
  const result = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))))
              id, url_hash, title, company, location, url, source, sources, date_text, published_at, role_origin, country,
              employment_type, salary_min, salary_max, salary_currency, salary_raw, applicant_count,
              (published_at > NOW() - INTERVAL '48 hours') AS is_locked
       FROM jobs
       WHERE is_active = TRUE
       ORDER BY lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))), published_at DESC, id DESC
     ) deduped
     ORDER BY published_at DESC, id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return result.rows.map((row: any) => {
    const sources: string[] = Array.isArray(row.sources) ? row.sources : [];
    const alsoIn = sources.filter((s) => s !== row.source);

    return {
      jobId: row.id,
      title: row.title,
      company: row.company,
      location: row.location,
      url: row.url,
      dateText: row.date_text,
      source: row.source,
      sources,
      alsoIn,
      role_origin: row.role_origin,
      country: row.country,
      publishedAt: row.published_at,
      isLocked: row.is_locked,
      description: null,
      requirements: [] as string[],
      technologies: [] as string[],
      employmentType: row.employment_type,
      applicantCount: row.applicant_count,
      salary: buildSalaryLabel(row)
    };
  });
}

/**
 * Single-row fetch for the job-detail routes (/empleos/:id, /api/jobs/:id):
 * these need the full body (description/requirements/technologies) for
 * exactly one job, never the whole corpus. `id` always comes from a link
 * this app itself generated (sitemap/list/category page), which only ever
 * points at the row DISTINCT ON already picked as canonical for its
 * (title, company, location) group — so a plain `WHERE id = $1` is the same
 * row getJobs()'s dedupe would have returned, without re-deduping 10k rows
 * to find it.
 */
export async function getJobById(id: string): Promise<any | null> {
  const result = await pool.query(
    `SELECT id, url_hash, title, company, location, url, source, sources, date_text, published_at, role_origin, country,
            description, requirements, technologies, employment_type, salary_min, salary_max, salary_currency, salary_raw, applicant_count,
            (published_at > NOW() - INTERVAL '48 hours') AS is_locked
     FROM jobs
     WHERE id = $1 AND is_active = TRUE
     LIMIT 1`,
    [id]
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const sources: string[] = Array.isArray(row.sources) ? row.sources : [];
  const alsoIn = sources.filter((s) => s !== row.source);

  return {
    jobId: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    url: row.url,
    dateText: row.date_text,
    source: row.source,
    sources,
    alsoIn,
    role_origin: row.role_origin,
    country: row.country,
    publishedAt: row.published_at,
    isLocked: row.is_locked,
    description: row.description,
    requirements: Array.isArray(row.requirements) ? row.requirements : [],
    technologies: Array.isArray(row.technologies) ? row.technologies : [],
    employmentType: row.employment_type,
    applicantCount: row.applicant_count,
    salary: buildSalaryLabel(row)
  };
}

/**
 * Faithful, non-inventive salary label: uses the source's own free-text
 * (`salary_raw`, e.g. Remotive's "OTE $25k - $35k") when present, since
 * that's the exact string the source published. Falls back to formatting
 * salary_min/max with thousands separators — deliberately no compact
 * "9.5M" style rounding/scaling, since the unit (annual? monthly? USD?
 * local currency?) varies per source and guessing it would misrepresent
 * the number. Returns undefined (never a placeholder) when nothing real
 * is available.
 */
function buildSalaryLabel(row: {
  salary_raw?: string | null;
  salary_min?: string | number | null;
  salary_max?: string | number | null;
  salary_currency?: string | null;
}): string | undefined {
  if (row.salary_raw) return row.salary_raw;

  // A bare number with no currency (e.g. GetOnBoard's min_salary/max_salary,
  // which never come with a currency in this API — confirmed live,
  // 2026-08-11) reads as more precise than it is and could be misread as
  // the wrong order of magnitude. Only render the min/max pair once a real
  // currency is attached; otherwise omit rather than show a naked number.
  if (!row.salary_currency) return undefined;

  // Defensivo además del fix en job-posting-jsonld.ts (2026-08-12): filas ya
  // guardadas antes de ese fix pueden tener un 0 literal como "no
  // especificado" (mismo sentinel que RemoteOK) — nunca se muestra como un
  // límite real.
  const min = row.salary_min != null && Number(row.salary_min) > 0 ? Number(row.salary_min) : null;
  const max = row.salary_max != null && Number(row.salary_max) > 0 ? Number(row.salary_max) : null;
  if (min == null && max == null) return undefined;

  const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
  const currency = `${row.salary_currency} `;
  if (min != null && max != null && min !== max) return `${currency}${fmt(min)} – ${fmt(max)}`;
  return `${currency}${fmt(min ?? max ?? 0)}`;
}

// getJobs()'s DISTINCT ON query has no index backing the lower(trim(...))
// expressions it groups/sorts by, so Postgres does a full scan + sort of the
// whole `jobs` table on every call — measured at 500ms-2s against the real
// corpus. GET /api/jobs used to call getJobs() once per dashboard load; once
// pagination made it call this on every scroll/filter change too, that cost
// started showing up as a visible loading spinner on every page. Caching the
// unfiltered corpus for a short TTL turns the expensive query into "at most
// once every 30s across all requests" — everything after that (pagination,
// filtering) is a plain in-memory array operation, effectively free at this
// corpus size. A proper fix is a matching functional index in Postgres; this
// is the immediate, zero-schema-risk mitigation.
let jobsCache: { data: any[]; expiresAt: number } | null = null;
let jobsCachePending: Promise<any[]> | null = null;
// Scraping runs on an hours-long per-role cadence, so several minutes of
// staleness here is invisible in practice. Raised from 120s to 10min after
// the 2026-08-15 egress incident (see getJobsLight()'s comment): at 120s,
// public bot/crawler traffic alone was enough to refetch this heavy query
// every ~16min around the clock and blow a 5GB/month quota. 10min still
// means the corpus is never more than one scrape-cycle-fraction stale.
const JOBS_CACHE_TTL_MS = 10 * 60_000;

export async function getJobsCached(limit: number = DEFAULT_JOBS_LIMIT): Promise<any[]> {
  const now = Date.now();
  if (jobsCache && jobsCache.expiresAt > now) return jobsCache.data;
  if (jobsCachePending) return jobsCachePending;

  jobsCachePending = getJobs(limit)
    .then((data) => {
      jobsCache = { data, expiresAt: Date.now() + JOBS_CACHE_TTL_MS };
      jobsCachePending = null;
      return data;
    })
    .catch((err) => {
      jobsCachePending = null;
      throw err;
    });
  return jobsCachePending;
}

let jobsLightCache: { data: any[]; expiresAt: number } | null = null;
let jobsLightCachePending: Promise<any[]> | null = null;

export async function getJobsLightCached(limit: number = DEFAULT_JOBS_LIMIT): Promise<any[]> {
  const now = Date.now();
  if (jobsLightCache && jobsLightCache.expiresAt > now) return jobsLightCache.data;
  if (jobsLightCachePending) return jobsLightCachePending;

  jobsLightCachePending = getJobsLight(limit)
    .then((data) => {
      jobsLightCache = { data, expiresAt: Date.now() + JOBS_CACHE_TTL_MS };
      jobsLightCachePending = null;
      return data;
    })
    .catch((err) => {
      jobsLightCachePending = null;
      throw err;
    });
  return jobsLightCachePending;
}

/**
 * Applies the 48h freshness paywall to a jobs array for the public API response.
 * Pro sessions pass through unchanged; free/anonymous callers get sensitive
 * fields nulled out on locked (< 48h) jobs, keeping title/source visible so
 * the frontend can render a truthful (not invented) teaser.
 */
export function maskLockedFields(jobs: any[], tier: SubscriptionTier): any[] {
  if (!PAYWALL_ENABLED || tier === "pro" || tier === "pro_max") {
    return jobs.map((job) => ({ ...job, isLocked: false }));
  }
  return jobs.map((job) => {
    if (!job.isLocked) return job;
    return {
      ...job,
      company: null,
      location: null,
      url: null,
      dateText: null,
      // Rich detail is part of the same freshness gate as the rest of a
      // locked job's identifying info — a free-tier user shouldn't get the
      // full description/requirements/salary for a <48h posting just
      // because those fields happen to live on a different column set.
      description: null,
      requirements: [],
      technologies: [],
      employmentType: null,
      salary: null,
      applicantCount: null
    };
  });
}

/**
 * Retrieves all scraping runs (history browsing only — out of paywall scope,
 * left on the local JSON cache rather than migrated to Postgres in this phase).
 */
export async function getRuns() {
  return getAllCachedRuns();
}

/**
 * Test-only helper: empties the jobs table for isolated test runs. Wipes
 * REAL production data too since jobs share one table with no test schema —
 * blocked unless explicitly activated, so it can never fire from just
 * running `npm run test:*` out of habit.
 */
export async function clearRepository(): Promise<void> {
  if (process.env.ALLOW_TEST_DB_WIPE !== "true") {
    throw new Error(
      "[JobRepository] clearRepository() está desactivado — borraría TODAS las vacantes reales de la tabla `jobs`. " +
        "Para correr un test que lo necesita, actívalo explícitamente: ALLOW_TEST_DB_WIPE=true npm run <script>."
    );
  }
  await pool.query("TRUNCATE TABLE jobs CASCADE");
}

// --- Users / subscription tier -------------------------------------------------

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  subscriptionTier: SubscriptionTier;
  subscriptionEnd: string | null;
  preferredRoles: string[] | null;
  /** Fase 1 de docs/RESUME-STUDIO-PLAN.md — flag por-usuario del beta,
   * DEFAULT false en el schema. No confundir con RESUME_STUDIO_ENABLED (env,
   * kill-switch de despliegue) — este campo solo importa si ese env es true. */
  resumeStudioBeta: boolean;
}

function effectiveTier(row: {
  subscription_tier: string;
  subscription_end: string | null;
}): SubscriptionTier {
  // Bug real encontrado por el asesor antes de escribir el resto de Fase
  // 10 (docs/CV-GENERATION-PLAN.md §10): esta función hardcodeaba
  // `!== "pro"` y devolvía "pro" a secas — con `subscription_tier =
  // 'pro_max'` ya escrito en la fila, esto devolvía "free"
  // incondicionalmente. Sin este fix, un usuario que paga $29.900 por
  // Pro Max queda bloqueado de TODO lo que Pro Max debería desbloquear —
  // compilaría limpio, pero rompería el producto en producción real.
  if (row.subscription_tier !== "pro" && row.subscription_tier !== "pro_max") return "free";
  if (row.subscription_end && new Date(row.subscription_end).getTime() < Date.now()) return "free";
  return row.subscription_tier as SubscriptionTier;
}

/**
 * Upserts a user row keyed by the verified Supabase auth UID (never client-supplied).
 */
export async function getOrCreateUser(
  authUid: string,
  email: string,
  name?: string | null
): Promise<AppUser> {
  const result = await pool.query(
    `INSERT INTO users (id, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, email, name, subscription_tier, subscription_end, preferred_roles, resume_studio_beta`,
    [authUid, email, name ?? null]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    subscriptionTier: effectiveTier(row),
    subscriptionEnd: row.subscription_end,
    preferredRoles: row.preferred_roles,
    resumeStudioBeta: row.resume_studio_beta
  };
}

/**
 * Updates the display name for a user keyed by their verified Supabase auth
 * UID — callers must have already run this UID through verifySession, never
 * a client-supplied id.
 */
export async function updateUserName(authUid: string, name: string): Promise<AppUser> {
  const result = await pool.query(
    `UPDATE users SET name = $2 WHERE id = $1
     RETURNING id, email, name, subscription_tier, subscription_end, preferred_roles, resume_studio_beta`,
    [authUid, name]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    subscriptionTier: effectiveTier(row),
    subscriptionEnd: row.subscription_end,
    preferredRoles: row.preferred_roles,
    resumeStudioBeta: row.resume_studio_beta
  };
}

/**
 * Persists the roles a user picked in the post-signup onboarding step.
 * `roles` may be an empty array (user explicitly chose none) — that still
 * counts as "onboarding completed", distinct from the NULL default that
 * means the step hasn't been seen yet.
 */
export async function updateUserPreferredRoles(authUid: string, roles: string[]): Promise<AppUser> {
  const result = await pool.query(
    `UPDATE users SET preferred_roles = $2::jsonb WHERE id = $1
     RETURNING id, email, name, subscription_tier, subscription_end, preferred_roles, resume_studio_beta`,
    [authUid, JSON.stringify(roles)]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    subscriptionTier: effectiveTier(row),
    subscriptionEnd: row.subscription_end,
    preferredRoles: row.preferred_roles,
    resumeStudioBeta: row.resume_studio_beta
  };
}

export async function getUserTier(authUid: string): Promise<SubscriptionTier> {
  const result = await pool.query(
    `SELECT subscription_tier, subscription_end FROM users WHERE id = $1`,
    [authUid]
  );
  if (result.rows.length === 0) return "free";
  return effectiveTier(result.rows[0]);
}

export async function upgradeUserToPro(authUid: string, until: Date): Promise<void> {
  await pool.query(
    `UPDATE users SET subscription_tier = 'pro', subscription_end = $2 WHERE id = $1`,
    [authUid, until.toISOString()]
  );
}

/** Fase 10 (docs/CV-GENERATION-PLAN.md §10) — mismo patrón que
 * `upgradeUserToPro`, tier separado en vez de un parámetro genérico
 * para que ningún caller pueda pasar un string arbitrario a la columna. */
export async function upgradeUserToProMax(authUid: string, until: Date): Promise<void> {
  await pool.query(
    `UPDATE users SET subscription_tier = 'pro_max', subscription_end = $2 WHERE id = $1`,
    [authUid, until.toISOString()]
  );
}

// --- Payment transactions --------------------------------------------------------

export interface PendingTransactionInput {
  userId: string;
  reference: string;
  amountInCents: number;
  currency: string;
  /** Fase 10: qué tier este pago debe otorgar al aprobarse — el webhook
   * (`markTransactionApproved` abajo) lo devuelve para decidir entre
   * `upgradeUserToPro`/`upgradeUserToProMax`. Default 'pro' preserva el
   * comportamiento de todo caller anterior a Fase 10 sin tocarlos. */
  plan?: "pro" | "pro_max";
}

export async function createPendingTransaction(input: PendingTransactionInput): Promise<void> {
  await pool.query(
    `INSERT INTO transactions (user_id, reference, amount_in_cents, currency, status, plan)
     VALUES ($1, $2, $3, $4, 'pending', $5)`,
    [input.userId, input.reference, input.amountInCents, input.currency, input.plan ?? "pro"]
  );
}

export interface TransactionRecord {
  id: string;
  reference: string;
  status: string;
  amountInCents: number;
  currency: string;
  plan: string;
  createdAt: string;
}

/** Payment history for a user's own Account page — newest first. */
export async function getTransactionsForUser(authUid: string): Promise<TransactionRecord[]> {
  const result = await pool.query(
    `SELECT id, reference, status, amount_in_cents, currency, plan, created_at
     FROM transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [authUid]
  );
  return result.rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    status: row.status,
    amountInCents: Number(row.amount_in_cents),
    currency: row.currency,
    plan: row.plan,
    createdAt: row.created_at
  }));
}

/**
 * Marks a transaction approved idempotently — a webhook retry from Wompi
 * (they retry up to 3x on non-200) finds status already 'approved' and no-ops.
 */
export async function markTransactionApproved(
  reference: string,
  wompiTransactionId: string
): Promise<{ userId: string; plan: "pro" | "pro_max" } | null> {
  const result = await pool.query(
    `UPDATE transactions
     SET status = 'approved', wompi_transaction_id = $2, updated_at = NOW()
     WHERE reference = $1 AND status <> 'approved'
     RETURNING user_id, plan`,
    [reference, wompiTransactionId]
  );
  if (result.rows.length === 0) return null;
  return { userId: result.rows[0].user_id, plan: result.rows[0].plan };
}
