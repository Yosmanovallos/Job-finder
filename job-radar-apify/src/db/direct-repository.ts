import { pool } from "./client.js";
import { companyKeySql, storedCompanyKeySql } from "../lib/company-identity.js";
import { liveJobSql } from "../lib/job-freshness.js";
import { liveDirectJobSql, MISSING_LISTINGS_TO_CLOSE } from "../direct/ingest.js";
import type { DirectAtsType, DirectPosting } from "../direct/types.js";

/**
 * Persistence for employers and their official vacancies (ADR 0006).
 * Writes only the direct-employers tables — never `jobs`.
 */

export interface EmployerSourceRow {
  id: string;
  employerId: string;
  employerSlug: string;
  atsType: DirectAtsType;
  atsRef: string;
  lastBoardTotal: number | null;
}

// ---------- employers ----------

export interface EmployerSeed {
  slug: string;
  displayName: string;
  websiteDomain: string | null;
  origin: "manual" | "seed" | "datos_gov" | "commoncrawl";
  /** Spellings the job boards use for this employer (raw names). */
  aliases: string[];
  sources: { atsType: DirectAtsType; atsRef: string; portalUrl: string; enabled: boolean }[];
}

export interface EmployerSeedResult {
  employerId: string;
  aliasesAdded: number;
  /** Alias keys already mapped to a different employer (left untouched). */
  aliasConflicts: string[];
  sourcesUpserted: number;
}

