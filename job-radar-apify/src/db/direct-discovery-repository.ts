import { pool } from "./client.js";
import { companyKeySql, isPlaceholderCompanyKeySql, storedCompanyKeySql } from "../lib/company-identity.js";
import { liveJobSql } from "../lib/job-freshness.js";
import { portalUrl } from "../direct/connectors.js";
import { liveDirectJobSql } from "../direct/ingest.js";
import { companyWords } from "../direct/discovery/company-key.js";
import { DISCOVERY_RULE_VERSION, type BoardEvidence, type DiscoveryCandidate, type ProbeOutcome } from "../direct/discovery/probe.js";
import type { DirectAtsType } from "../direct/types.js";

/**
 * Persistence for employer discovery (docs/adr/0006-direct-employers.md
 * §7.1, phase D3). INSERT-ONLY towards employers / employer_aliases /
 * employer_sources: discovery never renames an employer, never reassigns a
 * board and never takes an alias another employer owns — every such
 * conflict sends the candidate to needs_review. Decisions `verified`,
 * `known` and `rejected` are sticky: a re-run never reopens them.
 */

export interface DirectoryCandidateRow {
  companyKey: string;
  companyName: string;
  directoryCount: number;
}

/**
 * Live job-board rows of Colombia (or remote), grouped by the stored employer
 * key. Official projections are already covered and do not enter the search.
 * The name is the most frequent spelling of the key.
 */
export async function loadDirectoryCandidates(limit: number): Promise<DirectoryCandidateRow[]> {
  const result = await pool.query<{ company_key: string; company: string; n: number }>(
    // Stored key, or the expression for a row the backfill hasn't reached
    // (same fallback as every listing read).
    `WITH keyed AS (
       SELECT ${storedCompanyKeySql()} AS company_key, company
       FROM jobs
       WHERE is_active = TRUE AND direct_job_id IS NULL AND ${liveJobSql()} AND (country = 'CO' OR country IS NULL)
     ), spellings AS (
       SELECT company_key, company, COUNT(*)::int AS n
       FROM keyed
       WHERE company_key <> '' AND NOT ${isPlaceholderCompanyKeySql("company_key")}
       GROUP BY company_key, company
     )
     SELECT company_key, (array_agg(company ORDER BY n DESC, length(company), company))[1] AS company, SUM(n)::int AS n
     FROM spellings
     GROUP BY company_key
     ORDER BY n DESC, company_key
     LIMIT $1`,
    [limit]
  );
  return result.rows.map((row) => ({ companyKey: row.company_key, companyName: row.company.trim(), directoryCount: row.n }));
}

export interface SyncResult {
  inserted: number;
  refreshed: number;
  /** Candidates already covered by an employer (seed or earlier discovery). */
  known: number;
}

/**
 * Upserts the directory snapshot. Only directory facts are refreshed (name,
 * count, a domain backed by evidence when none was stored); a candidate's
 * decision is never touched here, except marking `known` the ones whose key
 * already maps to an employer.
 */
