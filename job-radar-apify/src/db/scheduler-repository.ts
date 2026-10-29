import { pool } from "./client.js";
import type { QueryResultRow } from "pg";
import { buildJobUrl, isPubliclyDescribable } from "../lib/job-seo.js";
import { apiNotifiedUrls, DELETE_NOT_API_NOTIFIED, enqueueIndexingNotifications, INDEXING_PRIORITY } from "./indexing-repository.js";
import { pruneExpiredUrlHashes, recordExpiredUrlHashes } from "./expired-job-repository.js";
import { liveJobSql, MAX_JOB_AGE_DAYS } from "../lib/job-freshness.js";
import { orderDueGlobalSources } from "../queue/source-cadence.js";
import { pruneJobArchive } from "./job-archive-repository.js";

/**
 * Idempotent upsert of the known role list into `search_roles` — safe to
 * call on every boot. Roles already present (or later deactivated by an
 * admin) are left untouched.
 */
export async function seedSearchRoles(roleNames: string[]): Promise<void> {
  for (const name of roleNames) {
    await pool.query(`INSERT INTO search_roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [
      name
    ]);
  }
}

export async function getActiveRoleNames(): Promise<string[]> {
  const result = await pool.query(
    `SELECT name FROM search_roles WHERE is_active = TRUE ORDER BY name`
  );
  return result.rows.map((r) => r.name);
}

/**
 * For every active role, returns which sources are due for a re-scrape
 * (never run, or last run longer ago than that source's configured
 * cadence). Grouped by role so the cron can enqueue one work item per role.
 */
export async function getDueRoleSources(
  cadenceMs: Record<string, number>
): Promise<Map<string, string[]>> {
  const roles = await getActiveRoleNames();
  const due = new Map<string, string[]>();
  if (roles.length === 0) return due;

  const result = await pool.query(
    `SELECT role_name, source_name, last_run_at FROM role_source_runs WHERE role_name = ANY($1)`,
    [roles]
  );

  const lastRun = new Map<string, number>();
  for (const row of result.rows) {
    lastRun.set(`${row.role_name}::${row.source_name}`, new Date(row.last_run_at).getTime());
  }

  const now = Date.now();
  for (const role of roles) {
    const dueSources: string[] = [];
    for (const [source, cadence] of Object.entries(cadenceMs)) {
      const lastRunAt = lastRun.get(`${role}::${source}`);
      if (lastRunAt === undefined || now - lastRunAt >= cadence) {
        dueSources.push(source);
      }
    }
    if (dueSources.length > 0) {
      due.set(role, dueSources);
    }
  }

  return due;
}

/**
 * Forces a role to be picked up by the next scheduled tick, regardless of its
 * sources' normal cadence — used by the authenticated manual "rescan" trigger.
 * Scraping itself always runs out-of-process (GitHub Actions), never inline
 * on the web request, so this just clears the role's cadence bookkeeping
 * instead of running anything synchronously.
 */
export async function markRoleForImmediateRescan(roleName: string): Promise<void> {
  await pool.query(`DELETE FROM role_source_runs WHERE role_name = $1`, [roleName]);
}

export async function markRoleSourceRun(roleName: string, sourceName: string): Promise<void> {
  await pool.query(
    `INSERT INTO role_source_runs (role_name, source_name, last_run_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (role_name, source_name) DO UPDATE SET last_run_at = NOW()`,
    [roleName, sourceName]
  );
}

// Sentinel "role" used to track cadence for catalog-wide sources that ignore
// role/keywords entirely (RemoteOK, GetOnBoard, WeRemoto, Jooble) — see
// getDueGlobalSources below. Not a real row in `search_roles`; it only ever
// appears as a role_name in `role_source_runs`.
const GLOBAL_ROLE_SENTINEL = "__global__";

/**
 * Due-check for sources whose adapter returns the same feed no matter which
 * role asks (they don't take keywords). Tracking their cadence per-role like
 * getDueRoleSources does would re-fetch the identical catalog once per every
 * active role — wasted requests for zero extra coverage. These instead share
 * one cadence entry per source, under the sentinel "role" above, so each
 * runs once per cadence window regardless of how many roles are active.
 */
export async function getDueGlobalSources(cadenceMs: Record<string, number>): Promise<string[]> {
  const sourceNames = Object.keys(cadenceMs);
  if (sourceNames.length === 0) return [];

  const result = await pool.query(
    `SELECT source_name, last_run_at FROM role_source_runs
     WHERE role_name = $1 AND source_name = ANY($2)`,
    [GLOBAL_ROLE_SENTINEL, sourceNames]
  );

  const lastRun = new Map<string, number>();
  for (const row of result.rows) {
    lastRun.set(row.source_name, new Date(row.last_run_at).getTime());
  }

  const now = Date.now();
  const due = sourceNames.filter((source) => {
    const lastRunAt = lastRun.get(source);
    return lastRunAt === undefined || now - lastRunAt >= cadenceMs[source];
  });
  return orderDueGlobalSources(due, lastRun);
}

export async function markGlobalSourceRun(sourceName: string): Promise<void> {
  await markRoleSourceRun(GLOBAL_ROLE_SENTINEL, sourceName);
}

/**
 * Cron C: atomically moves retired jobs into the private archive (ADR 0008).
 * Public reads already enforce the same 30-day/deadline rule, independent
 * of tick timing. Re-seeing a source never renews the original publication.
 * Keep batches bounded; archive failure rolls back the live-row removal.
 */
export const PURGE_BATCH_LIMIT = 2_000;

export async function purgeOldJobs(limit: number = PURGE_BATCH_LIMIT, dryRun = false): Promise<number> {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, 20_000));
  const candidates = `SELECT id FROM jobs
       WHERE last_seen_at < NOW() - INTERVAL '${MAX_JOB_AGE_DAYS} days' OR NOT ${liveJobSql()}
       ORDER BY published_at ASC, id ASC LIMIT $1`;
  if (dryRun) return (await pool.query(candidates, [boundedLimit])).rowCount ?? 0;
  const result = await pool.query(
    `WITH retired AS (
       DELETE FROM jobs WHERE id IN (${candidates}) RETURNING *
     ), archived AS (
       INSERT INTO archived_jobs (job_id, url_hash, reason, snapshot)
       SELECT id, url_hash,
              CASE WHEN valid_through <= NOW() THEN 'source_deadline'
                   WHEN published_at < NOW() - INTERVAL '${MAX_JOB_AGE_DAYS} days' THEN 'age_limit'
                   ELSE 'unseen' END,
              to_jsonb(retired) FROM retired
       ON CONFLICT (job_id) DO NOTHING
     ) SELECT id, url_hash, title, company, location, url, source, published_at FROM retired`,
    [boundedLimit]
  );
  await recordRemovedJobs(result.rows, "purgeOldJobs");
  await rememberExpired(result.rows, "expired", "purgeOldJobs");
  await pruneExpiredUrlHashes().catch((err) => console.warn("⚠️ [purgeOldJobs] Poda de expired_job_urls omitida:", err?.message || err));
  await pruneJobArchive().catch(() => console.warn("[purgeOldJobs] Archive maintenance deferred."));
  return result.rowCount ?? 0;
}

// After the tombstones, never before: the DELETE is already committed, so a
// failure here must not cost the 410 path or hash guard: the private archive
// already contains both identities.
async function rememberExpired(rows: { url_hash: string }[], reason: string, caller: string): Promise<void> {
  try {
    await recordExpiredUrlHashes(rows.map((row) => row.url_hash), reason);
  } catch (err) {
    console.warn(`⚠️ [${caller}] No se pudo registrar en expired_job_urls:`, (err as Error)?.message || err);
  }
}

/**
 * Archives jobs the SOURCE confirmed closed (see src/queue/source-closure.ts),
 * through exactly the same tombstone/URL_DELETED path as the age purge, so a
 * closed posting's page answers 410 and leaves the sitemap the same way an
 * expired one does. `is_active = TRUE` in the WHERE keeps a concurrent dedupe
 * cleanup from being double-processed.
 */
export async function deleteClosedJobs(jobIds: string[], dryRun = false): Promise<number> {
  if (jobIds.length === 0) return 0;
  // Bound the public entry point too; existing callers already batch below this cap.
  const ids = [...new Set(jobIds)].slice(0, PURGE_BATCH_LIMIT);
  if (dryRun) return (await pool.query(`SELECT id FROM jobs WHERE id = ANY($1::uuid[]) AND is_active = TRUE`, [ids])).rowCount ?? 0;
  const result = await pool.query(
    `WITH retired AS (
       DELETE FROM jobs WHERE id = ANY($1::uuid[]) AND is_active = TRUE RETURNING *
     ), archived AS (
       INSERT INTO archived_jobs (job_id, url_hash, reason, snapshot)
       SELECT id, url_hash, 'source_closed', to_jsonb(retired) FROM retired
       ON CONFLICT (job_id) DO NOTHING
     ) SELECT id, url_hash, title, company, location, url, source, published_at FROM retired`,
    [ids]
  );
  await recordRemovedJobs(result.rows, "deleteClosedJobs");
  await rememberExpired(result.rows, "source_closed", "deleteClosedJobs");
  return result.rowCount ?? 0;
}

async function recordRemovedJobs(rows: QueryResultRow[], caller: string): Promise<void> {
  const deleted = rows
    .map((row) => ({
      jobId: row.id,
      title: row.title,
      company: row.company,
      location: row.location,
      url: row.url,
      source: row.source,
      publishedAt: row.published_at,
      dateText: ""
    }))
    .filter(isPubliclyDescribable);

  if (deleted.length > 0) {
    try {
      const urls = deleted.map((job) => buildJobUrl(job));
      // ADR 0004 (delete policy D2): a removal is always recorded — the row
      // is the 410 tombstone — but it only takes delete quota when Google
      // received this URL through the Indexing API (a URL_UPDATED really
      // sent). Every other removal is fully expressed by 410 + sitemap
      // removal, so its row is born terminal ('delete_not_api_notified').
      // Any still-pending URL_UPDATED for the same URL is now pointless:
      // superseded, never sent, history kept.
      const notifiedUrls = await apiNotifiedUrls(pool, urls, deleted.map((job) => job.jobId));
      const pairs = deleted.map((job, index) => ({ job, url: urls[index] }));
      const sendable = pairs.filter(({ url }) => notifiedUrls.has(url));
      const tombstoneOnly = pairs.filter(({ url }) => !notifiedUrls.has(url));
      await enqueueIndexingNotifications(
        sendable.map(({ job, url }) => ({ url, type: "URL_DELETED" as const, jobId: job.jobId, priority: INDEXING_PRIORITY.deleted }))
      );
      if (tombstoneOnly.length > 0) {
        await pool.query(
          `INSERT INTO indexing_queue (url, notification_type, status, priority, job_id, superseded_at, superseded_reason)
           SELECT t.url, 'URL_DELETED', 'superseded', $3, t.job_id, NOW(), $4
           FROM unnest($1::text[], $2::uuid[]) AS t(url, job_id)
           WHERE NOT EXISTS (SELECT 1 FROM indexing_queue q WHERE q.url = t.url AND q.notification_type = 'URL_DELETED')`,
          [
            tombstoneOnly.map(({ url }) => url),
            tombstoneOnly.map(({ job }) => job.jobId),
            INDEXING_PRIORITY.reconcile,
            DELETE_NOT_API_NOTIFIED
          ]
        );
      }
      await pool.query(
        `UPDATE indexing_queue SET status = 'superseded', superseded_at = NOW(), superseded_reason = 'target_deleted'
         WHERE status = 'pending' AND notification_type = 'URL_UPDATED' AND url = ANY($1::text[])`,
        [urls]
      );
    } catch (err) {
      console.warn(`⚠️ [${caller}] Failed to enqueue URL_DELETED notifications:`, err);
    }
  }
}
