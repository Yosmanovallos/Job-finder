import type { PoolClient } from "pg";
import { pool } from "./client.js";
import { NotificationType } from "../lib/google-indexing.js";
import { buildJobUrl, buildJobUrlPrefix } from "../lib/job-seo.js";
import { canonicalSql, seoReadySql } from "../lib/google-job-readiness.js";
import type { LaneQueues, QueueLane, Schedulable } from "../lib/indexing-scheduler.js";

// Google's default Indexing API quota (Search Console-verified project,
// no quota increase requested). Budget is derived from what's actually
// `sent` in the last 24h in the DB, not an in-memory counter — the drain
// script (scripts/run-indexing-tick.ts) runs on a GitHub Actions cron, so an
// in-memory/per-invocation cap would reset every time and blow through the
// real daily limit.
export const DAILY_INDEXING_QUOTA = 200;

/**
 * Send order (Job SEO V2). Lower sends first; ties oldest-first, so nothing
 * inside a lane starves (the FIFO lesson of SEO-IMPROVEMENT-PLAN §1.20).
 * 5 is the column default: every row enqueued before this ordering existed.
 */
export const INDEXING_PRIORITY = {
  deleted: 1,
  newlyReady: 2,
  contentUpdate: 3,
  reconcile: 4,
  legacy: 5
} as const;

/**
 * ADR 0004 — the Indexing API only ACCELERATES what 200/noindex/410 + the
 * sitemap already express. A URL_UPDATED is worth sending only while its
 * version is fresh: 7 days from discovery or from the last real content
 * change. After that it is closed as 'api_window_expired' (telemetry only:
 * the page stays ready, indexable and in the sitemap) and never re-queued.
 */
export const API_NOTIFICATION_WINDOW_DAYS = 7;

/** Terminal, non-sendable reason codes introduced by ADR 0004. */
export const API_WINDOW_EXPIRED = "api_window_expired";
export const DELETE_NOT_API_NOTIFIED = "delete_not_api_notified";

/** SQL: the job's current version is still inside the API window. */
export function withinApiWindowSql(alias: string): string {
  return `COALESCE(${alias}.content_updated_at, ${alias}.created_at) > NOW() - INTERVAL '${API_NOTIFICATION_WINDOW_DAYS} days'`;
}

export interface IndexingQueueEntry {
  url: string;
  type: NotificationType;
  priority?: number;
  jobId?: string | null;
  contentHash?: string | null;
}

type Queryable = Pick<PoolClient, "query">;

/**
 * Idempotent enqueue: at most one sendable notification per Google-visible
 * version. Every producer goes through here, so the invariants live here:
 *
 * - One pending row per (url, type). A second request for a URL already
 *   pending only raises its priority (never lowers it) and carries the newer
 *   content_hash — repeated rediscovery never grows the queue.
 * - Already resolved → nothing: an URL_UPDATED whose (job_id, url,
 *   content_hash) was already sent successfully — or whose API window already
 *   expired (ADR 0004, never resurrected) — or an URL_DELETED whose url was
 *   already sent, is skipped. Identity is the hash, not a time cooldown.
 * - A newer URL_UPDATED for a job supersedes that job's pending URL_UPDATED at
 *   another url (a title/location edit changes the slug): no obsolete stacking.
 *
 * Returns how many entries left a pending row (inserted or raised).
 * Works whether or not uq_indexing_queue_pending_url_type exists yet (see
 * schema.sql's job-seo-v2 block).
 */
