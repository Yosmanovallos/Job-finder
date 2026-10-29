import { createHash } from "node:crypto";
import { pool } from "./client.js";
import { mutateReadinessRelevantJobs, refreshGoogleReadiness } from "./job-readiness-repository.js";
import { deleteClosedJobs } from "./scheduler-repository.js";
import { liveDirectJobSql } from "../direct/ingest.js";
import { BROAD_LOCATION_KEYS, copyMatchLocationSql, copySpecificCityMismatchSql } from "../lib/official-copy-location.js";
import { MAX_JOB_AGE_DAYS } from "../lib/job-freshness.js";

/**
 * Official vacancies as rows of `jobs` (docs/adr/0006-direct-employers.md
 * §10, phase D4). `direct_jobs` stays the source of truth; this module keeps
 * a read projection in `jobs` so every public page shows an official vacancy
 * with the same components, filters, sitemap and JSON-LD as a job-board one,
 * without touching the hot read queries.
 *
 * Called only from scripts (the direct tick, and the scrape tick's supersede
 * pass) — never by the web server (§9, import-graph test).
 */

/** The `source`/`sources` value of a projection row: the button reads "Aplicar en Portal oficial". */
export const OFFICIAL_SOURCE = "Portal oficial";

/**
 * Stable, namespaced identity (§10.1): never the hash of the apply URL — a
 * job board may carry that very URL, and some apply URLs change with the
 * title. Used for both url_hash and content_fingerprint, so the projection
 * never takes part in saveJobs()'s fingerprint merge (review B2).
 */
export function projectionHash(directJobId: string): string {
  return createHash("sha256").update(`direct:${directJobId}`).digest("hex");
}

/** SQL twin of projectionHash(): PostgreSQL's built-in sha256 over the same UTF-8 text. */
const PROJECTION_HASH_SQL = `encode(sha256(convert_to('direct:' || d.id::text, 'UTF8')), 'hex')`;

// Bounded like mutateReadinessRelevantJobs (500 per transaction).
const BATCH = 500;

/** A live official vacancy of an enabled board, joined to its employer. */
const LIVE_PROJECTABLE = `
  FROM direct_jobs d
  JOIN employer_sources s ON s.id = d.employer_source_id AND s.enabled
  JOIN employers e ON e.id = d.employer_id
  WHERE ${liveDirectJobSql("d")}
    AND NOT EXISTS (
      SELECT 1 FROM archived_jobs a WHERE a.job_id = d.id
        AND (a.snapshot->>'published_at')::timestamptz < NOW() - INTERVAL '${MAX_JOB_AGE_DAYS} days'
    )`;

export interface ProjectionResult {
  inserted: number;
  updated: number;
  removed: number;
  reverted: number;
  revertSkipped: number;
  superseded: number;
}

/**
 * Inserts new projections and refreshes changed ones. Facts only as the ATS
 * stated them (§10.2): location = city + ", Colombia" or just "Colombia" (no
 * guessed city — such a row stays visible but not Google-ready); remote only
 * when the ATS said so; `company` is the employer's display name, fixed at
 * insert (review I3); `published_at` fixed at insert and only ever moved
 * BACK when the ATS later states an earlier date (review M2).
 */
