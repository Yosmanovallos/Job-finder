import { pool } from "./client.js";
import { NotificationType } from "../lib/google-indexing.js";
import { buildJobUrlPrefix } from "../lib/job-seo.js";

// Google's default Indexing API quota (Search Console-verified project,
// no quota increase requested). Budget is derived from what's actually
// `sent` in the last 24h in the DB, not an in-memory counter — the drain
// script (scripts/run-indexing-tick.ts) runs every 15 min via GitHub
// Actions cron, so an in-memory/per-invocation cap would reset every time
// and blow through the real daily limit.
export const DAILY_INDEXING_QUOTA = 200;

export interface IndexingQueueEntry {
  url: string;
  type: NotificationType;
}

// Batched single INSERT, called once after saveJobs()'s per-job loop —
// not per-iteration, to avoid tripling that loop's query count.
export async function enqueueIndexingNotifications(entries: IndexingQueueEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const values: string[] = [];
  const params: string[] = [];
  entries.forEach((entry, i) => {
    values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
    params.push(entry.url, entry.type);
  });

  await pool.query(
    `INSERT INTO indexing_queue (url, notification_type) VALUES ${values.join(", ")}`,
    params
  );
}

// Counts 'failed' attempts too, not just 'sent' — Google's quota is
// consumed by the *request*, not by whether it succeeded. markIndexingFailed
// also stamps sent_at as "attempted at" so a misconfigured service account
// (e.g. wrong Search Console permission) can't burn through 200 real
// requests as silent 403s while this budget check still reads 200/200
// remaining and the next run tries all 200 again.
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
}

// Newest first, not FIFO: a one-time backfill of ~10,170 existing jobs sits
// in this table alongside real-time entries from tonight's scrape. FIFO
// would bury every fresh URL_UPDATED — the entire reason the Indexing API
// is worth using, hours instead of weeks — behind ~51 days of backfill.
// Backfill rows losing their place in line costs nothing: they're already
// discoverable via sitemap-jobs.xml regardless of when this table sends them.
export async function getPendingIndexingBatch(limit: number): Promise<PendingIndexingRow[]> {
  if (limit <= 0) return [];
  const result = await pool.query(
    `SELECT id, url, notification_type FROM indexing_queue
     WHERE status = 'pending'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function markIndexingSent(id: string): Promise<void> {
  await pool.query(`UPDATE indexing_queue SET status = 'sent', sent_at = NOW() WHERE id = $1`, [
    id
  ]);
}

// sent_at doubles as "attempted at" here (see getIndexingBudgetRemaining) —
// a failed attempt still consumed a real request against Google's quota.
export async function markIndexingFailed(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE indexing_queue SET status = 'failed', error = $2, sent_at = NOW() WHERE id = $1`,
    [id, error]
  );
}

// SEO Fase 5 (docs/SEO-PLAN.md §5.6): once a job row is gone,
// purgeOldJobs() (scheduler-repository.ts) is the only place its URL is
// ever known — but it already writes that URL into a URL_DELETED row here
// before losing it. Reusing that as a tombstone (LIKE 'prefix%', a
// right-anchored wildcard so the idx_indexing_queue_url_prefix index
// below actually gets used, not a full scan) means /empleos/:id/:slug can
// tell "this id existed and expired" apart from "this id never existed"
// without a new table or column.
export async function wasJobPurged(jobId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM indexing_queue WHERE notification_type = 'URL_DELETED' AND url LIKE $1 LIMIT 1`,
    [`%${buildJobUrlPrefix(jobId)}%`]
  );
  return (result.rowCount ?? 0) > 0;
}
