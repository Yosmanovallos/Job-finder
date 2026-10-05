import { pool } from "./client.js";

/**
 * Persistence for the source-closure check (src/queue/source-closure.ts).
 *
 * `jobs.source_checked_at` (schema.sql block `source-closure`, applied by
 * scripts/migrate-source-closure.ts) is the rotation cursor: rows never
 * checked go first, then the stalest check. Without it every pass would
 * re-ask about the same oldest rows and never reach the rest.
 */

/** A pass re-asks the source about a row at most once per this window. */
export const CLOSURE_RECHECK_HOURS = 20;

export interface ClosureCandidate {
  id: string;
  url: string;
}

/** Postgres `undefined_column` — the migration hasn't been applied yet. */
export function isMissingClosureColumn(error: unknown): boolean {
  return (error as { code?: string })?.code === "42703";
}

export async function pickJobsForClosureCheck(source: string, limit: number): Promise<ClosureCandidate[]> {
  const result = await pool.query(
    `SELECT id, url FROM jobs
      WHERE is_active = TRUE AND source = $1
        AND (source_checked_at IS NULL OR source_checked_at < NOW() - make_interval(hours => $3))
      ORDER BY source_checked_at ASC NULLS FIRST, published_at ASC, id ASC
      LIMIT $2`,
    [source, limit, CLOSURE_RECHECK_HOURS]
  );
  return result.rows.map((row) => ({ id: row.id, url: row.url }));
}

export async function markClosureChecked(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  await pool.query(`UPDATE jobs SET source_checked_at = NOW() WHERE id = ANY($1::uuid[])`, [jobIds]);
}