async function upsertProjections(): Promise<{ inserted: number; updated: number; changedIds: string[] }> {
  const result = await pool.query<{ id: string; inserted: boolean }>(
    `INSERT INTO jobs (id, direct_job_id, url_hash, content_fingerprint, title, company, location, url,
                       source, sources, date_text, published_at, last_seen_at, is_active, country, description,
                       employment_type, description_kind, description_source, remote_type,
                       applicant_countries, valid_through, detail_status)
     SELECT d.id, d.id, ${PROJECTION_HASH_SQL}, ${PROJECTION_HASH_SQL}, d.title, e.display_name,
            CASE WHEN d.city IS NOT NULL THEN d.city || ', Colombia' ELSE 'Colombia' END,
            d.apply_url, $1::text, jsonb_build_array($1::text),
            -- The ATS stated no date (Google): say so instead of letting
            -- "first seen" read like a posting date ("hace menos de 1 h").
            CASE WHEN d.published_at IS NULL THEN 'Fecha no indicada' END,
            LEAST(COALESCE(d.published_at, d.first_seen_at),
              (SELECT (a.snapshot->>'published_at')::timestamptz FROM archived_jobs a WHERE a.job_id = d.id)),
            NOW(), TRUE, 'CO',
            d.description_text, d.employment_type,
            CASE WHEN d.description_text IS NOT NULL THEN 'full' END,
            CASE WHEN d.description_text IS NOT NULL THEN 'listing' END,
            CASE d.workplace WHEN 'remote' THEN 'fully_remote' WHEN 'hybrid' THEN 'hybrid' WHEN 'onsite' THEN 'onsite' END,
            CASE WHEN d.workplace = 'remote' THEN '["CO"]'::jsonb END,
            d.valid_through,
            CASE WHEN d.description_text IS NOT NULL THEN 'complete' ELSE 'unsupported' END
     ${LIVE_PROJECTABLE}
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       location = EXCLUDED.location,
       url = EXCLUDED.url,
       description = COALESCE(EXCLUDED.description, jobs.description),
       employment_type = EXCLUDED.employment_type,
       description_kind = COALESCE(EXCLUDED.description_kind, jobs.description_kind),
       description_source = COALESCE(EXCLUDED.description_source, jobs.description_source),
       remote_type = EXCLUDED.remote_type,
       applicant_countries = EXCLUDED.applicant_countries,
       valid_through = EXCLUDED.valid_through,
       detail_status = CASE WHEN COALESCE(EXCLUDED.description, jobs.description) IS NOT NULL THEN 'complete' ELSE 'unsupported' END,
       published_at = LEAST(jobs.published_at, EXCLUDED.published_at),
       date_text = EXCLUDED.date_text,
       last_seen_at = NOW()
     WHERE jobs.direct_job_id IS NOT NULL
       AND (jobs.title, jobs.location, jobs.url, COALESCE(jobs.description, ''), COALESCE(jobs.employment_type, ''),
            COALESCE(jobs.remote_type, ''), jobs.valid_through, jobs.published_at, COALESCE(jobs.date_text, ''))
           IS DISTINCT FROM
           (EXCLUDED.title, EXCLUDED.location, EXCLUDED.url, COALESCE(EXCLUDED.description, jobs.description, ''),
            COALESCE(EXCLUDED.employment_type, ''), COALESCE(EXCLUDED.remote_type, ''), EXCLUDED.valid_through,
            LEAST(jobs.published_at, EXCLUDED.published_at), COALESCE(EXCLUDED.date_text, ''))
     RETURNING id, (xmax = 0) AS inserted`,
    [OFFICIAL_SOURCE]
  );
  return {
    inserted: result.rows.filter((row) => row.inserted).length,
    updated: result.rows.filter((row) => !row.inserted).length,
    changedIds: result.rows.map((row) => row.id)
  };
}

/** Every live projection is re-seen: purgeOldJobs() must never age out a live official vacancy. */
async function touchLiveProjections(): Promise<void> {
  await pool.query(
    `UPDATE jobs SET last_seen_at = NOW()
     WHERE direct_job_id IS NOT NULL AND id IN (SELECT d.id ${LIVE_PROJECTABLE})`
  );
}

/** Projections whose official vacancy is no longer live, or whose board was turned off (§10.5). */
async function removeDeadProjections(): Promise<number> {
  const dead = await pool.query<{ id: string }>(
    `SELECT j.id FROM jobs j
     WHERE j.direct_job_id IS NOT NULL AND j.is_active = TRUE
       AND NOT EXISTS (SELECT 1 ${LIVE_PROJECTABLE} AND d.id = j.direct_job_id)`
  );
  let removed = 0;
  for (let index = 0; index < dead.rows.length; index += BATCH) {
    removed += await deleteClosedJobs(dead.rows.slice(index, index + BATCH).map((row) => row.id));
  }
  return removed;
}

/**
 * The single reversion rule (§10.6, review B3/I2): a copy whose projection is
 * gone, or whose old match points to a different specific city, comes back —
 * but only if its job board still listed it in the last
 * 48 h, only one row per fingerprint, and with source_checked_at cleared so
 * source closure re-verifies it. An older copy stays hidden; its page answers
 * 410 (the official version closed). Runs every tick, whoever deleted the
 * projection (this tick, purgeOldJobs, a disabled board).
 */
