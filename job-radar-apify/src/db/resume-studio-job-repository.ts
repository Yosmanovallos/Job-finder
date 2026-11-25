import { pool } from "./client.js";
import { computeUrlHash, getJobById, getSupersedingTarget, maskLockedFields } from "./job-repository.js";
import { liveJobSql } from "../lib/job-freshness.js";
import { jobSnapshotSchema, type JobSnapshot, type SnapshotDraft } from "../resume-studio/job-link/job-snapshot.js";

// AI Resume Studio R2 — database side of the link resolver (doc 11 §5.3):
// our own vacancies (by id, by URL, by company + title) and the 24 h
// snapshot cache. Read-only on `jobs`. The cache holds only what a public
// page or our base shows to anyone — never a user's pasted text.

export const SNAPSHOT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function isMissingTable(error: unknown): boolean {
  return (error as { code?: string })?.code === "42P01";
}

/** A live vacancy of ours as a snapshot draft, with the same masking as the public page. */
export async function ourJobDraft(jobId: string): Promise<Partial<SnapshotDraft> | null> {
  let job = await getJobById(jobId);
  if (!job) {
    const superseded = await getSupersedingTarget(jobId);
    if (superseded?.target) job = await getJobById(superseded.target.jobId);
  }
  if (!job) return null;
  const [visible] = maskLockedFields([job], "free");
  const requirements = ((visible.requirements ?? []) as unknown[]).filter((line): line is string => typeof line === "string" && line.trim().length > 0);
  const description = [visible.description, requirements.length ? `Requisitos:\n${requirements.map((line: string) => `- ${line}`).join("\n")}` : null]
    .filter(Boolean)
    .join("\n\n");
  const remote = visible.remoteType === "fully_remote" ? "remote" : visible.remoteType === "hybrid" ? "hybrid" : visible.remoteType === "onsite" ? "onsite" : null;
  const iso = (value: unknown) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  };
  return {
    title: visible.title,
    company: visible.company ?? null,
    location: visible.location ?? null,
    remote,
    employmentType: visible.employmentType ?? null,
    description: description || undefined,
    datePosted: iso(visible.publishedAt),
    validThrough: iso(visible.validThrough),
    // Salary stays null: our label mixes units by source (job-repository
    // buildSalaryLabel) and a number without its unit would be invented.
    salary: null,
    applyUrl: typeof visible.url === "string" ? visible.url : null
  };
}

/** The id of a live vacancy we already stored under this exact source URL. */
export async function findJobIdByUrl(url: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM jobs j WHERE j.url_hash = $1 AND j.is_active = TRUE AND ${liveJobSql("j")} LIMIT 1`,
    [computeUrlHash(url)]
  );
  return result.rows[0]?.id ?? null;
}

/**
 * The same vacancy by company + title (doc 11 §5.3 step 4), only on an
 * exact match after trimming and case folding: a fuzzy match could hand the
 * user someone else's vacancy. Newest first. Our base already includes the
 * direct-ATS corpus, so no live ATS call is made.
 */
export async function findSameJob(company: string, title: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT j.id FROM jobs j
     WHERE j.is_active = TRUE AND ${liveJobSql("j")}
       AND lower(trim(j.title)) = lower(trim($2))
       AND lower(trim(COALESCE(j.company, ''))) = lower(trim($1))
     ORDER BY j.published_at DESC NULLS LAST, j.id
     LIMIT 1`,
    [company, title]
  );
  return result.rows[0]?.id ?? null;
}

export async function getCachedSnapshot(key: string, now = new Date()): Promise<JobSnapshot | null> {
  try {
    const result = await pool.query<{ snapshot_json: unknown }>(
      `SELECT snapshot_json FROM rs_job_snapshot_cache WHERE url_key = $1 AND expires_at > $2`,
      [key, now]
    );
    const parsed = jobSnapshotSchema.safeParse(result.rows[0]?.snapshot_json);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

export async function putCachedSnapshot(key: string, snapshot: JobSnapshot, now = new Date()): Promise<void> {
  if (snapshot.via === "pasted") throw new Error("pasted text never goes to the shared cache");
  try {
    await pool.query(
      `INSERT INTO rs_job_snapshot_cache (url_key, canonical_url, via, snapshot_json, fetched_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (url_key) DO UPDATE SET canonical_url = EXCLUDED.canonical_url, via = EXCLUDED.via,
         snapshot_json = EXCLUDED.snapshot_json, fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`,
      [key, snapshot.canonicalUrl ?? "", snapshot.via, JSON.stringify(snapshot), now, new Date(now.getTime() + SNAPSHOT_CACHE_TTL_MS)]
    );
    // Bounded housekeeping: a few expired rows per write, never a full scan.
    await pool.query(
      `DELETE FROM rs_job_snapshot_cache WHERE url_key IN (
         SELECT url_key FROM rs_job_snapshot_cache WHERE expires_at <= $1 ORDER BY expires_at LIMIT 50)`,
      [now]
    );
  } catch (error) {
    if (isMissingTable(error)) return;
    throw error;
  }
}
