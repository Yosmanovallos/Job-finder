import { pool } from "./client.js";

/**
 * Retention cleanup job (docs/CV-GENERATION-PLAN.md §8.3, Fase 9). Rule:
 * while Pro is active, or within 30 days of grace after `subscription_end`
 * passes without renewal, the full CV is kept (raw text + `CvDocument`s).
 * Past that grace window: `cv_profiles.raw_text` and both
 * `cv_generations.generated_document_json`/`document_json` are cleared.
 *
 * Deliberately NOT cleared, per §8.3's explicit text: `cv_profiles.facts_json`
 * (the plan allows keeping `CvFacts` for possible future anonymized
 * analytics — building that anonymization is "a decisión de producto
 * aparte, no parte de este plan", so this job doesn't touch it) and the
 * rest of each `cv_generations` row (job_title/company/status/model_option/
 * credits_charged — audit/quota history, not CV content).
 *
 * Reads `subscription_end` directly rather than `subscription_tier`:
 * `subscription_tier` stays `'pro'` in the DB forever once set (the
 * "free" fallback is computed on read, see `effectiveTier` in
 * `job-repository.ts`) — `subscription_end` is the only real signal of
 * when a subscription actually lapsed.
 */

const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface RetentionCleanupResult {
  profilesCleared: number;
  generationsCleared: number;
}

/** AGENTS.md regla 10: toda operación externa de escritura soporta
 * `--dry-run`. Esta escribe destructivamente sobre la única base real
 * que existe, corriendo además desde un cron diario sin supervisión
 * humana por invocación — `dryRun: true` corre los mismos predicados
 * WHERE como `SELECT` en vez de `UPDATE`, mismos conteos, cero
 * escritura. */
export async function cleanupExpiredCvData(
  now: () => Date = () => new Date(),
  dryRun = false
): Promise<RetentionCleanupResult> {
  const cutoff = new Date(now().getTime() - GRACE_PERIOD_MS);

  const profiles = await pool.query(
    dryRun
      ? `SELECT cv_profiles.id
         FROM cv_profiles
         JOIN users ON cv_profiles.user_id = users.id
         WHERE users.subscription_end IS NOT NULL
           AND users.subscription_end < $1
           AND cv_profiles.raw_text IS NOT NULL`
      : `UPDATE cv_profiles
         SET raw_text = NULL, updated_at = NOW()
         FROM users
         WHERE cv_profiles.user_id = users.id
           AND users.subscription_end IS NOT NULL
           AND users.subscription_end < $1
           AND cv_profiles.raw_text IS NOT NULL
         RETURNING cv_profiles.id`,
    [cutoff]
  );

  const generations = await pool.query(
    dryRun
      ? `SELECT cv_generations.id
         FROM cv_generations
         JOIN users ON cv_generations.user_id = users.id
         WHERE users.subscription_end IS NOT NULL
           AND users.subscription_end < $1
           AND (cv_generations.generated_document_json IS NOT NULL OR cv_generations.document_json IS NOT NULL)`
      : `UPDATE cv_generations
         SET generated_document_json = NULL, document_json = NULL, updated_at = NOW()
         FROM users
         WHERE cv_generations.user_id = users.id
           AND users.subscription_end IS NOT NULL
           AND users.subscription_end < $1
           AND (cv_generations.generated_document_json IS NOT NULL OR cv_generations.document_json IS NOT NULL)
         RETURNING cv_generations.id`,
    [cutoff]
  );

  return { profilesCleared: profiles.rowCount ?? 0, generationsCleared: generations.rowCount ?? 0 };
}
