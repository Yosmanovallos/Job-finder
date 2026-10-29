import { pool } from "./client.js";

export const JOB_ARCHIVE_RETENTION_DAYS = 180;

/** No public job bodies: callers can only ask whether an identity retired. */
export async function wasJobArchived(id: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM archived_jobs WHERE job_id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/** The same safety guard as expired_job_urls, even if recording that hash failed. */
export async function findArchivedUrlHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const result = await pool.query<{ url_hash: string }>(
    `SELECT url_hash FROM archived_jobs WHERE url_hash = ANY($1::text[])`, [hashes]
  );
  return new Set(result.rows.map((row) => row.url_hash));
}

/** Bounded maintenance only; never delete public jobs or indexing history. */
export async function pruneJobArchive(limit = 2_000, dryRun = false): Promise<number> {
  const params = [JOB_ARCHIVE_RETENTION_DAYS, Math.max(1, Math.min(Math.trunc(limit) || 1, 2_000))];
  const candidates = `SELECT job_id FROM archived_jobs
    WHERE archived_at < NOW() - make_interval(days => $1)
    ORDER BY archived_at, job_id LIMIT $2`;
  const result = await pool.query(dryRun
    ? `SELECT job_id FROM archived_jobs WHERE job_id IN (${candidates})`
    : `DELETE FROM archived_jobs WHERE job_id IN (${candidates})`, params);
  return result.rowCount ?? 0;
}