export async function enqueueIndexingNotificationsWith(db: Queryable, entries: IndexingQueueEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const urls = entries.map((entry) => entry.url);
  const types = entries.map((entry) => entry.type);
  const priorities = entries.map((entry) => entry.priority ?? INDEXING_PRIORITY.reconcile);
  const jobIds = entries.map((entry) => entry.jobId ?? null);
  const hashes = entries.map((entry) => entry.contentHash ?? null);
  const result = await db.query<{ n: string }>(
    `WITH input AS (
       SELECT DISTINCT ON (url, type) url, type, priority, job_id, content_hash
       FROM unnest($1::text[], $2::text[], $3::int[], $4::uuid[], $5::text[]) AS t(url, type, priority, job_id, content_hash)
       ORDER BY url, type, priority ASC
     ), fresh AS (
       SELECT i.* FROM input i
       WHERE NOT EXISTS (
         SELECT 1 FROM indexing_queue s
         WHERE s.url = i.url AND s.notification_type = i.type
           AND (s.status = 'sent' OR (s.status = 'superseded' AND s.superseded_reason = '${API_WINDOW_EXPIRED}'))
           AND (i.type = 'URL_DELETED'
                OR (i.job_id IS NOT NULL AND i.content_hash IS NOT NULL
                    AND s.job_id = i.job_id AND s.content_hash = i.content_hash))
       )
     ), obsolete AS (
       UPDATE indexing_queue q
       SET status = 'superseded', superseded_at = NOW(), superseded_reason = 'superseded_by_newer'
       FROM fresh i
       WHERE q.status = 'pending' AND q.notification_type = 'URL_UPDATED' AND i.type = 'URL_UPDATED'
         AND i.job_id IS NOT NULL AND q.job_id = i.job_id AND q.url <> i.url
       RETURNING q.id
     ), raised AS (
       UPDATE indexing_queue q
       SET priority = LEAST(q.priority, i.priority),
           job_id = COALESCE(q.job_id, i.job_id),
           content_hash = COALESCE(i.content_hash, q.content_hash)
       FROM fresh i
       WHERE q.status = 'pending' AND q.url = i.url AND q.notification_type = i.type
       RETURNING q.url
     ), inserted AS (
       INSERT INTO indexing_queue (url, notification_type, priority, job_id, content_hash)
       SELECT i.url, i.type, i.priority, i.job_id, i.content_hash
       FROM fresh i
       WHERE NOT EXISTS (
         SELECT 1 FROM indexing_queue q
         WHERE q.status = 'pending' AND q.url = i.url AND q.notification_type = i.type
       )
       ON CONFLICT DO NOTHING
       RETURNING 1
     )
     SELECT (SELECT COUNT(*) FROM raised) + (SELECT COUNT(*) FROM inserted) AS n`,
    [urls, types, priorities, jobIds, hashes]
  );
  return Number(result.rows[0]?.n ?? 0);
}

export async function enqueueIndexingNotifications(entries: IndexingQueueEntry[]): Promise<number> {
  return enqueueIndexingNotificationsWith(pool, entries);
}

// Counts 'failed' attempts too, not just 'sent' — Google's quota is
// consumed by the *request*, not by whether it succeeded. markIndexingFailed
// also stamps sent_at as "attempted at" so a misconfigured service account
// (e.g. wrong Search Console permission) can't burn through 200 real
// requests as silent 403s while this budget check still reads 200/200
// remaining and the next run tries all 200 again. 'superseded' rows were
// never sent, so they never count.
export async function getIndexingBudgetRemaining(): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) AS attempted_today FROM indexing_queue
     WHERE status IN ('sent', 'failed') AND sent_at > NOW() - INTERVAL '24 hours'`
  );
  const attemptedToday = Number(result.rows[0]?.attempted_today ?? 0);
  return Math.max(0, DAILY_INDEXING_QUOTA - attemptedToday);
}

export interface PendingIndexingRow {
  id: string;
  url: string;
  notification_type: NotificationType;
  job_id: string | null;
  priority: number;
}

// Priority lane first, then oldest-first inside the lane. Oldest-first (not
// newest-first) is kept deliberately: confirmed 2026-08-10 that LIFO let a
// continuous stream of new arrivals starve everything already waiting.
export async function getPendingIndexingBatch(limit: number): Promise<PendingIndexingRow[]> {
  if (limit <= 0) return [];
  const result = await pool.query(
    `SELECT id, url, notification_type, job_id, priority FROM indexing_queue
     WHERE status = 'pending'
     ORDER BY priority ASC, created_at ASC, id ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export type PendingLaneRow = PendingIndexingRow & Schedulable & { created_at: Date };

/** Lane of a pending row (ADR 0004): deletes, then URL_UPDATED by priority. */
export function laneOf(row: Pick<PendingIndexingRow, "notification_type" | "priority">): QueueLane {
  if (row.notification_type === "URL_DELETED") return "delete";
  if (row.priority <= INDEXING_PRIORITY.newlyReady) return "new";
  if (row.priority === INDEXING_PRIORITY.contentUpdate) return "content";
  return "reconcile";
}

const LANE_SQL = `CASE WHEN notification_type = 'URL_DELETED' THEN 'delete'
  WHEN priority <= ${INDEXING_PRIORITY.newlyReady} THEN 'new'
  WHEN priority = ${INDEXING_PRIORITY.contentUpdate} THEN 'content' ELSE 'reconcile' END`;

/**
 * The oldest `perLane` pending rows of each lane, for planIndexingSends().
 * Oldest-first inside a lane is deliberate: confirmed 2026-08-10 that LIFO
 * let a continuous stream of new arrivals starve everything already waiting.
 */
export async function getPendingIndexingLanes(perLane: number): Promise<LaneQueues<PendingLaneRow>> {
  const lanes: LaneQueues<PendingLaneRow> = { new: [], delete: [], content: [], reconcile: [] };
  if (perLane <= 0) return lanes;
  const result = await pool.query<PendingIndexingRow & { lane: QueueLane; created_at: Date }>(
    `SELECT id, url, notification_type, job_id, priority, created_at, lane FROM (
       SELECT id, url, notification_type, job_id, priority, created_at, ${LANE_SQL} AS lane,
              ROW_NUMBER() OVER (PARTITION BY ${LANE_SQL} ORDER BY created_at ASC, id ASC) AS rank
       FROM indexing_queue WHERE status = 'pending'
     ) ranked WHERE rank <= $1 ORDER BY created_at ASC, id ASC`,
    [perLane]
  );
  for (const row of result.rows) {
    lanes[row.lane].push({ ...row, arrival: new Date(row.created_at).getTime() / 3_600_000 });
  }
  return lanes;
}