export async function syncCandidates(
  candidates: (DirectoryCandidateRow & { websiteDomain: string | null; domainOrigin: string | null })[]
): Promise<SyncResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One statement for the whole directory (~10k rows), not one per row.
    const result = await client.query<{ inserted: boolean }>(
      `INSERT INTO employer_discovery (company_key, company_name, directory_count, website_domain, domain_origin)
       SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[])
       ON CONFLICT (company_key) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         directory_count = EXCLUDED.directory_count,
         next_probe_at = CASE
           WHEN employer_discovery.directory_count = 0 AND EXCLUDED.directory_count > 0
             AND employer_discovery.decision IN ('pending', 'not_found', 'unsupported_ats', 'magneto')
           THEN NULL ELSE employer_discovery.next_probe_at END,
         website_domain = COALESCE(employer_discovery.website_domain, EXCLUDED.website_domain),
         domain_origin = CASE WHEN employer_discovery.website_domain IS NULL THEN EXCLUDED.domain_origin ELSE employer_discovery.domain_origin END,
         updated_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        candidates.map((candidate) => candidate.companyKey),
        candidates.map((candidate) => candidate.companyName.slice(0, 255)),
        candidates.map((candidate) => candidate.directoryCount),
        candidates.map((candidate) => candidate.websiteDomain),
        candidates.map((candidate) => candidate.domainOrigin)
      ]
    );
    const inserted = result.rows.filter((row) => row.inserted).length;
    const refreshed = result.rows.length - inserted;
    const known = await client.query(
      `UPDATE employer_discovery d SET
         decision = 'known', decided_by = 'auto', decided_at = NOW(), employer_id = a.employer_id,
         decision_reason = 'ya es una empresa con tablero (seed o descubrimiento previo)', rule_version = $1::text,
         history = d.history || jsonb_build_array(jsonb_build_object('at', NOW(), 'decision', 'known', 'by', 'auto', 'rule', $1::text)),
         updated_at = NOW()
       FROM employer_aliases a
       WHERE a.company_key = d.company_key AND d.decision NOT IN ('known', 'verified', 'rejected')`,
      [DISCOVERY_RULE_VERSION]
    );
    await client.query("COMMIT");
    return { inserted, refreshed, known: known.rowCount ?? 0 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Retires rows absent from a complete live job-board snapshot without losing
 * their evidence or sticky decisions. A later sighting reactivates the row. */
export async function retireMissingCandidates(activeKeys: string[]): Promise<number> {
  if (activeKeys.length === 0) return 0; // an empty/failed snapshot is not evidence of mass disappearance
  const result = await pool.query(
    `UPDATE employer_discovery SET directory_count = 0, updated_at = NOW()
     WHERE directory_count > 0 AND NOT (company_key = ANY($1::text[]))`,
    [activeKeys]
  );
  return result.rowCount ?? 0;
}

/** Candidates to probe now: open decisions whose retry time came, most job-board rows first. */
export async function pickDueCandidates(limit: number, minCount: number): Promise<(DirectoryCandidateRow & { websiteDomain: string | null; attempts: number })[]> {
  const result = await pool.query(
    `SELECT company_key, company_name, directory_count, website_domain, attempts
     FROM employer_discovery
     WHERE decision IN ('pending', 'not_found', 'unsupported_ats', 'magneto')
       AND (next_probe_at IS NULL OR next_probe_at <= NOW())
       AND directory_count >= $2
     ORDER BY directory_count DESC, company_key
     LIMIT $1`,
    [limit, minCount]
  );
  return result.rows.map((row) => ({
    companyKey: row.company_key,
    companyName: row.company_name,
    directoryCount: row.directory_count,
    websiteDomain: row.website_domain,
    attempts: row.attempts
  }));
}

/** The evidence column: board checks plus what the site probe read (URLs only, never HTML). */
export interface EvidenceDocument {
  boards: BoardEvidence[];
  site: ProbeOutcome["site"];
}

function evidenceDocument(outcome: Pick<ProbeOutcome, "evidence" | "site">): EvidenceDocument {
  return { boards: outcome.evidence.slice(0, 40), site: outcome.site };
}

/** Days before an open decision is probed again. */
export function nextProbeDays(decision: ProbeOutcome["decision"], attempts: number): number {
  if (decision === "pending") return Math.min(2 ** attempts, 14); // transient error: 1, 2, 4… up to 14 days
  if (decision === "unsupported_ats" || decision === "magneto") return 30;
  return 30; // not_found: boards appear over time
}

/** Stores a probe result (not a promotion). Sticky decisions are never overwritten. */
export async function recordProbe(candidate: DiscoveryCandidate, outcome: ProbeOutcome, attempts: number): Promise<boolean> {
  const days = nextProbeDays(outcome.decision, attempts);
  const result = await pool.query(
    `UPDATE employer_discovery SET
       name_probe_status = $2::text, site_probe_status = $3::text, decision = $4::text, decision_reason = $5::text,
       decided_by = 'auto', decided_at = CASE WHEN decision IS DISTINCT FROM $4::text THEN NOW() ELSE decided_at END,
       rule_version = $6::text, evidence = $7::jsonb,
       history = history || jsonb_build_array(jsonb_build_object('at', NOW(), 'decision', $4::text, 'reason', $5::text, 'by', 'auto', 'rule', $6::text)),
       attempts = attempts + 1, last_probed_at = NOW(),
       next_probe_at = CASE WHEN $4::text IN ('needs_review', 'excluded') THEN NULL ELSE NOW() + make_interval(days => $8::int) END,
       updated_at = NOW()
     WHERE company_key = $1 AND decision NOT IN ('known', 'verified', 'rejected')`,
    [
      candidate.companyKey,
      outcome.nameProbe,
      outcome.siteProbe,
      outcome.decision,
      outcome.reason.slice(0, 300),
      DISCOVERY_RULE_VERSION,
      JSON.stringify(evidenceDocument(outcome)),
      days
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

export type PromotionResult =
  | { kind: "promoted"; employerId: string; boards: string[] }
  | { kind: "conflict"; reason: string };

/** "Mercado Libre S.A.S." -> "mercado-libre". */
export function employerSlug(name: string): string {
  return companyWords(name).join("-").slice(0, 120).replace(/-+$/, "");
}

/**
 * Turns a verified candidate into an employer with its boards — insert-only,
 * one transaction. Any conflict (slug of another company, alias of another
 * employer, a board another employer owns) rolls everything back and is
 * returned so the caller sends the candidate to needs_review.
 */
export async function promoteCandidate(
  candidate: DiscoveryCandidate,
  boards: { atsType: DirectAtsType; atsRef: string; method: "name" | "site" }[],
  decidedBy: "auto" | "human",
  outcome: Pick<ProbeOutcome, "nameProbe" | "siteProbe" | "evidence" | "site"> | null
): Promise<PromotionResult> {
  if (boards.length === 0) return { kind: "conflict", reason: "sin tableros verificados" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const conflict = async (reason: string): Promise<PromotionResult> => {
      await client.query("ROLLBACK");
      return { kind: "conflict", reason };
    };
    const origin = boards.some((board) => board.method === "site") ? "discovery_site" : "discovery_name";
    const slug = employerSlug(candidate.companyName);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return await conflict(`no se pudo derivar un slug de "${candidate.companyName}"`);

    let employerId: string;
    const alias = await client.query<{ employer_id: string }>(`SELECT employer_id FROM employer_aliases WHERE company_key = $1`, [candidate.companyKey]);
    if (alias.rowCount) {
      employerId = alias.rows[0].employer_id;
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO employers (slug, display_name, company_key, website_domain, discovery_origin)
         VALUES ($1, $2::text, ${companyKeySql("$2::text")}, $3, $4)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id`,
        [slug, candidate.companyName.slice(0, 255), candidate.websiteDomain, origin]
      );
      if (inserted.rowCount) employerId = inserted.rows[0].id;
      else {
        const existing = await client.query<{ id: string; company_key: string }>(`SELECT id, company_key FROM employers WHERE slug = $1`, [slug]);
        if (existing.rows[0]?.company_key !== candidate.companyKey) {
          return await conflict(`el slug "${slug}" ya pertenece a otra empresa (${existing.rows[0]?.company_key ?? "?"})`);
        }
        employerId = existing.rows[0].id;
      }
      const aliasInsert = await client.query(
        `INSERT INTO employer_aliases (company_key, employer_id) VALUES ($1, $2) ON CONFLICT (company_key) DO NOTHING`,
        [candidate.companyKey, employerId]
      );
      if (!aliasInsert.rowCount) return await conflict("el alias ya pertenece a otra empresa");
    }

    const promoted: string[] = [];
    for (const board of boards) {
      // The ATS APIs match identifiers case-insensitively ("sgs" = "SGS")
      // but UNIQUE (ats_type, ats_ref) doesn't: look the owner up folded.
      const owned = await client.query<{ employer_id: string }>(
        `SELECT employer_id FROM employer_sources WHERE ats_type = $1 AND lower(ats_ref) = lower($2)`,
        [board.atsType, board.atsRef]
      );
      if (owned.rowCount) {
        if (owned.rows.some((row) => row.employer_id !== employerId)) {
          return await conflict(`el tablero ${board.atsType}:${board.atsRef} ya pertenece a otra empresa`);
        }
        continue;
      }
      const inserted = await client.query(
        `INSERT INTO employer_sources (employer_id, ats_type, ats_ref, portal_url, enabled)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (ats_type, ats_ref) DO NOTHING`,
        [employerId, board.atsType, board.atsRef, portalUrl(board)]
      );
      if (!inserted.rowCount) {
        const owner = await client.query<{ employer_id: string }>(
          `SELECT employer_id FROM employer_sources WHERE ats_type = $1 AND ats_ref = $2`,
          [board.atsType, board.atsRef]
        );
        if (owner.rows[0]?.employer_id !== employerId) return await conflict(`el tablero ${board.atsType}:${board.atsRef} ya pertenece a otra empresa`);
        continue;
      }
      promoted.push(`${board.atsType}:${board.atsRef}`);
    }

    await client.query(
      `UPDATE employer_discovery SET
         decision = 'verified', decided_by = $2::text, decided_at = NOW(), employer_id = $3, rule_version = $4::text,
         decision_reason = $5::text,
         name_probe_status = COALESCE($6::text, name_probe_status), site_probe_status = COALESCE($7::text, site_probe_status),
         evidence = COALESCE($8::jsonb, evidence),
         history = history || jsonb_build_array(jsonb_build_object('at', NOW(), 'decision', 'verified', 'by', $2::text, 'rule', $4::text, 'boards', $9::jsonb)),
         attempts = attempts + 1, last_probed_at = NOW(), next_probe_at = NULL, updated_at = NOW()
       WHERE company_key = $1`,
      [
        candidate.companyKey,
        decidedBy,
        employerId,
        DISCOVERY_RULE_VERSION,
        `tablero verificado (${origin})`,
        outcome?.nameProbe ?? null,
        outcome?.siteProbe ?? null,
        outcome ? JSON.stringify(evidenceDocument(outcome)) : null,
        JSON.stringify(promoted)
      ]
    );
    await client.query("COMMIT");
    return { kind: "promoted", employerId, boards: promoted };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// ---------- human review ----------

