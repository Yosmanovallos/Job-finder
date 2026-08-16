/**
 * Migration: functional index backing getJobs()/getJobsLight()'s DISTINCT ON
 * dedupe (egress incident follow-up, 2026-08-15 — see job-repository.ts's
 * getJobsLight() comment). Without this, Postgres does a full scan + sort of
 * the whole `jobs` table on every cache-miss call (measured 500ms-2s against
 * the real corpus, per the pre-existing comment on jobsCache). This index
 * exactly matches that query's GROUP/ORDER expressions so the planner can
 * use it instead of a full sort. Additive only (CREATE INDEX IF NOT EXISTS),
 * no rows touched.
 *
 * Run once:
 *   cd job-radar-apify && npx tsx scripts/migrate-jobs-dedupe-index.ts
 *
 * Safe to re-run — IF NOT EXISTS makes it a no-op after the first success.
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";

dotenv.config();

async function main() {
  console.log("🔧 [migrate-jobs-dedupe-index] Starting migration...\n");

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_jobs_dedupe_active
     ON jobs (
       lower(trim(title)),
       lower(trim(COALESCE(company, 'confidencial'))),
       lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))),
       published_at DESC,
       id DESC
     )
     WHERE is_active = TRUE`
  );
  console.log("   ✅ Index idx_jobs_dedupe_active ready.\n");

  const count = await pool.query(`SELECT COUNT(*) AS total FROM jobs WHERE is_active = TRUE`);
  console.log(`📊 jobs currently has ${count.rows[0].total} active row(s).\n`);

  await pool.end();
}

main().catch((err) => {
  console.error("❌ [migrate-jobs-dedupe-index] Failed:", err);
  process.exit(1);
});
