import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./client.js";
import { ResumeStudioUnavailableError } from "./resume-studio-repository.js";
import {
  APPLICATIONS_MAX_PER_USER,
  canonicalApplicationUrl,
  isAppliedOrLater,
  type Application,
  type ApplicationCreate,
  type ApplicationStatus,
  type ApplicationSummary,
  type ApplicationUpdate
} from "../lib/resume-applications.js";
import type { ResumeFacts } from "../lib/resume-studio.js";

// AI Resume Studio R4b — «Mis postulaciones» (schema.sql rs_applications).
// Same rules as the R1 repository: the user id always comes from the
// verified session, every query filters by it, and a row that belongs to
// someone else behaves exactly like one that doesn't exist (null → 404).
// Free: nothing here reads passes or quotas. Nothing logs CV content.

/** Per-user cap reached (APPLICATIONS_MAX_PER_USER). */
export class ApplicationLimitError extends Error {
  constructor() {
    super("Application limit reached.");
  }
}

/** adaptationId / resumeId that isn't the caller's (or doesn't exist). */
export class ApplicationReferenceError extends Error {
  constructor(public readonly field: "adaptationId" | "resumeId") {
    super("Unknown reference.");
  }
}

function rethrow(error: unknown): never {
  if ((error as { code?: string })?.code === "42P01") throw new ResumeStudioUnavailableError();
  throw error;
}

const iso = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toISOString();

interface ApplicationRow {
  id: string;
  job_title: string;
  job_company: string | null;
  job_url: string | null;
  adaptation_id: string | null;
  resume_id: string | null;
  resume_version_no: number | null;
  score_before: number | null;
  score_after: number | null;
  status: ApplicationStatus;
  note: string;
  has_cv: boolean;
  applied_at: Date | string | null;
  status_changed_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
  adapted_facts_json?: ResumeFacts | null;
}

const SUMMARY_COLUMNS = `id, job_title, job_company, job_url, adaptation_id, resume_id, resume_version_no,
  score_before, score_after, status, note, (adapted_facts_json IS NOT NULL) AS has_cv,
  applied_at, status_changed_at, created_at, updated_at`;