export interface ReviewRow {
  companyKey: string;
  companyName: string;
  directoryCount: number;
  decision: string;
  reason: string | null;
  evidence: EvidenceDocument | null;
}

export async function listForReview(decisions: string[], limit: number): Promise<ReviewRow[]> {
  const result = await pool.query(
    `SELECT company_key, company_name, directory_count, decision, decision_reason, evidence
     FROM employer_discovery WHERE decision = ANY($1::text[])
     ORDER BY directory_count DESC, company_key LIMIT $2`,
    [decisions, limit]
  );
  return result.rows.map((row) => ({
    companyKey: row.company_key,
    companyName: row.company_name,
    directoryCount: row.directory_count,
    decision: row.decision,
    reason: row.decision_reason,
    evidence: Array.isArray(row.evidence) ? null : row.evidence
  }));
}

export async function getCandidate(companyKey: string): Promise<(DiscoveryCandidate & { decision: string; evidence: EvidenceDocument | null }) | null> {
  const result = await pool.query(
    `SELECT company_key, company_name, directory_count, website_domain, decision, evidence FROM employer_discovery WHERE company_key = $1`,
    [companyKey]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    companyKey: row.company_key,
    companyName: row.company_name,
    directoryCount: row.directory_count,
    websiteDomain: row.website_domain,
    isAgency: false,
    decision: row.decision,
    evidence: Array.isArray(row.evidence) ? null : row.evidence
  };
}

