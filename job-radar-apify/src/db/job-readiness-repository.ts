/**
 * Persistence side of the Google readiness gate (Job SEO V2, phases B/C).
 *
 * - refreshGoogleReadiness(): runs THE evaluator (src/lib/google-job-readiness.ts)
 *   against one row, stores the verdict, and — in the same transaction —
 *   enqueues URL_UPDATED only on a real transition (first time ready, or a
 *   content change of an already-ready job). A crash anywhere leaves the row
 *   seo_ready = FALSE, which is the safe side: no JobPosting, no sitemap, no
 *   notification. The hourly reconcile re-evaluates rows never evaluated.
 * - Detail state machine (pending/retry/no_detail/failed/complete/rejected)
 *   with bounded attempts and backoff, restart-safe because it lives in Postgres.
 */
import crypto from "crypto";
import type { PoolClient } from "pg";
import { pool } from "./client.js";
import { canonicalSql, evaluateGoogleJobReadiness, type ReadinessResult } from "../lib/google-job-readiness.js";
import { assessDescription } from "../lib/job-description-quality.js";
import { buildJobUrl } from "../lib/job-seo.js";
import { enqueueIndexingNotificationsWith, INDEXING_PRIORITY } from "./indexing-repository.js";
import type { JobDetail } from "../sources/types.js";

export type DetailStatus =
  | "pending"
  | "retry"
  | "no_detail"
  | "failed"
  | "unsupported"
  | "complete"
  | "rejected"
  | "backlog";

/** Backoff after the Nth failed attempt (1-based). Bounded: after the last one the job stops. */
export const DETAIL_BACKOFF_MS = [30 * 60_000, 2 * 3_600_000, 8 * 3_600_000, 24 * 3_600_000] as const;
export const DETAIL_MAX_ATTEMPTS = DETAIL_BACKOFF_MS.length;
/** A page that yielded nothing is re-tried less: sources rarely publish detail late. */
export const NO_DETAIL_MAX_ATTEMPTS = 2;
/** A claimed row is invisible to other ticks for this long; a crashed tick's rows come back after it. */
export const DETAIL_CLAIM_LEASE_MS = 10 * 60_000;

export const ROW_COLUMNS = `j.id, j.title, j.company, j.location, j.country, j.url, j.published_at, j.is_active,
  j.description, j.requirements, j.employment_type, j.salary_raw, j.salary_min, j.salary_max, j.salary_currency,
  j.description_kind, j.remote_type, j.applicant_countries, j.valid_through,
  j.seo_ready, j.seo_ready_at, j.content_hash`;

export const IS_CANONICAL_SQL = canonicalSql("j");

