import type { PoolClient } from "pg";
import { pool } from "./client.js";
import {
  RESUME_POLICY_VERSION,
  RESUME_VERSIONS_KEPT,
  type ConsentPurpose,
  type ResumeFacts,
  type ResumeInput,
  type ResumeTemplateId
} from "../lib/resume-studio.js";

// AI Resume Studio R1 (schema.sql's resume-studio block, ADR 0017).
// Every function takes the user id that verifySession resolved from the JWT
// — never one sent by the client — and every query filters by it, so a
// resume id that belongs to someone else behaves exactly like one that
// doesn't exist (null → 404, doc 08 §3 IDOR). Nothing here logs CV content.

export class ResumeStudioUnavailableError extends Error {
  constructor() {
    super("Resume Studio tables are not available.");
  }
}

/** The user already has a base resume (R1 allows one). */
export class ResumeLimitError extends Error {
  constructor() {
    super("Base resume limit reached.");
  }
}

/** expectedVersion didn't match: someone saved in between (another tab). */
export class ResumeVersionConflictError extends Error {
  constructor(public readonly currentVersion: number) {
    super("Resume version conflict.");
  }
}

/** Undo with no earlier version left. */
export class ResumeNothingToUndoError extends Error {
  constructor() {
    super("Nothing to undo.");
  }
}

function rethrow(error: unknown): never {
  // 42P01 = undefined_table (migration not applied yet).
  if ((error as { code?: string })?.code === "42P01") throw new ResumeStudioUnavailableError();
  // 23505 on the one-base-per-user index.
  if ((error as { code?: string; constraint?: string })?.constraint === "rs_resumes_one_base_per_user") {
    throw new ResumeLimitError();
  }
  throw error;
}

const iso = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toISOString();

export interface ResumeSummary {
  id: string;
  title: string;
  templateId: ResumeTemplateId;
  versionNo: number;
  createdAt: string;
  updatedAt: string;
}

export interface Resume extends ResumeSummary {
  facts: ResumeFacts;
}

export interface ResumeVersionSummary {
  versionNo: number;
  title: string;
  templateId: ResumeTemplateId;
  changeSummary: string;
  createdBy: string;
  createdAt: string;
}

interface ResumeRow {
  id: string;
  title: string;
  template_id: ResumeTemplateId;
  version_no: number;
  created_at: Date | string;
  updated_at: Date | string;
  facts_json?: ResumeFacts;
}

