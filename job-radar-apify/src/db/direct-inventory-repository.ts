import { pool } from "./client.js";
import { liveJobSql } from "../lib/job-freshness.js";
import { initialStatus, inventoryKey, type InventoryRow } from "../direct/discovery/inventory.js";

/**
 * ats_board_inventory (schema.sql block `direct-inventory`; ADR 0006 §13,
 * phase I1). Reads are bounded and read-only; the only write is an
 * idempotent insert that may add a new provenance to an existing row and
 * never touches its status or evidence. Script-only: the server never
 * imports this module (src/db/direct-* graph test).
 */

// ATS hosts the parsers recognise (ats-links.ts). Only URLs on these hosts
// leave the database — never description text, e-mails or other links.
export const ATS_URL_PATTERN = String.raw`https?://(?:[a-z0-9_-]+\.)*(?:greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|myworkdayjobs\.com|successfactors\.(?:com|eu)|gupy\.io|buk\.co|teamtailor\.com|icims\.com|eightfold\.ai)[^][:space:]"'<>()]*`;

/** inventoryKey()s of every board an employer already owns. */
export async function ownedBoardKeys(): Promise<Set<string>> {
  const result = await pool.query<{ ats_type: string; ats_ref: string }>(`SELECT ats_type, ats_ref FROM employer_sources`);
  return new Set(result.rows.map((row) => inventoryKey(row.ats_type, row.ats_ref)));
}

async function readOnly<T>(run: (query: typeof pool.query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '180s'");
    const value = await run(client.query.bind(client) as typeof pool.query);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Distinct ATS URLs named by live job-board rows in Colombia or remote (url + description), at most `limit`, in a stable order. */
export async function jobLinkUrls(limit: number): Promise<string[]> {
  return readOnly(async (query) => {
    const result = await query<{ url: string }>(
      `SELECT DISTINCT m[1] AS url
         FROM jobs,
              regexp_matches(COALESCE(url, '') || ' ' || COALESCE(left(description, 20000), ''), $1, 'gi') AS m
        WHERE is_active = TRUE AND ${liveJobSql()} AND direct_job_id IS NULL AND (country = 'CO' OR country IS NULL)
        ORDER BY 1
        LIMIT $2`,
      [`(${ATS_URL_PATTERN})`, limit]
    );
    return result.rows.map((row) => row.url);
  });
}

/** Boards the site probe found linked from an employer's own site (evidence refs only). */
export async function siteProbeRefs(): Promise<{ atsType: string; atsRef: string }[]> {
  return readOnly(async (query) => {
    const result = await query<{ ats_type: string; ats_ref: string }>(
      `SELECT DISTINCT b->>'atsType' AS ats_type, b->>'atsRef' AS ats_ref
         FROM employer_discovery d,
              jsonb_array_elements(CASE WHEN jsonb_typeof(d.evidence->'boards') = 'array' THEN d.evidence->'boards' ELSE '[]'::jsonb END) AS b
        WHERE b->>'method' = 'site' AND b->>'atsType' IS NOT NULL AND b->>'atsRef' IS NOT NULL`
    );
    return result.rows.map((row) => ({ atsType: row.ats_type, atsRef: row.ats_ref }));
  });
}

export async function inventoryTableExists(): Promise<boolean> {
  const result = await pool.query<{ present: boolean }>(`SELECT to_regclass('public.ats_board_inventory') IS NOT NULL AS present`);
  return result.rows[0].present;
}

/** inventoryKey()s already stored. */
export async function existingInventoryKeys(): Promise<Set<string>> {
  const result = await pool.query<{ ats_type: string; ref_key: string }>(`SELECT ats_type, ref_key FROM ats_board_inventory`);
  return new Set(result.rows.map((row) => inventoryKey(row.ats_type, row.ref_key)));
}

export interface InventoryWrite {
  inserted: number;
  sourcesAdded: number;
}

/**
 * Inserts new boards; an existing board only gains provenances it did not
 * have. Running it again with the same rows changes nothing (INV-005).
 */
export async function insertInventory(rows: InventoryRow[], ownedKeys: ReadonlySet<string>, batchSize = 1000): Promise<InventoryWrite> {
  const total: InventoryWrite = { inserted: 0, sourcesAdded: 0 };
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const result = await pool.query<{ inserted: boolean }>(
      `INSERT INTO ats_board_inventory (ats_type, ats_ref, first_source, sources, status, employer_source_id)
       SELECT r.ats_type, r.ats_ref, r.first_source, string_to_array(r.sources, ','), r.status,
              (SELECT s.id FROM employer_sources s WHERE s.ats_type = r.ats_type AND lower(s.ats_ref) = lower(r.ats_ref) LIMIT 1)
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
              AS r(ats_type, ats_ref, first_source, sources, status)
       ON CONFLICT (ats_type, ref_key) DO UPDATE
         SET sources = ARRAY(SELECT DISTINCT unnest(ats_board_inventory.sources || EXCLUDED.sources) ORDER BY 1),
             updated_at = NOW()
         WHERE NOT (ats_board_inventory.sources @> EXCLUDED.sources)
       RETURNING (xmax = 0) AS inserted`,
      [
        batch.map((row) => row.atsType),
        batch.map((row) => row.atsRef),
        batch.map((row) => row.firstSource),
        batch.map((row) => row.sources.join(",")),
        batch.map((row) => initialStatus(row, ownedKeys))
      ]
    );
    for (const row of result.rows) {
      if (row.inserted) total.inserted++;
      else total.sourcesAdded++;
    }
  }
  return total;
}