export interface ReadinessRow {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  country: string | null;
  url: string | null;
  published_at: string | Date;
  is_active: boolean | null;
  description: string | null;
  requirements: unknown;
  employment_type: string | null;
  salary_raw: string | null;
  salary_min: string | number | null;
  salary_max: string | number | null;
  salary_currency: string | null;
  description_kind: string | null;
  remote_type: string | null;
  applicant_countries: unknown;
  valid_through: string | Date | null;
  seo_ready: boolean;
  seo_ready_at: string | Date | null;
  content_hash: string | null;
  is_canonical?: boolean;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function evaluateRow(row: ReadinessRow, now = new Date()): ReadinessResult {
  return evaluateGoogleJobReadiness(
    {
      title: row.title,
      company: row.company,
      location: row.location,
      country: row.country,
      url: row.url,
      publishedAt: row.published_at,
      description: row.description,
      requirements: asStringArray(row.requirements),
      descriptionKind: row.description_kind,
      remoteType: row.remote_type,
      applicantCountries: asStringArray(row.applicant_countries),
      validThrough: row.valid_through,
      isActive: row.is_active !== false,
      isCanonical: row.is_canonical !== false
    },
    now
  );
}

/**
 * Hash of everything the public page and its JobPosting show. A change here is
 * a "meaningful update"; a re-scrape of unchanged content never changes it.
 */
export function computeContentHash(row: ReadinessRow): string {
  const payload = JSON.stringify([
    row.title,
    row.company,
    row.location,
    row.country,
    row.url,
    row.description,
    asStringArray(row.requirements),
    row.employment_type,
    row.salary_raw,
    row.salary_min == null ? null : String(row.salary_min),
    row.salary_max == null ? null : String(row.salary_max),
    row.salary_currency,
    row.remote_type,
    asStringArray(row.applicant_countries),
    row.valid_through ? new Date(row.valid_through).toISOString() : null
  ]);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export interface RefreshOutcome {
  ready: boolean;
  reasons: string[];
  /** "first_ready" = URL_UPDATED queued at priority 2; "content_changed" = priority 3. */
  notified: "first_ready" | "content_changed" | null;
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Evaluates one job and persists the verdict. `contentObtained` marks that the
 * caller just wrote real source content, so content_updated_at (the sitemap's
 * <lastmod>) may move — it never moves just because the row was re-evaluated.
 */
export async function refreshGoogleReadiness(
  jobId: string,
  options: { contentObtained?: boolean; now?: Date } = {}
): Promise<RefreshOutcome | null> {
  const now = options.now ?? new Date();
  return withTransaction(async (client) => {
    const result = await client.query<ReadinessRow>(
      `SELECT ${ROW_COLUMNS}, ${IS_CANONICAL_SQL} AS is_canonical FROM jobs j WHERE j.id = $1 FOR UPDATE OF j`,
      [jobId]
    );
    const row = result.rows[0];
    if (!row) return null;

    const verdict = evaluateRow(row, now);
    const hash = computeContentHash(row);
    const hashChanged = row.content_hash !== null && row.content_hash !== hash;
    const firstReady = verdict.ready && row.seo_ready_at === null;
    const changedWhileReady = verdict.ready && !firstReady && (hashChanged || row.seo_ready !== true);

    await client.query(
      `UPDATE jobs SET
         seo_ready = $2::boolean,
         seo_reasons = $3::jsonb,
         seo_evaluated_at = $4::timestamptz,
         seo_ready_at = CASE WHEN $2::boolean AND seo_ready_at IS NULL THEN $4::timestamptz ELSE seo_ready_at END,
         content_hash = $5::text,
         content_updated_at = CASE
           WHEN $6::boolean AND (content_hash IS DISTINCT FROM $5::text OR content_updated_at IS NULL) THEN $4::timestamptz
           ELSE content_updated_at END
       WHERE id = $1`,
      [jobId, verdict.ready, JSON.stringify(verdict.reasons), now, hash, options.contentObtained === true]
    );

    // Not ready (any more): a still-pending update for this job must never be
    // sent. Superseded — terminal, history kept — in the same transaction.
    if (!verdict.ready) {
      await client.query(
        `UPDATE indexing_queue SET status = 'superseded', superseded_at = $2, superseded_reason = 'target_not_seo_ready'
         WHERE job_id = $1 AND notification_type = 'URL_UPDATED' AND status = 'pending'`,
        [jobId, now]
      );
    }

    let notified: RefreshOutcome["notified"] = null;
    if (firstReady || changedWhileReady) {
      notified = firstReady ? "first_ready" : "content_changed";
      await enqueueIndexingNotificationsWith(client, [
        {
          url: buildJobUrl({ jobId: row.id, title: row.title, location: row.location }),
          type: "URL_UPDATED",
          priority: firstReady ? INDEXING_PRIORITY.newlyReady : INDEXING_PRIORITY.contentUpdate,
          jobId: row.id,
          contentHash: hash
        }
      ]);
    }
    return { ready: verdict.ready, reasons: verdict.reasons, notified };
  });
}

// --- Detail state machine -----------------------------------------------------

/** Initial detail_status for a freshly inserted row (never "public by default"). */
export function initialDetailStatus(
  job: { title?: string; company?: string; location?: string; description?: string; requirements?: string[]; descriptionKind?: string },
  supportsDetail: boolean
): { status: DetailStatus; lastError: string | null } {
  const quality = assessDescription(job);
  if (quality.ok) return { status: "complete", lastError: null };
  if (supportsDetail) return { status: "pending", lastError: null };
  return { status: "unsupported", lastError: quality.reasons[0] ?? "NO_DETAIL_ADAPTER" };
}

export interface ClaimedDetailJob {
  id: string;
  url: string;
  source: string;
  country: string | null;
  detail_attempts: number;
}

/**
 * Claims due rows. `FOR UPDATE SKIP LOCKED` keeps two concurrent ticks (CO and
 * VE run in parallel) from fetching the same page; pushing
 * detail_next_attempt_at forward is the lease a crashed tick leaves behind.
 * Only 'pending'/'retry' — legacy 'backlog' rows belong to the historical
 * backfill (separate authorization) and are never claimed here.
 *
 * `market` routes rows to the adapter whose circuit/policy must see the
 * request: VE rows to the -VE adapter, everything else to the CO one.
 */
export async function claimDueDetailJobs(
  filter: { source: string; market: "VE" | "OTHER"; ids?: undefined } | { ids: string[] },
  limit: number
): Promise<ClaimedDetailJob[]> {
  if (limit <= 0) return [];
  if (filter.ids) {
    // In-tick slice: the ids ARE the rows this adapter just inserted, and the
    // adapter implementing fetchDetail is the runtime evidence of detail
    // support — so a row the label registry marked 'unsupported' is promoted
    // to 'pending' here. A row already 'complete' is never claimed.
    const result = await pool.query<ClaimedDetailJob>(
      `UPDATE jobs SET
         detail_status = CASE WHEN detail_status = 'unsupported' THEN 'pending' ELSE detail_status END,
         detail_next_attempt_at = NOW() + ($3::int * INTERVAL '1 millisecond')
       WHERE id IN (
         SELECT id FROM jobs
         WHERE id = ANY($1::uuid[])
           AND is_active = TRUE
           AND (detail_status IN ('pending', 'retry') OR (detail_status = 'unsupported' AND description IS NULL))
           AND (detail_next_attempt_at IS NULL OR detail_next_attempt_at <= NOW())
         ORDER BY created_at ASC, id ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, url, source, country, detail_attempts`,
      [filter.ids, limit, DETAIL_CLAIM_LEASE_MS]
    );
    return result.rows;
  }
  const result = await pool.query<ClaimedDetailJob>(
    `UPDATE jobs SET detail_next_attempt_at = NOW() + ($3::int * INTERVAL '1 millisecond')
     WHERE id IN (
       SELECT id FROM jobs
       WHERE detail_status IN ('pending', 'retry')
         AND detail_next_attempt_at <= NOW()
         AND is_active = TRUE
         AND source = $1
         AND (CASE WHEN $4 = 'VE' THEN country = 'VE' ELSE country IS DISTINCT FROM 'VE' END)
       ORDER BY detail_next_attempt_at ASC, id ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, url, source, country, detail_attempts`,
    [filter.source, limit, DETAIL_CLAIM_LEASE_MS, filter.market]
  );
  return result.rows;
}

export type DetailOutcome =
  | { kind: "success"; detail: Partial<JobDetail> }
  | { kind: "no_detail" }
  | { kind: "fault"; errorClass: string; retryAfterMs?: number };

/**
 * Applies one detail attempt's outcome. Compare-and-set on the status so a
 * late/duplicate result can never move a row that another path already settled.
 */
export async function recordDetailOutcome(jobId: string, outcome: DetailOutcome, now = new Date()): Promise<DetailStatus | null> {
  if (outcome.kind === "success") {
    const detail = outcome.detail;
    const written = await pool.query(
      `UPDATE jobs SET
         description = COALESCE($2::text, description),
         requirements = COALESCE($3::jsonb, requirements),
         technologies = COALESCE($4::jsonb, technologies),
         employment_type = COALESCE($5, employment_type),
         salary_min = COALESCE($6, salary_min),
         salary_max = COALESCE($7, salary_max),
         salary_currency = COALESCE($8, salary_currency),
         salary_raw = COALESCE($9, salary_raw),
         applicant_count = COALESCE($10, applicant_count),
         remote_type = COALESCE($11, remote_type),
         applicant_countries = COALESCE($12::jsonb, applicant_countries),
         valid_through = COALESCE($13, valid_through),
         description_source = CASE WHEN $2::text IS NOT NULL THEN 'detail' ELSE description_source END,
         description_kind = CASE WHEN $2::text IS NOT NULL THEN 'full' ELSE description_kind END,
         description_fetched_at = $14,
         detail_attempts = detail_attempts + 1,
         detail_next_attempt_at = NULL
       WHERE id = $1 AND detail_status IN ('pending', 'retry')
       RETURNING title, company, location, description, requirements, description_kind`,
      [
        jobId,
        detail.description ?? null,
        detail.requirements ? JSON.stringify(detail.requirements) : null,
        detail.technologies ? JSON.stringify(detail.technologies) : null,
        detail.employmentType ?? null,
        detail.salaryMin ?? null,
        detail.salaryMax ?? null,
        detail.salaryCurrency ?? null,
        detail.salaryRaw ?? null,
        detail.applicantCount ?? null,
        detail.remoteType ?? null,
        detail.applicantCountries && detail.applicantCountries.length > 0 ? JSON.stringify(detail.applicantCountries) : null,
        detail.validThrough ?? null,
        now
      ]
    );
    const row = written.rows[0];
    if (!row) return null;
    const quality = assessDescription({
      title: row.title,
      company: row.company,
      location: row.location,
      description: row.description,
      requirements: asStringArray(row.requirements),
      descriptionKind: row.description_kind
    });
    const status: DetailStatus = quality.ok ? "complete" : "rejected";
    await pool.query(`UPDATE jobs SET detail_status = $2, detail_last_error = $3 WHERE id = $1`, [
      jobId,
      status,
      quality.ok ? null : quality.reasons[0]
    ]);
    await refreshGoogleReadiness(jobId, { contentObtained: true, now });
    return status;
  }

  const current = await pool.query<{ detail_attempts: number }>(
    `SELECT detail_attempts FROM jobs WHERE id = $1 AND detail_status IN ('pending', 'retry')`,
    [jobId]
  );
  if (!current.rows[0]) return null;
  const attempts = current.rows[0].detail_attempts + 1;
  const isNoDetail = outcome.kind === "no_detail";
  const exhausted = attempts >= (isNoDetail ? NO_DETAIL_MAX_ATTEMPTS : DETAIL_MAX_ATTEMPTS);
  const status: DetailStatus = exhausted ? (isNoDetail ? "no_detail" : "failed") : "retry";
  const backoff = DETAIL_BACKOFF_MS[Math.min(attempts, DETAIL_BACKOFF_MS.length) - 1];
  const waitMs = Math.max(backoff, outcome.kind === "fault" ? outcome.retryAfterMs ?? 0 : 0);
  const lastError = isNoDetail ? "NO_DETAIL" : outcome.errorClass.slice(0, 100);
  await pool.query(
    `UPDATE jobs SET detail_status = $2, detail_attempts = $3, detail_last_error = $4,
       detail_next_attempt_at = CASE WHEN $5::boolean THEN NULL ELSE $6::timestamptz END
     WHERE id = $1 AND detail_status IN ('pending', 'retry')`,
    [jobId, status, attempts, lastError, exhausted, new Date(now.getTime() + waitMs)]
  );
  return status;
}
