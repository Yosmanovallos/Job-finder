import type { PoolClient } from "pg";
import { pool } from "./client.js";
import { employerSlug } from "./direct-discovery-repository.js";
import { companyKeySql } from "../lib/company-identity.js";
import { liveJobSql } from "../lib/job-freshness.js";
import { portalUrl } from "../direct/connectors.js";
import { initialStatus, inventoryKey, type InventoryRow } from "../direct/discovery/inventory.js";
import {
  conflictOf,
  DUE_STATUSES,
  INVENTORY_DISCOVERY_ORIGIN,
  INVENTORY_PROBE_RULE,
  type Eligible,
  type EnablementContext,
  type InventoryBoard,
  type PromotionOutcome,
  type RecordedProbe
} from "../direct/discovery/inventory-probe.js";
import { DIRECT_ATS_TYPES, type DirectAtsType } from "../direct/types.js";

/**
 * ats_board_inventory (schema.sql block `direct-inventory`; ADR 0006 §13,
 * phase I1). Reads are bounded and read-only; the only write is an
 * idempotent insert that may add a new provenance to an existing row and
 * never touches its status or evidence. Phase I2 adds the probe's writes: a
 * status update guarded to the states a probe may revisit, and an
 * insert-only promotion towards employers / employer_aliases /
 * employer_sources. Script-only: the server never
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

export async function readOnly<T>(run: (query: typeof pool.query) => Promise<T>): Promise<T> {
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

// ---------- phase I2: probe and automatic enablement ----------

/** Boards a probe should read now: pending first, then due retries, oldest probe first. */
export async function pickDueInventory(limit: number): Promise<InventoryBoard[]> {
  return readOnly(async (query) => {
    const result = await query<{ id: string; ats_type: string; ats_ref: string; probe_attempts: number }>(
      `SELECT id, ats_type, ats_ref, probe_attempts
         FROM ats_board_inventory
        WHERE status = ANY($1::text[]) AND ats_type = ANY($2::text[])
          AND (status = 'pending' OR next_probe_at IS NULL OR next_probe_at <= NOW())
        ORDER BY (status = 'pending') DESC,
                 (sources && ARRAY['job_link', 'site_probe']) DESC,
                 last_probed_at NULLS FIRST, ats_type, ref_key
        LIMIT $3`,
      [[...DUE_STATUSES], [...DIRECT_ATS_TYPES], limit]
    );
    return result.rows.map((row) => ({ id: row.id, atsType: row.ats_type as DirectAtsType, atsRef: row.ats_ref, probeAttempts: row.probe_attempts }));
  });
}

/** Rows by status, the whole inventory (INV-014 report). */
export async function inventoryStatusCounts(): Promise<Record<string, number>> {
  return readOnly(async (query) => {
    const result = await query<{ status: string; n: number }>(`SELECT status, COUNT(*)::int AS n FROM ats_board_inventory GROUP BY 1 ORDER BY 1`);
    return Object.fromEntries(result.rows.map((row) => [row.status, row.n]));
  });
}

type Query = typeof pool.query;

/** What the database says about a board and the company its ATS declares. Read-only. */
export async function enablementContext(query: Query, board: InventoryBoard, verdict: Pick<Eligible, "companyKey" | "declaredName">): Promise<EnablementContext> {
  const owned = await query(`SELECT 1 FROM employer_sources WHERE ats_type = $1 AND lower(ats_ref) = lower($2)`, [board.atsType, board.atsRef]);
  const employers = await query<{ id: string }>(
    `SELECT employer_id AS id FROM employer_aliases WHERE company_key = $1
     UNION SELECT id FROM employers WHERE company_key = $1`,
    [verdict.companyKey]
  );
  const employerIds = employers.rows.map((row) => row.id);
  const sameAts = employerIds.length
    ? await query<{ ats_ref: string }>(`SELECT ats_ref FROM employer_sources WHERE employer_id = ANY($1::uuid[]) AND ats_type = $2 ORDER BY ats_ref`, [employerIds, board.atsType])
    : { rows: [] as { ats_ref: string }[] };
  const rejected = await query(`SELECT 1 FROM employer_discovery WHERE company_key = $1 AND decision = 'rejected'`, [verdict.companyKey]);
  const slug = await query<{ company_key: string }>(`SELECT company_key FROM employers WHERE slug = $1`, [employerSlug(verdict.declaredName)]);
  return {
    boardOwned: (owned.rowCount ?? 0) > 0,
    employerIds,
    sameAtsBoards: sameAts.rows.map((row) => row.ats_ref),
    rejected: (rejected.rowCount ?? 0) > 0,
    slugOwnerKey: slug.rows[0]?.company_key ?? null
  };
}

/**
 * Stores a probe result that is not a promotion. Only rows still in a state a
 * probe may revisit change: owned, unsupported_ats, enabled and the decisions
 * left for a human (agency, ambiguous) are never overwritten.
 */
