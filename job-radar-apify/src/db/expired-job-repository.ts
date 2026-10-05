import { pool } from "./client.js";

/**
 * `expired_job_urls` (schema.sql block `job-freshness`, applied by
 * scripts/migrate-job-freshness.ts): url_hashes of jobs deleted because they
 * expired, so saveJobs() never re-inserts them as if they were new.
 *
 * Every function degrades to a no-op while the table does not exist yet, so
 * the tick keeps working before the migration runs — it just cannot block
 * re-insertion until then.
 */

/** How long an expired URL stays blocked. Far beyond any posting's real life. */
export const EXPIRED_URL_RETENTION_DAYS = 180;

let warnedMissingTable = false;

/** Postgres `undefined_table` — the migration hasn't been applied yet. */
function isMissingTable(error: unknown): boolean {
  return (error as { code?: string })?.code === "42P01";
}

function warnMissingTableOnce(): void {
  if (warnedMissingTable) return;
  warnedMissingTable = true;
  console.warn("⚠️ [job-freshness] Falta la tabla expired_job_urls — correr scripts/migrate-job-freshness.ts.");
}

export async function recordExpiredUrlHashes(urlHashes: string[], reason: string): Promise<void> {
  const unique = [...new Set(urlHashes.filter(Boolean))];
  if (unique.length === 0) return;
  try {
    await pool.query(
      `INSERT INTO expired_job_urls (url_hash, reason)
       SELECT h, $2 FROM unnest($1::text[]) AS h
       ON CONFLICT (url_hash) DO UPDATE SET expired_at = NOW(), reason = EXCLUDED.reason`,
      [unique, reason]
    );
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    warnMissingTableOnce();
  }
}

/** The subset of `urlHashes` that expired before and must not be re-inserted. */
export async function findExpiredUrlHashes(urlHashes: string[]): Promise<Set<string>> {
  const unique = [...new Set(urlHashes.filter(Boolean))];
  if (unique.length === 0) return new Set();
  try {
    const result = await pool.query<{ url_hash: string }>(
      `SELECT url_hash FROM expired_job_urls WHERE url_hash = ANY($1::text[])`,
      [unique]
    );
    return new Set(result.rows.map((row) => row.url_hash));
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    warnMissingTableOnce();
    return new Set();
  }
}

export async function pruneExpiredUrlHashes(): Promise<number> {
  try {
    const result = await pool.query(
      `DELETE FROM expired_job_urls WHERE expired_at < NOW() - make_interval(days => $1)`,
      [EXPIRED_URL_RETENTION_DAYS]
    );
    return result.rowCount ?? 0;
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    warnMissingTableOnce();
    return 0;
  }
}
