import { pool } from "./client.js";
import { ReputationScoreInput } from "../sources/reputation/types.js";

// Batched single INSERT (not one query per row), same pattern as
// enqueueIndexingNotifications in indexing-repository.ts — called once per
// tick after a fetcher's whole result set is in hand, not per-row.
// ON CONFLICT (company_name, source) keeps this idempotent: re-running a
// fetcher against the same source just refreshes fetched_at and any
// changed values, never creates a duplicate row.
export async function upsertReputationScores(rows: ReputationScoreInput[]): Promise<void> {
  if (rows.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [];
  rows.forEach((row, i) => {
    const base = i * 6;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, NOW())`
    );
    params.push(row.companyName, row.source, row.score, row.scoreScale, row.reviewCount, row.sourceUrl);
  });

  await pool.query(
    `INSERT INTO company_reputation (company_name, source, score, score_scale, review_count, source_url, fetched_at)
     VALUES ${values.join(", ")}
     ON CONFLICT (company_name, source) DO UPDATE SET
       score = EXCLUDED.score,
       score_scale = EXCLUDED.score_scale,
       review_count = EXCLUDED.review_count,
       source_url = EXCLUDED.source_url,
       fetched_at = NOW()`,
    params
  );
}