export async function recordInventoryProbe(board: InventoryBoard, outcome: RecordedProbe): Promise<boolean> {
  const result = await pool.query(
    `UPDATE ats_board_inventory SET
       status = $2::text, status_reason = $3::text, declared_name = $4::text, colombia_count = $5::int, total_count = $6::int,
       probe_attempts = probe_attempts + 1, last_probed_at = NOW(),
       next_probe_at = CASE WHEN $7::int IS NULL THEN NULL ELSE NOW() + make_interval(days => $7::int) END,
       employer_source_id = CASE WHEN $2::text = 'owned'
         THEN (SELECT s.id FROM employer_sources s WHERE s.ats_type = ats_board_inventory.ats_type AND lower(s.ats_ref) = ats_board_inventory.ref_key LIMIT 1)
         ELSE employer_source_id END,
       updated_at = NOW()
     WHERE id = $1 AND status = ANY($8::text[])`,
    [
      board.id,
      outcome.status,
      `${INVENTORY_PROBE_RULE}: ${outcome.reason}`.slice(0, 300),
      outcome.declaredName?.slice(0, 255) ?? null,
      outcome.colombiaCount,
      outcome.totalCount,
      outcome.nextProbeDays,
      [...DUE_STATUSES]
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Enables one board for the company its ATS declares — insert-only, one
 * transaction, serialized per company key. The employer is created with the
 * declared name and discovery_origin = 'ats_inventory' unless the key already
 * names one, which then gains the board. Every conflict rolls back and comes
 * back for the caller to record; nothing existing is renamed or reassigned.
 */
export async function promoteInventoryBoard(board: InventoryBoard, verdict: Eligible): Promise<PromotionOutcome> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const conflict = async (status: "owned" | "ambiguous", reason: string): Promise<PromotionOutcome> => {
      await client.query("ROLLBACK");
      return { kind: "conflict", status, reason };
    };
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`ats_inventory:${verdict.companyKey}`]);
    const query = client.query.bind(client) as Query;
    const found = conflictOf(await enablementContext(query, board, verdict), verdict.companyKey, false);
    if (found) return await conflict(found.status, found.reason);

    const slug = employerSlug(verdict.declaredName);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return await conflict("ambiguous", `no se pudo derivar un slug de "${verdict.declaredName.slice(0, 80)}"`);
    const existing = await query<{ id: string }>(
      `SELECT employer_id AS id FROM employer_aliases WHERE company_key = $1 UNION SELECT id FROM employers WHERE company_key = $1`,
      [verdict.companyKey]
    );
    let employerId = existing.rows[0]?.id;
    if (!employerId) {
      // The SQL key of the declared name must be the key judged in TypeScript.
      const inserted = await query<{ id: string }>(
        `INSERT INTO employers (slug, display_name, company_key, discovery_origin)
         SELECT $1::text, $2::text, ${companyKeySql("$2::text")}, $4::text
          WHERE ${companyKeySql("$2::text")} = $3::text
         ON CONFLICT (slug) DO NOTHING
         RETURNING id`,
        [slug, verdict.declaredName.slice(0, 255), verdict.companyKey, INVENTORY_DISCOVERY_ORIGIN]
      );
      if (!inserted.rowCount) return await conflict("ambiguous", "no se pudo crear la empresa (slug o clave en conflicto)");
      employerId = inserted.rows[0].id;
    }
    const alias = await query(`INSERT INTO employer_aliases (company_key, employer_id) VALUES ($1, $2) ON CONFLICT (company_key) DO NOTHING`, [verdict.companyKey, employerId]);
    if (!alias.rowCount) {
      const owner = await query<{ employer_id: string }>(`SELECT employer_id FROM employer_aliases WHERE company_key = $1`, [verdict.companyKey]);
      if (owner.rows[0]?.employer_id !== employerId) return await conflict("ambiguous", "el alias ya pertenece a otra empresa");
    }
    const source = await query<{ id: string }>(
      `INSERT INTO employer_sources (employer_id, ats_type, ats_ref, portal_url, enabled)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (ats_type, ats_ref) DO NOTHING
       RETURNING id`,
      [employerId, board.atsType, board.atsRef, portalUrl(board)]
    );
    if (!source.rowCount) return await conflict("owned", "el tablero ya pertenece a una empresa (employer_sources)");
    const marked = await query(
      `UPDATE ats_board_inventory SET
         status = 'enabled', status_reason = $2::text, declared_name = $3::text, colombia_count = $4::int, total_count = $5::int,
         employer_source_id = $6, probe_attempts = probe_attempts + 1, last_probed_at = NOW(), next_probe_at = NULL, updated_at = NOW()
       WHERE id = $1 AND status = ANY($7::text[])`,
      [
        board.id,
        `${INVENTORY_PROBE_RULE}: ${verdict.reason}`.slice(0, 300),
        verdict.declaredName.slice(0, 255),
        verdict.colombiaCount,
        verdict.totalCount,
        source.rows[0].id,
        [...DUE_STATUSES]
      ]
    );
    if (!marked.rowCount) return await conflict("ambiguous", "la fila del inventario cambió durante el sondeo");
    await client.query("COMMIT");
    return { kind: "enabled" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