/**
 * Soft revert (ADR 0006 §7.1): the candidate becomes `rejected` (sticky),
 * the boards discovery added for it are disabled and, when discovery itself
 * created the employer, the alias is retired. Nothing is deleted from
 * employers / employer_sources / direct_jobs; the history keeps the record.
 */
export async function rejectCandidate(companyKey: string, note: string): Promise<{ disabledBoards: number; aliasRetired: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query<{ employer_id: string | null; history: { boards?: string[] }[] }>(
      `SELECT employer_id, history FROM employer_discovery WHERE company_key = $1 FOR UPDATE`,
      [companyKey]
    );
    if (!row.rowCount) throw new Error(`no existe el candidato ${companyKey}`);
    const employerId = row.rows[0].employer_id;
    const boards = row.rows[0].history.flatMap((entry) => entry.boards ?? []);
    let disabledBoards = 0;
    let aliasRetired = false;
    if (employerId) {
      for (const board of boards) {
        const [atsType, ...rest] = board.split(":");
        const disabled = await client.query(
          `UPDATE employer_sources SET enabled = FALSE WHERE employer_id = $1 AND ats_type = $2 AND ats_ref = $3 AND enabled`,
          [employerId, atsType, rest.join(":")]
        );
        disabledBoards += disabled.rowCount ?? 0;
      }
      const retired = await client.query(
        `DELETE FROM employer_aliases a USING employers e
         WHERE a.company_key = $1 AND a.employer_id = $2 AND e.id = a.employer_id AND e.discovery_origin LIKE 'discovery_%'`,
        [companyKey, employerId]
      );
      aliasRetired = (retired.rowCount ?? 0) > 0;
    }
    await client.query(
      `UPDATE employer_discovery SET
         decision = 'rejected', decided_by = 'human', decided_at = NOW(), decision_reason = $2::text, next_probe_at = NULL,
         history = history || jsonb_build_array(jsonb_build_object('at', NOW(), 'decision', 'rejected', 'by', 'human', 'reason', $2::text,
           'disabledBoards', $3::int, 'aliasRetired', $4::boolean)),
         updated_at = NOW()
       WHERE company_key = $1`,
      [companyKey, note.slice(0, 300), disabledBoards, aliasRetired]
    );
    await client.query("COMMIT");
    return { disabledBoards, aliasRetired };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Sends a candidate to needs_review after a promotion conflict. */
export async function markNeedsReview(companyKey: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE employer_discovery SET decision = 'needs_review', decided_by = 'auto', decided_at = NOW(), decision_reason = $2::text,
       next_probe_at = NULL,
       history = history || jsonb_build_array(jsonb_build_object('at', NOW(), 'decision', 'needs_review', 'by', 'auto', 'reason', $2::text)),
       updated_at = NOW()
     WHERE company_key = $1 AND decision NOT IN ('known', 'verified', 'rejected')`,
    [companyKey, reason.slice(0, 300)]
  );
}

// ---------- coverage ----------

export interface CoverageBucketRow {
  decision: string;
  nameProbe: string;
  siteProbe: string;
  companies: number;
  rows: number;
}

export async function coverageBuckets(): Promise<CoverageBucketRow[]> {
  const result = await pool.query(
    `SELECT decision, name_probe_status, site_probe_status, COUNT(*)::int AS companies, COALESCE(SUM(directory_count), 0)::int AS rows
     FROM employer_discovery WHERE directory_count > 0 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`
  );
  return result.rows.map((row) => ({
    decision: row.decision,
    nameProbe: row.name_probe_status,
    siteProbe: row.site_probe_status,
    companies: row.companies,
    rows: row.rows
  }));
}

/** Live official vacancies of enabled boards (same predicate the tick report uses). */
export async function liveOfficialCount(): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM direct_jobs dj
       JOIN employer_sources es ON es.id = dj.employer_source_id
      WHERE es.enabled AND ${liveDirectJobSql("dj")}`
  );
  return result.rows[0].n;
}

