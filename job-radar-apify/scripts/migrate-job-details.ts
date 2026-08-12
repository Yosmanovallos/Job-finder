/**
 * Migration: add the rich job-detail columns to `jobs` — description,
 * requirements, technologies, employment_type, salary_min/max/currency/raw,
 * applicant_count. Additive only, no existing rows touched/backfilled.
 *
 * Deliberately no backfill: these columns only get populated going forward,
 * by scrapers that actually carry this data in their source response
 * (saveJobs() only writes them on INSERT of a brand-new row, never on the
 * ON CONFLICT / fingerprint-merge update paths — see job-repository.ts).
 * A row scraped before this migration simply keeps every new column NULL
 * forever, which is the intended behavior, not a gap to fix later.
 *
 * Run once:
 *   cd job-radar-apify && npx tsx scripts/migrate-job-details.ts
 *
 * Safe to re-run — every statement is idempotent (ADD COLUMN IF NOT EXISTS).
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";

dotenv.config();

async function main() {
  console.log("🔧 [migrate-job-details] Starting migration...\n");

  const columns: Array<[string, string]> = [
    ["description", "TEXT"],
    ["requirements", "JSONB DEFAULT '[]'::jsonb"],
    ["technologies", "JSONB DEFAULT '[]'::jsonb"],
    ["employment_type", "VARCHAR(50)"],
    ["salary_min", "NUMERIC"],
    ["salary_max", "NUMERIC"],
    ["salary_currency", "VARCHAR(10)"],
    ["salary_raw", "VARCHAR(255)"],
    ["applicant_count", "INT"]
  ];

  for (const [name, type] of columns) {
    await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ${name} ${type}`);
    console.log(`   ✅ Column jobs.${name} ready.`);
  }

  const count = await pool.query(`SELECT COUNT(*) AS total FROM jobs`);
  console.log(`\n📊 jobs currently has ${count.rows[0].total} row(s) (all keep these columns NULL until re-scraped as new).\n`);

  await pool.end();
}

main().catch((err) => {
  console.error("❌ [migrate-job-details] Failed:", err);
  process.exit(1);
});
