import { sql } from "drizzle-orm";
import type { Database } from "@job-radar/db";

export interface FulltextHit {
  jobId: string;
  rank: number;
}

/**
 * Postgres full-text retrieval (stage 2, plan §13.1) over title+description.
 * Used to pre-select candidates cheaply; scoring stays deterministic.
 */
export async function searchJobs(
  db: Database,
  query: string,
  limit = 100
): Promise<FulltextHit[]> {
  const rows = await db.execute<{ id: string; rank: number }>(sql`
    SELECT id,
           ts_rank(
             to_tsvector('simple', title_raw || ' ' || description_text),
             websearch_to_tsquery('simple', ${query})
           ) AS rank
    FROM jobs
    WHERE status <> 'closed'
      AND to_tsvector('simple', title_raw || ' ' || description_text) @@
          websearch_to_tsquery('simple', ${query})
    ORDER BY rank DESC
    LIMIT ${limit}
  `);
  return [...rows].map((row) => ({ jobId: row.id, rank: Number(row.rank) }));
}