function toSummary(row: ResumeRow): ResumeSummary {
  return {
    id: row.id,
    title: row.title,
    templateId: row.template_id,
    versionNo: row.version_no,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function toResume(row: ResumeRow): Resume {
  return { ...toSummary(row), facts: row.facts_json as ResumeFacts };
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

// ── Consents (insert-only; a trigger rejects UPDATE/DELETE) ─────────────────

export interface ConsentDecision {
  purpose: ConsentPurpose;
  granted: boolean;
  textHash: string;
}

/** Latest decision per purpose for the current policy version. */
export async function getConsentState(userId: string): Promise<Partial<Record<ConsentPurpose, boolean>>> {
  try {
    const result = await pool.query<{ purpose: ConsentPurpose; granted: boolean }>(
      `SELECT DISTINCT ON (purpose) purpose, granted
       FROM rs_consents
       WHERE user_id = $1 AND policy_version = $2
       ORDER BY purpose, created_at DESC, id DESC`,
      [userId, RESUME_POLICY_VERSION]
    );
    return Object.fromEntries(result.rows.map((row) => [row.purpose, row.granted]));
  } catch (error) {
    rethrow(error);
  }
}

export async function recordConsents(userId: string, decisions: ConsentDecision[]): Promise<void> {
  try {
    await inTransaction(async (client) => {
      for (const decision of decisions) {
        await client.query(
          `INSERT INTO rs_consents (user_id, purpose, policy_version, granted, text_hash)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, decision.purpose, RESUME_POLICY_VERSION, decision.granted, decision.textHash]
        );
      }
    });
  } catch (error) {
    rethrow(error);
  }
}

// ── Resumes ────────────────────────────────────────────────────────────────

export async function listResumes(userId: string): Promise<ResumeSummary[]> {
  try {
    const result = await pool.query<ResumeRow>(
      `SELECT id, title, template_id, version_no, created_at, updated_at
       FROM rs_resumes WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 20`,
      [userId]
    );
    return result.rows.map(toSummary);
  } catch (error) {
    rethrow(error);
  }
}

export async function getResume(userId: string, resumeId: string): Promise<Resume | null> {
  try {
    const result = await pool.query<ResumeRow>(
      `SELECT id, title, template_id, version_no, created_at, updated_at, facts_json
       FROM rs_resumes WHERE id = $1 AND user_id = $2`,
      [resumeId, userId]
    );
    return result.rows[0] ? toResume(result.rows[0]) : null;
  } catch (error) {
    rethrow(error);
  }
}

async function insertVersion(
  client: PoolClient,
  userId: string,
  resumeId: string,
  versionNo: number,
  input: ResumeInput,
  changeSummary: string
): Promise<void> {
  await client.query(
    `INSERT INTO rs_resume_versions (resume_id, user_id, version_no, title, template_id, facts_json, change_summary, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'user')`,
    [resumeId, userId, versionNo, input.title, input.templateId, JSON.stringify(input.facts), changeSummary]
  );
  await client.query(
    `DELETE FROM rs_resume_versions WHERE resume_id = $1 AND user_id = $2 AND version_no <= $3`,
    [resumeId, userId, versionNo - RESUME_VERSIONS_KEPT]
  );
}

export async function createResume(userId: string, input: ResumeInput): Promise<Resume> {
  try {
    return await inTransaction(async (client) => {
      const result = await client.query<ResumeRow>(
        `INSERT INTO rs_resumes (user_id, kind, title, template_id, facts_json, version_no)
         VALUES ($1, 'base', $2, $3, $4, 1)
         RETURNING id, title, template_id, version_no, created_at, updated_at, facts_json`,
        [userId, input.title, input.templateId, JSON.stringify(input.facts)]
      );
      const row = result.rows[0];
      await insertVersion(client, userId, row.id, 1, input, "Creada");
      return toResume(row);
    });
  } catch (error) {
    rethrow(error);
  }
}

async function writeNewVersion(
  client: PoolClient,
  userId: string,
  resumeId: string,
  expectedVersion: number | null,
  input: ResumeInput,
  changeSummary: string
): Promise<Resume | null> {
  const current = await client.query<{ version_no: number }>(
    `SELECT version_no FROM rs_resumes WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [resumeId, userId]
  );
  if (!current.rows[0]) return null;
  const currentVersion = current.rows[0].version_no;
  if (expectedVersion !== null && expectedVersion !== currentVersion) {
    throw new ResumeVersionConflictError(currentVersion);
  }
  const next = currentVersion + 1;
  const result = await client.query<ResumeRow>(
    `UPDATE rs_resumes
     SET title = $3, template_id = $4, facts_json = $5, version_no = $6, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, title, template_id, version_no, created_at, updated_at, facts_json`,
    [resumeId, userId, input.title, input.templateId, JSON.stringify(input.facts), next]
  );
  await insertVersion(client, userId, resumeId, next, input, changeSummary);
  return toResume(result.rows[0]);
}

/** null when the resume doesn't exist for this user. */
export async function updateResume(
  userId: string,
  resumeId: string,
  expectedVersion: number,
  input: ResumeInput
): Promise<Resume | null> {
  try {
    return await inTransaction((client) => writeNewVersion(client, userId, resumeId, expectedVersion, input, "Editada"));
  } catch (error) {
    if (error instanceof ResumeVersionConflictError) throw error;
    rethrow(error);
  }
}

export async function listResumeVersions(userId: string, resumeId: string): Promise<ResumeVersionSummary[] | null> {
  try {
    const owner = await pool.query(`SELECT 1 FROM rs_resumes WHERE id = $1 AND user_id = $2`, [resumeId, userId]);
    if (!owner.rowCount) return null;
    const result = await pool.query<{
      version_no: number;
      title: string;
      template_id: ResumeTemplateId;
      change_summary: string;
      created_by: string;
      created_at: Date | string;
    }>(
      `SELECT version_no, title, template_id, change_summary, created_by, created_at
       FROM rs_resume_versions WHERE resume_id = $1 AND user_id = $2
       ORDER BY version_no DESC`,
      [resumeId, userId]
    );
    return result.rows.map((row) => ({
      versionNo: row.version_no,
      title: row.title,
      templateId: row.template_id,
      changeSummary: row.change_summary,
      createdBy: row.created_by,
      createdAt: iso(row.created_at)
    }));
  } catch (error) {
    rethrow(error);
  }
}

/**
 * Restores an earlier version by writing it as a NEW version (history is
 * never rewritten). `versionNo` null = undo: the latest version older than
 * the current one. null when the resume or the version isn't this user's.
 */
export async function restoreResumeVersion(
  userId: string,
  resumeId: string,
  versionNo: number | null,
  expectedVersion: number | null
): Promise<Resume | null> {
  try {
    return await inTransaction(async (client) => {
      const current = await client.query<{ version_no: number }>(
        `SELECT version_no FROM rs_resumes WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [resumeId, userId]
      );
      if (!current.rows[0]) return null;
      const currentVersion = current.rows[0].version_no;
      const target = await client.query<{
        version_no: number;
        title: string;
        template_id: ResumeTemplateId;
        facts_json: ResumeFacts;
      }>(
        versionNo === null
          ? `SELECT version_no, title, template_id, facts_json FROM rs_resume_versions
             WHERE resume_id = $1 AND user_id = $2 AND version_no < $3
             ORDER BY version_no DESC LIMIT 1`
          : `SELECT version_no, title, template_id, facts_json FROM rs_resume_versions
             WHERE resume_id = $1 AND user_id = $2 AND version_no = $3`,
        [resumeId, userId, versionNo === null ? currentVersion : versionNo]
      );
      const row = target.rows[0];
      if (!row) {
        if (versionNo === null) throw new ResumeNothingToUndoError();
        return null;
      }
      return writeNewVersion(
        client,
        userId,
        resumeId,
        expectedVersion,
        { title: row.title, templateId: row.template_id, facts: row.facts_json },
        versionNo === null ? `Deshecho (vuelve a la versión ${row.version_no})` : `Restaurada la versión ${row.version_no}`
      );
    });
  } catch (error) {
    if (error instanceof ResumeVersionConflictError || error instanceof ResumeNothingToUndoError) throw error;
    rethrow(error);
  }
}

/** True when a resume was removed (its versions go with it, ON DELETE CASCADE). */
export async function deleteResume(userId: string, resumeId: string): Promise<boolean> {
  try {
    const result = await pool.query(`DELETE FROM rs_resumes WHERE id = $1 AND user_id = $2`, [resumeId, userId]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    rethrow(error);
  }
}

/**
 * «Borrar todo» (doc 07 rights; doc 09 T-DEL): removes every resume and
 * version of the user. Consent records stay — they are the proof of what
 * was authorized and when (insert-only by design).
 */
export async function deleteAllResumeData(userId: string): Promise<{ resumes: number }> {
  try {
    const result = await pool.query(`DELETE FROM rs_resumes WHERE user_id = $1`, [userId]);
    // Versions cascade with their resume; this also clears any orphan.
    await pool.query(`DELETE FROM rs_resume_versions WHERE user_id = $1`, [userId]);
    return { resumes: result.rowCount ?? 0 };
  } catch (error) {
    rethrow(error);
  }
}

export interface ResumeExport {
  exportedAt: string;
  policyVersion: string;
  resumes: (Resume & { versions: (ResumeVersionSummary & { facts: ResumeFacts })[] })[];
  consents: { purpose: string; policyVersion: string; granted: boolean; createdAt: string }[];
}

/** Everything stored about this user in the module (derecho de acceso). */
export async function exportResumeData(userId: string): Promise<ResumeExport> {
  try {
    const resumes = await pool.query<ResumeRow>(
      `SELECT id, title, template_id, version_no, created_at, updated_at, facts_json
       FROM rs_resumes WHERE user_id = $1 ORDER BY created_at`,
      [userId]
    );
    const versions = await pool.query<{
      resume_id: string;
      version_no: number;
      title: string;
      template_id: ResumeTemplateId;
      facts_json: ResumeFacts;
      change_summary: string;
      created_by: string;
      created_at: Date | string;
    }>(
      `SELECT resume_id, version_no, title, template_id, facts_json, change_summary, created_by, created_at
       FROM rs_resume_versions WHERE user_id = $1 ORDER BY resume_id, version_no`,
      [userId]
    );
    const consents = await pool.query<{ purpose: string; policy_version: string; granted: boolean; created_at: Date | string }>(
      `SELECT purpose, policy_version, granted, created_at FROM rs_consents WHERE user_id = $1 ORDER BY created_at, id`,
      [userId]
    );
    return {
      exportedAt: new Date().toISOString(),
      policyVersion: RESUME_POLICY_VERSION,
      resumes: resumes.rows.map((row) => ({
        ...toResume(row),
        versions: versions.rows
          .filter((v) => v.resume_id === row.id)
          .map((v) => ({
            versionNo: v.version_no,
            title: v.title,
            templateId: v.template_id,
            changeSummary: v.change_summary,
            createdBy: v.created_by,
            createdAt: iso(v.created_at),
            facts: v.facts_json
          }))
      })),
      consents: consents.rows.map((c) => ({
        purpose: c.purpose,
        policyVersion: c.policy_version,
        granted: c.granted,
        createdAt: iso(c.created_at)
      }))
    };
  } catch (error) {
    rethrow(error);
  }
}