export interface TickCapacity {
  enabledBoards: number;
  neverRead: number;
  /** Enabled boards whose last good read is older than 6 h: the tick is behind on them. */
  behind: number;
  oldestOkAt: string | null;
}

export async function tickCapacity(): Promise<TickCapacity> {
  const result = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE enabled)::int AS enabled,
            COUNT(*) FILTER (WHERE enabled AND last_ok_at IS NULL)::int AS never,
            COUNT(*) FILTER (WHERE enabled AND last_ok_at < NOW() - INTERVAL '6 hours')::int AS behind,
            MIN(last_ok_at) FILTER (WHERE enabled) AS oldest
     FROM employer_sources`
  );
  const row = result.rows[0];
  return {
    enabledBoards: row.enabled,
    neverRead: row.never,
    behind: row.behind,
    oldestOkAt: row.oldest ? new Date(row.oldest).toISOString() : null
  };
}

/** Measured, not computed: how many boards went more than 6 h without a good read. */
export function formatTickCapacity(capacity: TickCapacity): string {
  return (
    `Tick (cada hora, tableros más viejos primero): ${capacity.enabledBoards} tableros habilitados, ` +
    `${capacity.neverRead} sin leer aún, ${capacity.behind} con más de 6 h sin lectura OK; último OK más viejo: ${capacity.oldestOkAt ?? "—"}.`
  );
}