/** Idempotent: re-running a seed updates names/flags, never duplicates. */
export async function upsertEmployer(seed: EmployerSeed): Promise<EmployerSeedResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const employer = await client.query<{ id: string; company_key: string }>(
      `INSERT INTO employers (slug, display_name, company_key, website_domain, discovery_origin)
       VALUES ($1, $2::text, ${companyKeySql("$2::text")}, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         company_key = EXCLUDED.company_key,
         website_domain = COALESCE(EXCLUDED.website_domain, employers.website_domain),
         updated_at = NOW()
       RETURNING id, company_key`,
      [seed.slug, seed.displayName, seed.websiteDomain, seed.origin]
    );
    const employerId = employer.rows[0].id;

    let aliasesAdded = 0;
    const aliasConflicts: string[] = [];
    for (const name of new Set([seed.displayName, ...seed.aliases])) {
      const inserted = await client.query<{ employer_id: string; company_key: string; inserted: boolean }>(
        `INSERT INTO employer_aliases (company_key, employer_id)
         VALUES (${companyKeySql("$1::text")}, $2)
         ON CONFLICT (company_key) DO UPDATE SET company_key = employer_aliases.company_key
         RETURNING employer_id, company_key, (xmax = 0) AS inserted`,
        [name, employerId]
      );
      const row = inserted.rows[0];
      if (row.employer_id !== employerId) aliasConflicts.push(row.company_key);
      else if (row.inserted) aliasesAdded++;
    }

    for (const source of seed.sources) {
      await client.query(
        `INSERT INTO employer_sources (employer_id, ats_type, ats_ref, portal_url, enabled)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ats_type, ats_ref) DO UPDATE SET
           employer_id = EXCLUDED.employer_id,
           portal_url = EXCLUDED.portal_url,
           enabled = EXCLUDED.enabled`,
        [employerId, source.atsType, source.atsRef, source.portalUrl, source.enabled]
      );
    }
    await client.query("COMMIT");
    return { employerId, aliasesAdded, aliasConflicts, sourcesUpserted: seed.sources.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// ---------- tick ----------

/**
 * Enabled boards due for a run: never run, or last run older than
 * `minIntervalHours`. Oldest first, so a capped tick rotates fairly.
 */
export async function pickDueSources(options: {
  limit: number;
  minIntervalHours: number;
  employerSlug?: string;
}): Promise<EmployerSourceRow[]> {
  const result = await pool.query(
    `SELECT s.id, s.employer_id, e.slug, s.ats_type, s.ats_ref, s.last_board_total
     FROM employer_sources s JOIN employers e ON e.id = s.employer_id
     WHERE s.enabled
       AND ($3::text IS NULL OR e.slug = $3)
       AND (s.last_run_at IS NULL OR s.last_run_at < NOW() - make_interval(hours => $2::int))
     ORDER BY s.last_run_at NULLS FIRST, s.id
     LIMIT $1`,
    [options.limit, options.minIntervalHours, options.employerSlug ?? null]
  );
  return result.rows.map((row) => ({
    id: row.id,
    employerId: row.employer_id,
    employerSlug: row.slug,
    atsType: row.ats_type,
    atsRef: row.ats_ref,
    lastBoardTotal: row.last_board_total
  }));
}

export interface SaveListingResult {
  inserted: number;
  updated: number;
  closed: number;
  markedMissing: number;
}

/**
 * Stores one complete listing in a single transaction: upsert every posting
 * (stable key: source + ATS id, so a re-run never mints a new row), then —
 * only when `applyClosures` — count a miss for every open row the listing
 * no longer has and close it at MISSING_LISTINGS_TO_CLOSE misses.
 */
export async function saveListing(
  source: Pick<EmployerSourceRow, "id" | "employerId">,
  postings: DirectPosting[],
  applyClosures: boolean
): Promise<SaveListingResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    let updated = 0;
    if (postings.length > 0) {
      const rows = postings.map((posting) => ({
        external_id: posting.externalId,
        title: posting.title,
        location_raw: posting.locationRaw,
        city: posting.city,
        workplace: posting.workplace,
        apply_url: posting.applyUrl,
        description_text: posting.descriptionText,
        department: posting.department,
        employment_type: posting.employmentType,
        published_at: posting.publishedAt,
        valid_through: posting.validThrough,
        content_hash: posting.contentHash
      }));
      const upsert = await client.query<{ inserted: boolean }>(
        `INSERT INTO direct_jobs (employer_source_id, employer_id, external_id, title, location_raw, city,
                                  workplace, apply_url, description_text, department, employment_type,
                                  published_at, valid_through, content_hash)
         SELECT $1, $2, r.external_id, r.title, r.location_raw, r.city, r.workplace, r.apply_url,
                r.description_text, r.department, r.employment_type, r.published_at, r.valid_through, r.content_hash
         FROM jsonb_to_recordset($3::jsonb) AS r(
           external_id text, title text, location_raw text, city text, workplace text, apply_url text,
           description_text text, department text, employment_type text, published_at timestamptz,
           valid_through timestamptz, content_hash text)
         ON CONFLICT (employer_source_id, external_id) DO UPDATE SET
           title = EXCLUDED.title,
           location_raw = EXCLUDED.location_raw,
           city = EXCLUDED.city,
           workplace = EXCLUDED.workplace,
           apply_url = EXCLUDED.apply_url,
           description_text = EXCLUDED.description_text,
           department = EXCLUDED.department,
           employment_type = EXCLUDED.employment_type,
           published_at = COALESCE(EXCLUDED.published_at, direct_jobs.published_at),
           valid_through = EXCLUDED.valid_through,
           content_hash = EXCLUDED.content_hash,
           last_seen_at = NOW(),
           missing_count = 0,
           closed_at = NULL
         RETURNING (xmax = 0) AS inserted`,
        [source.id, source.employerId, JSON.stringify(rows)]
      );
      inserted = upsert.rows.filter((row) => row.inserted).length;
      updated = upsert.rows.length - inserted;
      if (upsert.rows.length !== postings.length) {
        throw new Error(`[direct] upsert escribió ${upsert.rows.length} filas, se esperaban ${postings.length}`);
      }
    }

    let closed = 0;
    let markedMissing = 0;
    if (applyClosures) {
      const missing = await client.query<{ closed: boolean }>(
        `UPDATE direct_jobs SET
           missing_count = missing_count + 1,
           closed_at = CASE WHEN missing_count + 1 >= $3 THEN NOW() ELSE NULL END
         WHERE employer_source_id = $1 AND closed_at IS NULL AND NOT (external_id = ANY($2::text[]))
         RETURNING closed_at IS NOT NULL AS closed`,
        [source.id, postings.map((posting) => posting.externalId), MISSING_LISTINGS_TO_CLOSE]
      );
      closed = missing.rows.filter((row) => row.closed).length;
      markedMissing = missing.rows.length - closed;
    }
    await client.query("COMMIT");
    return { inserted, updated, closed, markedMissing };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type SourceOutcome =
  | { status: "ok"; boardTotal: number; colombiaTotal: number }
  | { status: "suspect"; boardTotal: number; colombiaTotal: number; detail: string }
  | { status: "not_found" | "error"; detail: string };

/** Records the board's health after a run. Failures never touch postings. */
export async function recordSourceOutcome(sourceId: string, outcome: SourceOutcome): Promise<void> {
  if (outcome.status === "ok") {
    await pool.query(
      `UPDATE employer_sources SET status = 'ok', last_run_at = NOW(), last_ok_at = NOW(),
         last_board_total = $2, last_colombia_total = $3, consecutive_failures = 0, last_error = NULL
       WHERE id = $1`,
      [sourceId, outcome.boardTotal, outcome.colombiaTotal]
    );
    return;
  }
  if (outcome.status === "suspect") {
    // last_board_total is kept: the guard compares the next run with the
    // last trusted total, not with the suspicious one.
    await pool.query(
      `UPDATE employer_sources SET status = 'suspect', last_run_at = NOW(),
         consecutive_failures = consecutive_failures + 1, last_error = $2
       WHERE id = $1`,
      [sourceId, outcome.detail.slice(0, 300)]
    );
    return;
  }
  await pool.query(
    `UPDATE employer_sources SET status = $2, last_run_at = NOW(),
       consecutive_failures = consecutive_failures + 1, last_error = $3
     WHERE id = $1`,
    [sourceId, outcome.status, outcome.detail.slice(0, 300)]
  );
}

/** Deletes postings closed more than a day ago, bounded per tick. */
export async function purgeClosedDirectJobs(limit = 5_000): Promise<number> {
  const result = await pool.query(
    `DELETE FROM direct_jobs WHERE id IN (
       SELECT id FROM direct_jobs WHERE closed_at < NOW() - INTERVAL '1 day' ORDER BY closed_at LIMIT $1)`,
    [limit]
  );
  return result.rowCount ?? 0;
}

// ---------- report ----------

export interface EmployerReportRow {
  slug: string;
  displayName: string;
  sources: string;
  status: string;
  officialLive: number;
  /** Live vacancies the job boards list under any alias of this employer. */
  boardsLive: number;
}

/**
 * Per employer: official vacancies vs what the scraped boards list for it
 * (through employer_aliases → jobs.company_key). Read-only.
 */
export async function employerReport(): Promise<EmployerReportRow[]> {
  const result = await pool.query(
    `SELECT e.slug, e.display_name,
            (SELECT string_agg(s.ats_type || ':' || s.ats_ref || CASE WHEN s.enabled THEN '' ELSE ' (off)' END, ', ' ORDER BY s.ats_type)
               FROM employer_sources s WHERE s.employer_id = e.id) AS sources,
            (SELECT string_agg(DISTINCT s.status, ',') FROM employer_sources s WHERE s.employer_id = e.id) AS status,
            (SELECT COUNT(*)::int FROM direct_jobs d WHERE d.employer_id = e.id AND ${liveDirectJobSql("d")}) AS official_live,
            -- Unaliased on purpose: inside this subquery the bare column
            -- names resolve to jobs (the innermost FROM), which is what the
            -- shared builders expect.
            (SELECT COUNT(*)::int FROM jobs
               WHERE ${storedCompanyKeySql()}
                     IN (SELECT a.company_key FROM employer_aliases a WHERE a.employer_id = e.id)
                 AND ${liveJobSql()}) AS boards_live
     FROM employers e
     ORDER BY official_live DESC, e.slug`
  );
  return result.rows.map((row) => ({
    slug: row.slug,
    displayName: row.display_name,
    sources: row.sources ?? "",
    status: row.status ?? "",
    officialLive: row.official_live,
    boardsLive: row.boards_live
  }));
}
