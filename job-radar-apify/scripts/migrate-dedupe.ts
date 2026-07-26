/**
 * Migration: Add content_fingerprint column + clean up existing duplicates.
 *
 * Run once after deploying the dedup changes:
 *   cd job-radar-apify && npx tsx scripts/migrate-dedupe.ts
 *
 * Safe to re-run — every step is idempotent.
 */
import dotenv from "dotenv";
import crypto from "crypto";
import { pool } from "../src/db/client.js";

dotenv.config();

function computeContentFingerprint(title: string, company: string, location: string): string {
  const normalized = [
    title.toLowerCase().trim(),
    (company || "confidencial").toLowerCase().trim(),
    (location || "colombia").toLowerCase().trim()
  ].join("|");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

async function main() {
  console.log("🔧 [migrate-dedupe] Starting migration...\n");

  // ─── Step 1: Add content_fingerprint column if missing ──────────────
  console.log("📌 Step 1: Adding content_fingerprint column...");
  await pool.query(`
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_fingerprint VARCHAR(64)
  `);
  console.log("   ✅ Column added (or already existed).\n");

  // ─── Step 2: Count current duplicates ────────────────────────────────
  const beforeCount = await pool.query(`SELECT COUNT(*) AS total FROM jobs WHERE is_active = TRUE`);
  console.log(`📊 Step 2: Total active jobs BEFORE cleanup: ${beforeCount.rows[0].total}`);

  const dupePreview = await pool.query(`
    SELECT lower(trim(title)) AS t, lower(trim(COALESCE(company, 'confidencial'))) AS c,
           lower(trim(COALESCE(location, 'colombia'))) AS l, COUNT(*) AS copies
    FROM jobs
    WHERE is_active = TRUE
    GROUP BY t, c, l
    HAVING COUNT(*) > 1
    ORDER BY copies DESC
    LIMIT 20
  `);

  if (dupePreview.rows.length > 0) {
    console.log(`   🔴 Found ${dupePreview.rows.length}+ groups of duplicates. Top offenders:`);
    for (const row of dupePreview.rows) {
      console.log(`      "${row.t}" @ "${row.c}" (${row.l}) — ${row.copies} copies`);
    }
  } else {
    console.log("   ✅ No duplicates found! Nothing to clean.");
  }
  console.log();

  // ─── Step 3: Deactivate duplicate rows ──────────────────────────────
  console.log("🧹 Step 3: Deactivating duplicate rows (keeping the oldest per group)...");
  const deactivated = await pool.query(`
    UPDATE jobs SET is_active = FALSE
    WHERE is_active = TRUE
      AND id NOT IN (
        SELECT DISTINCT ON (lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, 'colombia'))))
          id
        FROM jobs
        WHERE is_active = TRUE
        ORDER BY lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, 'colombia'))), published_at ASC
      )
  `);
  console.log(`   ✅ Deactivated ${deactivated.rowCount} duplicate rows.\n`);

  // ─── Step 4: Backfill content_fingerprint on remaining active rows ──
  console.log("🔑 Step 4: Backfilling content_fingerprint on active rows...");
  const activeJobs = await pool.query(`
    SELECT id, title, company, location FROM jobs
    WHERE is_active = TRUE AND content_fingerprint IS NULL
  `);

  let backfilled = 0;
  for (const row of activeJobs.rows) {
    const fp = computeContentFingerprint(row.title, row.company, row.location);
    await pool.query(`UPDATE jobs SET content_fingerprint = $1 WHERE id = $2`, [fp, row.id]);
    backfilled++;
  }
  console.log(`   ✅ Backfilled ${backfilled} rows.\n`);

  // ─── Step 5: Create unique index ────────────────────────────────────
  console.log("📇 Step 5: Creating unique index on content_fingerprint...");
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_content_fingerprint
        ON jobs (content_fingerprint) WHERE content_fingerprint IS NOT NULL AND is_active = TRUE
    `);
    console.log("   ✅ Index created.\n");
  } catch (err: any) {
    // If there are still fingerprint collisions among active rows (shouldn't
    // happen after Step 3, but just in case), fall back to a non-unique index
    console.warn(`   ⚠️ Unique index failed (${err.message}). Creating non-unique index instead...`);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_content_fingerprint
        ON jobs (content_fingerprint) WHERE content_fingerprint IS NOT NULL
    `);
    console.log("   ✅ Non-unique index created.\n");
  }

  // ─── Step 6: Final count ─────────────────────────────────────────────
  const afterCount = await pool.query(`SELECT COUNT(*) AS total FROM jobs WHERE is_active = TRUE`);
  const removed = Number(beforeCount.rows[0].total) - Number(afterCount.rows[0].total);
  console.log("═══════════════════════════════════════════════════");
  console.log(`📊 RESULTADO FINAL:`);
  console.log(`   Antes:     ${beforeCount.rows[0].total} ofertas activas`);
  console.log(`   Después:   ${afterCount.rows[0].total} ofertas activas`);
  console.log(`   Eliminadas: ${removed} duplicados`);
  console.log("═══════════════════════════════════════════════════\n");

  await pool.end();
}

main().catch(async (err) => {
  console.error("❌ [migrate-dedupe] Error:", err?.message || err);
  await pool.end();
  process.exit(1);
});