/**
 * ADR 0004, delete policy D2: of these URLs / job ids, which did Google
 * actually receive through the API (a URL_UPDATED that was really sent)?
 * Only those take delete quota; every other removal is expressed by the 410
 * tombstone + sitemap removal alone.
 */
export async function apiNotifiedUrls(db: Queryable, urls: string[], jobIds: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const result = await db.query<{ url: string }>(
    `SELECT u.url FROM unnest($1::text[], $2::uuid[]) AS u(url, job_id)
     WHERE EXISTS (
       SELECT 1 FROM indexing_queue s
       WHERE s.notification_type = 'URL_UPDATED' AND s.status = 'sent'
         AND (s.url = u.url OR (u.job_id IS NOT NULL AND s.job_id = u.job_id))
     )`,
    [urls, jobIds]
  );
  return new Set(result.rows.map((row) => row.url));
}

export async function markIndexingSent(id: string): Promise<void> {
  await pool.query(`UPDATE indexing_queue SET status = 'sent', sent_at = NOW() WHERE id = $1`, [id]);
}

// sent_at doubles as "attempted at" here (see getIndexingBudgetRemaining) —
// a failed attempt still consumed a real request against Google's quota.
export async function markIndexingFailed(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE indexing_queue SET status = 'failed', error = $2, sent_at = NOW() WHERE id = $1`,
    [id, error]
  );
}

/** Terminal, non-sendable, history kept. Only ever from 'pending'. */
export async function markIndexingSuperseded(id: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE indexing_queue SET status = 'superseded', superseded_at = NOW(), superseded_reason = $2
     WHERE id = $1 AND status = 'pending'`,
    [id, reason.slice(0, 40)]
  );
}

const JOB_ID_IN_URL = /\/empleos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

export function jobIdFromUrl(url: string): string | null {
  return JOB_ID_IN_URL.exec(url)?.[1] ?? null;
}

export type TargetVerdict = { send: true } | { send: false; reason: string };

/**
 * Last check before spending quota. URL_UPDATED is sent only when the target
 * is, right now, an active, canonical, Google-ready job whose current URL is
 * this exact URL (a title edit changes the slug). URL_DELETED is sent only
 * when the job no longer exists as an active page.
 */
export async function checkIndexingTarget(row: Pick<PendingIndexingRow, "url" | "notification_type" | "job_id">): Promise<TargetVerdict> {
  const jobId = row.job_id ?? jobIdFromUrl(row.url);
  if (!jobId) return { send: false, reason: "unparseable_target" };
  const result = await pool.query<{ id: string; title: string; location: string | null; ready: boolean; canonical: boolean; in_window: boolean }>(
    `SELECT j.id, j.title, j.location, ${seoReadySql("j")} AS ready,
            ${canonicalSql("j")} AS canonical, ${withinApiWindowSql("j")} AS in_window
     FROM jobs j WHERE j.id = $1 AND j.is_active = TRUE`,
    [jobId]
  );
  const job = result.rows[0];
  if (row.notification_type === "URL_DELETED") {
    if (job) return { send: false, reason: "target_still_exists" };
    const notified = await apiNotifiedUrls(pool, [row.url], [jobId]);
    return notified.has(row.url) ? { send: true } : { send: false, reason: DELETE_NOT_API_NOTIFIED };
  }
  if (!job) return { send: false, reason: "target_missing" };
  if (!job.canonical) return { send: false, reason: "target_non_canonical" };
  if (!job.ready) return { send: false, reason: "target_not_seo_ready" };
  if (buildJobUrl({ jobId: job.id, title: job.title, location: job.location }) !== row.url) {
    return { send: false, reason: "url_changed" };
  }
  if (!job.in_window) return { send: false, reason: API_WINDOW_EXPIRED };
  return { send: true };
}

// SEO Fase 5 (docs/SEO-PLAN.md §5.6): once a job row is gone,
// purgeOldJobs() (scheduler-repository.ts) is the only place its URL is
// ever known — but it already writes that URL into a URL_DELETED row here
// before losing it. Reusing that as a tombstone means /empleos/:id/:slug can
// tell "this id existed and expired" apart from "this id never existed"
// without a new table or column. Any status counts (a superseded duplicate
// URL_DELETED still proves the job existed).
export async function wasJobPurged(jobId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM indexing_queue WHERE notification_type = 'URL_DELETED' AND url LIKE $1 LIMIT 1`,
    [`%${buildJobUrlPrefix(jobId)}%`]
  );
  return (result.rowCount ?? 0) > 0;
}