function toSummary(row: ApplicationRow): ApplicationSummary {
  return {
    id: row.id,
    job: { title: row.job_title, company: row.job_company, url: row.job_url },
    status: row.status,
    note: row.note,
    adaptationId: row.adaptation_id,
    resumeId: row.resume_id,
    resumeVersionNo: row.resume_version_no,
    scoreBefore: row.score_before,
    scoreAfter: row.score_after,
    hasCv: row.has_cv,
    appliedAt: row.applied_at ? iso(row.applied_at) : null,
    statusChangedAt: iso(row.status_changed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function toApplication(row: ApplicationRow): Application {
  return { ...toSummary(row), facts: row.adapted_facts_json ?? null };
}

export function applicationUrlKey(url: string): string {
  return createHash("sha256").update(canonicalApplicationUrl(url), "utf8").digest("hex");
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listApplications(userId: string): Promise<ApplicationSummary[]> {
  try {
    const result = await pool.query<ApplicationRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM rs_applications WHERE user_id = $1
       ORDER BY updated_at DESC, id LIMIT ${APPLICATIONS_MAX_PER_USER}`,
      [userId]
    );
    return result.rows.map(toSummary);
  } catch (error) {
    rethrow(error);
  }
}

export async function getApplication(userId: string, applicationId: string): Promise<Application | null> {
  try {
    const result = await pool.query<ApplicationRow>(
      `SELECT ${SUMMARY_COLUMNS}, adapted_facts_json FROM rs_applications WHERE id = $1 AND user_id = $2`,
      [applicationId, userId]
    );
    return result.rows[0] ? toApplication(result.rows[0]) : null;
  } catch (error) {
    rethrow(error);
  }
}

/** Every card with its adapted CV, oldest first (derecho de acceso). */
export async function exportApplications(userId: string): Promise<Application[]> {
  try {
    const result = await pool.query<ApplicationRow>(
      `SELECT ${SUMMARY_COLUMNS}, adapted_facts_json FROM rs_applications WHERE user_id = $1 ORDER BY created_at, id`,
      [userId]
    );
    return result.rows.map(toApplication);
  } catch (error) {
    rethrow(error);
  }
}

async function ownsAdaptation(client: PoolClient, userId: string, adaptationId: string): Promise<boolean> {
  try {
    await client.query("SAVEPOINT rs_app_ref");
    const result = await client.query(
      `SELECT 1 FROM rs_ai_usage WHERE adaptation_id = $1 AND user_id = $2 AND status = 'start' LIMIT 1`,
      [adaptationId, userId]
    );
    await client.query("RELEASE SAVEPOINT rs_app_ref");
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    if ((error as { code?: string })?.code === "42P01") {
      await client.query("ROLLBACK TO SAVEPOINT rs_app_ref");
      return false;
    }
    throw error;
  }
}

/**
 * Creates a card, or — when the same vacancy URL is already on the board —
 * updates that card with what came in (a later adaptation replaces the CV
 * and scores; a status, if sent, moves it). Returns the row and whether it
 * was new.
 */
export async function saveApplication(userId: string, input: ApplicationCreate): Promise<{ application: Application; created: boolean }> {
  try {
    return await inTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`rs_applications:${userId}`]);
      if (input.adaptationId && !(await ownsAdaptation(client, userId, input.adaptationId))) {
        throw new ApplicationReferenceError("adaptationId");
      }
      if (input.resumeId) {
        const owner = await client.query(`SELECT 1 FROM rs_resumes WHERE id = $1 AND user_id = $2`, [input.resumeId, userId]);
        if (!owner.rowCount) throw new ApplicationReferenceError("resumeId");
      }
      const url = input.job.url ? canonicalApplicationUrl(input.job.url) : null;
      const urlKey = url ? applicationUrlKey(url) : null;
      const status = input.status ?? null;
      const facts = input.facts ? JSON.stringify(input.facts) : null;

      if (urlKey) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM rs_applications WHERE user_id = $1 AND job_url_key = $2 FOR UPDATE`,
          [userId, urlKey]
        );
        const id = existing.rows[0]?.id;
        if (id) {
          const result = await client.query<ApplicationRow>(
            `UPDATE rs_applications SET
               job_title = $3,
               job_company = COALESCE($4, job_company),
               adaptation_id = COALESCE($5, adaptation_id),
               resume_id = COALESCE($6, resume_id),
               resume_version_no = COALESCE($7, resume_version_no),
               adapted_facts_json = COALESCE($8::jsonb, adapted_facts_json),
               score_before = COALESCE($9, score_before),
               score_after = COALESCE($10, score_after),
               note = COALESCE($11, note),
               status_changed_at = CASE WHEN $12::varchar IS NOT NULL AND $12::varchar <> status THEN NOW() ELSE status_changed_at END,
               applied_at = CASE WHEN applied_at IS NULL AND $13 THEN NOW() ELSE applied_at END,
               status = COALESCE($12::varchar, status),
               updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING ${SUMMARY_COLUMNS}, adapted_facts_json`,
            [
              id,
              userId,
              input.job.title,
              input.job.company ?? null,
              input.adaptationId ?? null,
              input.resumeId ?? null,
              input.resumeVersionNo ?? null,
              facts,
              input.scoreBefore ?? null,
              input.scoreAfter ?? null,
              input.note ?? null,
              status,
              status !== null && isAppliedOrLater(status)
            ]
          );
          return { application: toApplication(result.rows[0]), created: false };
        }
      }

      const count = await client.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM rs_applications WHERE user_id = $1`, [userId]);
      if (Number(count.rows[0].n) >= APPLICATIONS_MAX_PER_USER) throw new ApplicationLimitError();
      const finalStatus = status ?? "saved";
      const result = await client.query<ApplicationRow>(
        `INSERT INTO rs_applications
           (user_id, job_title, job_company, job_url, job_url_key, adaptation_id, resume_id, resume_version_no,
            adapted_facts_json, score_before, score_after, status, note, applied_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, CASE WHEN $14 THEN NOW() ELSE NULL END)
         RETURNING ${SUMMARY_COLUMNS}, adapted_facts_json`,
        [
          userId,
          input.job.title,
          input.job.company ?? null,
          url,
          urlKey,
          input.adaptationId ?? null,
          input.resumeId ?? null,
          input.resumeVersionNo ?? null,
          facts,
          input.scoreBefore ?? null,
          input.scoreAfter ?? null,
          finalStatus,
          input.note ?? "",
          isAppliedOrLater(finalStatus)
        ]
      );
      return { application: toApplication(result.rows[0]), created: true };
    });
  } catch (error) {
    if (error instanceof ApplicationLimitError || error instanceof ApplicationReferenceError) throw error;
    rethrow(error);
  }
}

/** Moves a card and/or edits its note. null when it isn't this user's. */
export async function updateApplication(userId: string, applicationId: string, input: ApplicationUpdate): Promise<ApplicationSummary | null> {
  try {
    const status = input.status ?? null;
    const result = await pool.query<ApplicationRow>(
      `UPDATE rs_applications SET
         note = COALESCE($3, note),
         status_changed_at = CASE WHEN $4::varchar IS NOT NULL AND $4::varchar <> status THEN NOW() ELSE status_changed_at END,
         applied_at = CASE WHEN applied_at IS NULL AND $5 THEN NOW() ELSE applied_at END,
         status = COALESCE($4::varchar, status),
         updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING ${SUMMARY_COLUMNS}`,
      [applicationId, userId, input.note ?? null, status, status !== null && isAppliedOrLater(status)]
    );
    return result.rows[0] ? toSummary(result.rows[0]) : null;
  } catch (error) {
    rethrow(error);
  }
}

export async function deleteApplication(userId: string, applicationId: string): Promise<boolean> {
  try {
    const result = await pool.query(`DELETE FROM rs_applications WHERE id = $1 AND user_id = $2`, [applicationId, userId]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    rethrow(error);
  }
}
