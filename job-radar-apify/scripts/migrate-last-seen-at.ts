/**
 * Migration: add `jobs.last_seen_at` (SEO Fase 9 follow-up — see
 * docs/SEO-PLAN.md §9.2). Additive only, no existing rows deleted.
 *
 * `purgeOldJobs()` used to filter on `created_at`, which is set once and
 * never updated — a job that's still genuinely live got deleted and
 * reinserted with a brand-new id/URL every 30 days regardless. This column
 * gets bumped on every re-scrape (ON CONFLICT in saveJobs()) so purge can
 * tell "still live" from "actually gone."
 *
 * Backfill choice, made deliberately (not DEFAULT NOW() for existing rows):
 * every row currently in `jobs` is already within its original 30-day
 * `created_at` window (anything older was already purged by the existing
 * rule) — but some of those rows may not have been re-seen in days, i.e.
 * they're already stale, just not old enough yet. Backfilling
 * `last_seen_at = created_at` preserves each row's real remaining time
 * exactly as `purgeOldJobs()` would have computed it before this migration.
 * Backfilling `= NOW()` instead would silently grant every already-stale
 * row a fresh 30-day reprieve it hasn't earned. Only future re-scrapes
 * (via the ON CONFLICT hook) get credit for being seen again.
 *
 * Run once:
 *   cd job-radar-apify && npx tsx scripts/migrate-last-seen-at.ts
 *
 * Safe to re-run — every step is idempotent (IF NOT EXISTS / WHERE guard).
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";

dotenv.config();

async function main() {
  console.log("🔧 [migrate-last-seen-at] Starting migration...\n");

  await pool.query(
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  );
  console.log("   ✅ Column jobs.last_seen_at ready.");

  // Backfill only rows this migration itself just defaulted to NOW() —
  // detected as last_seen_at being within a few seconds of created_at AND
  // not equal to it (a fresh ADD COLUMN DEFAULT NOW() stamps every existing
  // row with the same timestamp, which will differ from each row's own
  // created_at). Re-running this after the first successful backfill is a
  // no-op because last_seen_at will already equal created_at.
  const backfill = await pool.query(
    `UPDATE jobs SET last_seen_at = created_at WHERE last_seen_at != created_at`
  );
  console.log(`   ✅ Backfilled last_seen_at = created_at for ${backfill.rowCount ?? 0} row(s).`);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_jobs_last_seen_at ON jobs (last_seen_at)`
  );
  console.log("   ✅ Index idx_jobs_last_seen_at ready.\n");

  const count = await pool.query(`SELECT COUNT(*) AS total FROM jobs`);
  console.log(`📊 jobs currently has ${count.rows[0].total} row(s).\n`);

  await pool.end();
}

main().catch((err) => {
  console.error("❌ [migrate-last-seen-at] Failed:", err);
  process.exit(1);
});