async function revertOrphanOrMismatchedCopies(): Promise<{ reverted: number; skipped: number }> {
  const orphans = await pool.query<{ id: string }>(
    `SELECT DISTINCT ON (COALESCE(c.content_fingerprint, c.id::text)) c.id
     FROM jobs c
     WHERE c.superseded_by IS NOT NULL
       AND c.last_seen_at > NOW() - INTERVAL '48 hours'
       AND (
         NOT EXISTS (SELECT 1 FROM jobs p WHERE p.id = c.superseded_by AND p.is_active = TRUE AND p.direct_job_id IS NOT NULL)
         OR EXISTS (
           SELECT 1 FROM jobs p
           WHERE p.id = c.superseded_by AND p.is_active = TRUE AND p.direct_job_id IS NOT NULL
             AND (c.country = 'CO' OR c.country IS NULL)
             AND ${copySpecificCityMismatchSql("c", "p")}
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM jobs a
         WHERE a.is_active = TRUE AND a.content_fingerprint = c.content_fingerprint AND a.id <> c.id
       )
     ORDER BY COALESCE(c.content_fingerprint, c.id::text), c.published_at DESC, c.id DESC`
  );
  let reverted = 0;
  let skipped = 0;
  // One transaction per copy: a job board scrape may insert an active row
  // with the same fingerprint meanwhile (unique index): that copy is skipped
  // this time instead of rolling back the whole batch.
  for (const row of orphans.rows) {
    try {
      const outcome = await mutateReadinessRelevantJobs(
        [{ id: row.id, patch: { is_active: true, superseded_by: null, source_checked_at: null } }],
        { notify: false }
      );
      reverted += outcome.length;
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      skipped++;
    }
  }
  return { reverted, skipped };
}

/**
 * Hides the job-board copies of live official vacancies (§8, §10.6): same
 * employer through employer_aliases (curated, never fuzzy) and the same
 * title_key (the trigger-maintained key, identical to the dedupe identity).
 * Specific cities must match (including formatting-only Bogotá aliases).
 * A broad board location still matches when the official title is in one
 * city; a broad official listing can replace a city copy only when it is the
 * sole official posting for that title. Colombia
 * and remote rows only — Venezuela is never touched.
 * Exported for the scrape tick, which runs it after saving (review I1).
 */
export async function supersedeCopies(): Promise<number> {
  const pairs = await pool.query<{ copy_id: string; projection_id: string }>(
    `WITH projections AS (
       SELECT p.id, p.title_key, p.location_key, ${copyMatchLocationSql("p.location_key")} AS match_location, d.employer_id
       FROM jobs p JOIN direct_jobs d ON d.id = p.direct_job_id
       WHERE p.direct_job_id IS NOT NULL AND p.is_active = TRUE
     ), spread AS (
       SELECT employer_id, title_key, COUNT(*) AS n, COUNT(DISTINCT match_location) AS cities FROM projections GROUP BY 1, 2
     ), candidates AS (
       SELECT c.id AS copy_id, p.id AS projection_id,
              ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY (${copyMatchLocationSql("c.location_key")} = p.match_location) DESC, p.id) AS rank
       FROM jobs c
       JOIN employer_aliases a ON a.company_key = c.company_key
       JOIN projections p ON p.employer_id = a.employer_id AND p.title_key = c.title_key
       JOIN spread k ON k.employer_id = p.employer_id AND k.title_key = p.title_key
       WHERE c.is_active = TRUE AND c.direct_job_id IS NULL AND c.superseded_by IS NULL
         AND (c.country = 'CO' OR c.country IS NULL)
         AND c.title_key <> ''
         AND ((${copyMatchLocationSql("c.location_key")} = p.match_location AND c.location_key NOT IN ${BROAD_LOCATION_KEYS})
              -- A country-only copy when every official posting of that title
              -- is in ONE city: there is only one place it can be a copy of.
              OR (c.location_key IN ${BROAD_LOCATION_KEYS} AND k.cities = 1)
              OR (p.location_key IN ${BROAD_LOCATION_KEYS} AND k.n = 1))
     )
     SELECT copy_id, projection_id FROM candidates WHERE rank = 1`
  );
  let superseded = 0;
  for (let index = 0; index < pairs.rows.length; index += BATCH) {
    const outcomes = await mutateReadinessRelevantJobs(
      pairs.rows.slice(index, index + BATCH).map((row) => ({ id: row.copy_id, patch: { is_active: false, superseded_by: row.projection_id } })),
      { notify: false }
    );
    superseded += outcomes.length;
  }
  return superseded;
}

/** One full projection pass, after the boards were read. Order matters: removal before reversion, reversion before supersede. */
export async function syncProjections(): Promise<ProjectionResult> {
  const upserted = await upsertProjections();
  await touchLiveProjections();
  // Google gate without Indexing API notifications (§10.7): new and changed
  // rows only.
  for (const id of upserted.changedIds) await refreshGoogleReadiness(id, { contentObtained: true, notify: false });
  const removed = await removeDeadProjections();
  const reversion = await revertOrphanOrMismatchedCopies();
  const superseded = await supersedeCopies();
  return {
    inserted: upserted.inserted,
    updated: upserted.updated,
    removed,
    reverted: reversion.reverted,
    revertSkipped: reversion.skipped,
    superseded
  };
}
