import { pool } from "./client.js";
import { liveJobSql } from "../lib/job-freshness.js";

// "Mis vacantes" of a signed-in user (schema.sql's saved-jobs block). Every
// function takes the user id that verifySession resolved from the JWT —
// never one sent by the client — and the job snapshot is read from `jobs`
// here, so a client can't plant a fake title or company.

export const SAVED_JOBS_LIMIT = 500;

export interface SavedJob {
  jobId: string;
  title: string;
  company: string | null;
  location: string | null;
  source: string | null;
  savedAt: string;
  appliedAt: string | null;
  /** False once the job expired or was purged: shown as "ya no disponible". */
  available: boolean;
}

/** The table doesn't exist yet (migration not applied): the API answers 503. */
export class SavedJobsUnavailableError extends Error {
  constructor() {
    super("Saved jobs are not available yet.");
  }
}

export class SavedJobsLimitError extends Error {
  constructor() {
    super(`Saved jobs limit (${SAVED_JOBS_LIMIT}) reached.`);
  }
}

function rethrow(error: unknown): never {
  // 42P01 = undefined_table.
  if ((error as { code?: string })?.code === "42P01") throw new SavedJobsUnavailableError();
  throw error;
}

interface SavedJobRow {
  job_id: string;
  title: string;
  company: string | null;
  location: string | null;
  source: string | null;
  saved_at: Date | string;
  applied_at: Date | string | null;
  available: boolean;
}

function toSavedJob(row: SavedJobRow): SavedJob {
  const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());
  return {
    jobId: row.job_id,
    title: row.title,
    company: row.company,
    location: row.location,
    source: row.source,
    savedAt: iso(row.saved_at),
    appliedAt: row.applied_at ? iso(row.applied_at) : null,
    available: row.available
  };
}

export async function listSavedJobs(userId: string): Promise<SavedJob[]> {
  try {
    const result = await pool.query<SavedJobRow>(
      `SELECT s.job_id, s.title, s.company, s.location, s.source, s.saved_at, s.applied_at,
              (j.id IS NOT NULL) AS available
       FROM user_saved_jobs s
       LEFT JOIN jobs j ON j.id = s.job_id AND j.is_active = TRUE AND ${liveJobSql("j")}
       WHERE s.user_id = $1
       ORDER BY s.saved_at DESC
       LIMIT ${SAVED_JOBS_LIMIT}`,
      [userId]
    );
    return result.rows.map(toSavedJob);
  } catch (error) {
    rethrow(error);
  }
}

/**
 * Saves a job (or updates its "applied" mark). `applied`: true marks it now
 * (keeping the first date), false clears it, undefined leaves it as is.
 * Returns null when the job id isn't a job we have.
 */
export async function saveJob(userId: string, jobId: string, applied?: boolean): Promise<SavedJob | null> {
  try {
    const appliedSql =
      applied === true ? "COALESCE(user_saved_jobs.applied_at, NOW())" : applied === false ? "NULL" : "user_saved_jobs.applied_at";
    const insertApplied = applied === true ? "NOW()" : "NULL";
    const result = await pool.query<SavedJobRow>(
      `WITH job AS (
         SELECT id, title, company, location, source, (is_active = TRUE AND ${liveJobSql()}) AS available
         FROM jobs WHERE id = $2
       ), quota AS (
         SELECT COUNT(*) AS n FROM user_saved_jobs WHERE user_id = $1
       ), upserted AS (
         INSERT INTO user_saved_jobs (user_id, job_id, title, company, location, source, applied_at)
         SELECT $1, job.id, job.title, job.company, job.location, job.source, ${insertApplied}
         FROM job, quota
         WHERE quota.n < ${SAVED_JOBS_LIMIT}
            OR EXISTS (SELECT 1 FROM user_saved_jobs WHERE user_id = $1 AND job_id = $2)
         ON CONFLICT (user_id, job_id) DO UPDATE SET applied_at = ${appliedSql}
         RETURNING job_id, title, company, location, source, saved_at, applied_at
       )
       SELECT upserted.*, job.available
       FROM upserted, job`,
      [userId, jobId]
    );
    if (result.rows[0]) return toSavedJob(result.rows[0]);
    const exists = await pool.query(`SELECT 1 FROM jobs WHERE id = $1`, [jobId]);
    if (!exists.rowCount) return null;
    throw new SavedJobsLimitError();
  } catch (error) {
    if (error instanceof SavedJobsLimitError) throw error;
    rethrow(error);
  }
}

/** True when a row was removed. */
export async function removeSavedJob(userId: string, jobId: string): Promise<boolean> {
  try {
    const result = await pool.query(`DELETE FROM user_saved_jobs WHERE user_id = $1 AND job_id = $2`, [userId, jobId]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    rethrow(error);
  }
}
