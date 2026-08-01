import { pool } from "./client.js";
import { ReputationScoreInput } from "../sources/reputation/types.js";

export interface ReputationAliasInput {
  rawCompanyName: string;
  source: string;
  canonicalName: string;
}

export interface ReputationEntry {
  source: string;
  score: number | null;
  scoreScale: string;
  reviewCount: number | null;
  sourceUrl: string;
}

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

// Curated, hand-verified mapping only (see scripts/seed-merco-aliases.ts)
// — never populated by a fuzzy-match at read time. ON CONFLICT lets the
// seed script re-run safely if a canonical name ever needs correcting.
export async function upsertReputationAliases(rows: ReputationAliasInput[]): Promise<void> {
  if (rows.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [];
  rows.forEach((row, i) => {
    const base = i * 3;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
    params.push(row.rawCompanyName, row.source, row.canonicalName);
  });

  await pool.query(
    `INSERT INTO company_reputation_alias (raw_company_name, source, canonical_name)
     VALUES ${values.join(", ")}
     ON CONFLICT (raw_company_name, source) DO UPDATE SET canonical_name = EXCLUDED.canonical_name`,
    params
  );
}

// One batched query for however many jobs are in the caller's current page
// (never the whole corpus, never N+1 per job) — a company with no
// confirmed alias simply has no key in the returned map, so callers must
// never fall back to a fuzzy match on a miss (regla 5 de AGENTS.md).
export async function getReputationForCompanies(
  rawCompanyNames: string[]
): Promise<Map<string, ReputationEntry[]>> {
  const uniqueNames = [...new Set(rawCompanyNames.filter(Boolean))];
  const map = new Map<string, ReputationEntry[]>();
  if (uniqueNames.length === 0) return map;

  const result = await pool.query(
    `SELECT a.raw_company_name, r.source, r.score, r.score_scale, r.review_count, r.source_url
     FROM company_reputation_alias a
     JOIN company_reputation r ON r.company_name = a.canonical_name AND r.source = a.source
     WHERE a.raw_company_name = ANY($1)`,
    [uniqueNames]
  );

  for (const row of result.rows) {
    const entry: ReputationEntry = {
      source: row.source,
      score: row.score !== null ? Number(row.score) : null,
      scoreScale: row.score_scale,
      reviewCount: row.review_count,
      sourceUrl: row.source_url
    };
    const existing = map.get(row.raw_company_name);
    if (existing) existing.push(entry);
    else map.set(row.raw_company_name, [entry]);
  }

  return map;
}
