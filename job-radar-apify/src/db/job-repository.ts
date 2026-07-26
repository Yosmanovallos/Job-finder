import crypto from "crypto";
import dotenv from "dotenv";
import { pool } from "./client.js";
import { Job, normalizeJobUrl } from "../sources/types.js";
import { saveRunToCache, getAllCachedRuns } from "../cache-manager.js";
import { validateJobs } from "./job-validator.js";

dotenv.config();

export type SubscriptionTier = "free" | "pro";

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
export function computeContentFingerprint(job: Job): string {
  const normalized = [
    job.title.toLowerCase().trim(),
    (job.company || "confidencial").toLowerCase().trim(),
    (job.location || "colombia").toLowerCase().trim()
  ].join("|");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Saves a list of scraped jobs to Postgres with url_hash deduplication and sources array merging.
 */
export async function saveJobs(
  jobs: Job[],
  roleOrigin: string = "General"
): Promise<{ savedCount: number; duplicateCount: number }> {
  let savedCount = 0;
  let duplicateCount = 0;

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
      if (!sources.includes(job.source)) {
        await pool.query(`UPDATE jobs SET sources = sources || to_jsonb($2::text) WHERE id = $1`, [
          existing.id,
          job.source
        ]);
      }
      duplicateCount++;
      continue;
    }

    const result = await pool.query(
      `INSERT INTO jobs (url_hash, content_fingerprint, title, company, location, url, source, sources, date_text, published_at, role_origin)
       VALUES ($1, $11, $2, $3, $4, $5, $6, jsonb_build_array($10::text), $7, $8, $9)
       ON CONFLICT (url_hash) DO UPDATE SET
         sources = CASE
           WHEN jobs.sources @> to_jsonb(EXCLUDED.source::text) THEN jobs.sources
           ELSE jobs.sources || to_jsonb(EXCLUDED.source::text)
         END
       RETURNING (xmax = 0) AS inserted`,
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
        fingerprint
      ]
    );

    if (result.rows[0]?.inserted) {
      savedCount++;
    } else {
      duplicateCount++;
    }
  }

  // Also persist run metadata to local JSON cache for GET /api/runs (history browsing, not paywall-relevant)
  try {
    const runId = `run_${Date.now()}`;
    saveRunToCache({
      id: runId,
      name: `${roleOrigin} (${jobs.length} Vacantes)`,
      role: roleOrigin,
      timestamp: new Date().toISOString(),
      jobs: jobs as any[]
    });
  } catch (e) {
    console.warn("[JobRepository] Warning: Could not save run to local cache file:", e);
  }

  console.log(
    `💾 [JobRepository] Guardado en Postgres: ${savedCount} nuevas vacantes, ${duplicateCount} fusionadas en deduplicación.`
  );
  return { savedCount, duplicateCount };
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
       SELECT DISTINCT ON (lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, 'colombia'))))
              id, url_hash, title, company, location, url, source, sources, date_text, published_at, role_origin,
              (published_at > NOW() - INTERVAL '48 hours') AS is_locked
       FROM jobs
       WHERE is_active = TRUE
       ORDER BY lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, 'colombia'))), published_at DESC
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
      publishedAt: row.published_at,
      isLocked: row.is_locked
    };
  });
}

/**
 * Applies the 48h freshness paywall to a jobs array for the public API response.
 * Pro sessions pass through unchanged; free/anonymous callers get sensitive
 * fields nulled out on locked (< 48h) jobs, keeping title/source visible so
 * the frontend can render a truthful (not invented) teaser.
 */
export function maskLockedFields(jobs: any[], tier: SubscriptionTier): any[] {
  if (tier === "pro") return jobs.map((job) => ({ ...job, isLocked: false }));
  return jobs.map((job) => {
    if (!job.isLocked) return job;
    return { ...job, company: null, location: null, url: null, dateText: null };
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
}

function effectiveTier(row: {
  subscription_tier: string;
  subscription_end: string | null;
}): SubscriptionTier {
  if (row.subscription_tier !== "pro") return "free";
  if (row.subscription_end && new Date(row.subscription_end).getTime() < Date.now()) return "free";
  return "pro";
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
     RETURNING id, email, name, subscription_tier, subscription_end`,
    [authUid, email, name ?? null]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    subscriptionTier: effectiveTier(row),
    subscriptionEnd: row.subscription_end
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
     RETURNING id, email, name, subscription_tier, subscription_end`,
    [authUid, name]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    subscriptionTier: effectiveTier(row),
    subscriptionEnd: row.subscription_end
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

// --- Payment transactions --------------------------------------------------------

export interface PendingTransactionInput {
  userId: string;
  reference: string;
  amountInCents: number;
  currency: string;
}

export async function createPendingTransaction(input: PendingTransactionInput): Promise<void> {
  await pool.query(
    `INSERT INTO transactions (user_id, reference, amount_in_cents, currency, status)
     VALUES ($1, $2, $3, $4, 'pending')`,
    [input.userId, input.reference, input.amountInCents, input.currency]
  );
}

export interface TransactionRecord {
  id: string;
  reference: string;
  status: string;
  amountInCents: number;
  currency: string;
  createdAt: string;
}

/** Payment history for a user's own Account page — newest first. */
export async function getTransactionsForUser(authUid: string): Promise<TransactionRecord[]> {
  const result = await pool.query(
    `SELECT id, reference, status, amount_in_cents, currency, created_at
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
): Promise<{ userId: string } | null> {
  const result = await pool.query(
    `UPDATE transactions
     SET status = 'approved', wompi_transaction_id = $2, updated_at = NOW()
     WHERE reference = $1 AND status <> 'approved'
     RETURNING user_id`,
    [reference, wompiTransactionId]
  );
  if (result.rows.length === 0) return null;
  return { userId: result.rows[0].user_id };
}
