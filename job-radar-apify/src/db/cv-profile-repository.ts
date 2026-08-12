import { pool } from "./client.js";
import { CvFactsSchema, type CvFacts } from "../cv/cv-facts-schema.js";

/**
 * `cv_profiles` access (docs/CV-GENERATION-PLAN.md §3.1/§9.3, Fase 0/2a).
 * `facts_json` stays NULL until Etapa A (Fase 2b) runs against a real
 * model — Fase 2a only handles Etapa 0 (upload → extract → store raw
 * text). Never returns `raw_text`/`facts_json` content to a caller that
 * doesn't need it — §8.2 forbids CV content in logs, and the same
 * discipline applies to any response payload that isn't the editor itself.
 */

export interface CvProfileStatus {
  exists: boolean;
  hasFacts: boolean;
  updatedAt: string | null;
}

/** Upsert keyed by `user_id` — a new upload always replaces the previous
 * one (`UNIQUE (user_id)`), never accumulates versions. Replacing the raw
 * text invalidates any previously extracted facts, so `facts_json` is
 * explicitly reset to NULL here — Fase 2b's Etapa A must run again. */
export async function upsertCvProfileRawText(userId: string, rawText: string): Promise<void> {
  await pool.query(
    `INSERT INTO cv_profiles (user_id, raw_text, facts_json, updated_at)
     VALUES ($1, $2, NULL, NOW())
     ON CONFLICT (user_id) DO UPDATE SET raw_text = EXCLUDED.raw_text, facts_json = NULL, updated_at = NOW()`,
    [userId, rawText]
  );
}

/** Fills in `facts_json` after Etapa A (Fase 2b) runs. Guarded by
 * `raw_text = $3`: if the user replaces their CV while a previous
 * extraction is still in flight, `upsertCvProfileRawText` already reset
 * `facts_json` to NULL for the new text — this WHERE clause stops the
 * stale extraction from overwriting that with facts for text that no
 * longer exists. Returns whether the row was actually updated. */
export async function updateCvProfileFacts(
  userId: string,
  rawTextSnapshot: string,
  facts: unknown
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE cv_profiles SET facts_json = $3, updated_at = NOW() WHERE user_id = $1 AND raw_text = $2`,
    [userId, rawTextSnapshot, JSON.stringify(facts)]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getCvProfileStatus(userId: string): Promise<CvProfileStatus> {
  const { rows } = await pool.query<{ facts_json: unknown; raw_text: string | null; updated_at: string }>(
    `SELECT facts_json, raw_text, updated_at FROM cv_profiles WHERE user_id = $1`,
    [userId]
  );
  if (rows.length === 0) {
    return { exists: false, hasFacts: false, updatedAt: null };
  }
  // `raw_text` also required, not just `facts_json !== null`: the Fase 9
  // retention job (docs/CV-GENERATION-PLAN.md §8.3) clears `raw_text`
  // after 30 days of grace past `subscription_end` but deliberately keeps
  // `facts_json` (the plan allows it, for possible future anonymized
  // analytics). A user who renews without re-uploading would otherwise
  // see "CV listo" here for facts extracted from a CV the retention
  // policy already deleted — `getCvFacts` below enforces the same rule
  // for real generation, this just keeps the status display honest with it.
  const hasFacts = rows[0]!.facts_json !== null && rows[0]!.raw_text !== null;
  return { exists: true, hasFacts, updatedAt: rows[0]!.updated_at };
}

/** `CvFacts` for the pipeline/renderer (Fase 7) — schema-parsed, never
 * cast: `facts_json` is app-controlled JSONB, but §3.3's whole premise is
 * that every downstream stage only trusts what's actually shaped like a
 * fact, so this returns `null` (not a throw) on a NULL/absent/malformed
 * row and lets the caller decide the right HTTP status.
 *
 * Also requires `raw_text IS NOT NULL` — the real enforcement point for
 * the Fase 9 retention rule (§8.3): `cleanupExpiredCvData` clears
 * `raw_text` but keeps `facts_json` on purpose (§8.3 allows it for
 * possible future anonymized analytics). Without this check, a user who
 * renews Pro after the 30-day grace window without re-uploading would get
 * a REAL generation/PDF/DOCX built from facts extracted from a CV the
 * retention policy already deleted. Every caller (`POST /api/cv/generate`,
 * `.../regenerate`, `GET .../pdf`/`.../docx`) already has a `if (!facts)`
 * → 409 branch for the "never uploaded" case — this reuses that same,
 * already-correct path instead of adding a new one. */
export async function getCvFacts(userId: string): Promise<CvFacts | null> {
  const { rows } = await pool.query<{ facts_json: unknown; raw_text: string | null }>(
    `SELECT facts_json, raw_text FROM cv_profiles WHERE user_id = $1`,
    [userId]
  );
  if (rows.length === 0 || rows[0]!.facts_json === null || rows[0]!.raw_text === null) {
    return null;
  }
  const parsed = CvFactsSchema.safeParse(rows[0]!.facts_json);
  return parsed.success ? parsed.data : null;
}

/** Returns true if a row was actually deleted (idempotent either way). */
export async function deleteCvProfile(userId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM cv_profiles WHERE user_id = $1`, [userId]);
  return (result.rowCount ?? 0) > 0;
}
