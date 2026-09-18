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
import { mutateReadinessRelevantJobs } from "../src/db/job-readiness-repository.js";

dotenv.config();
const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 500;

function computeContentFingerprint(title: string, company: string, location: string): string {
  const normalized = [
    title.toLowerCase().trim(),
    (company || "confidencial").toLowerCase().trim(),
    (location || "colombia").toLowerCase().trim()
  ].join("|");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

async function main() {
  console.log(`🔧 [migrate-dedupe] ${APPLY ? "APPLY" : "DRY-RUN (sin escrituras)"}...\n`);

  // ─── Step 1: Add content_fingerprint column if missing ──────────────
  console.log("📌 Step 1: Adding content_fingerprint column...");
  if (APPLY) await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_fingerprint VARCHAR(64)`);
  console.log(`   ${APPLY ? "✅ Column ready." : "📋 Column would be ensured."}\n`);

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
  const duplicateIds = await pool.query<{ id: string }>(`
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, 'colombia')))
        ORDER BY published_at ASC, id ASC
      ) AS duplicate_rank
      FROM jobs WHERE is_active = TRUE
    ) grouped WHERE duplicate_rank > 1 ORDER BY id
  `);
  let deactivated = 0;
  if (APPLY) {
    for (let offset = 0; offset < duplicateIds.rows.length; offset += BATCH_SIZE) {
      const outcomes = await mutateReadinessRelevantJobs(
        duplicateIds.rows.slice(offset, offset + BATCH_SIZE).map((row) => ({ id: row.id, patch: { is_active: false } }))
      );
      deactivated += outcomes.length;
    }
  }
  console.log(`   ${APPLY ? "✅ Deactivated" : "📋 Would deactivate"} ${APPLY ? deactivated : duplicateIds.rows.length} duplicate rows through the readiness mutation path.\n`);

  // ─── Step 4: Backfill content_fingerprint on remaining active rows ──
  console.log("🔑 Step 4: Backfilling content_fingerprint on active rows...");
  const activeJobs = await pool.query(`
    SELECT id, title, company, location FROM jobs
    WHERE is_active = TRUE AND content_fingerprint IS NULL
  `);

  let backfilled = 0;
  if (APPLY) {
    for (const row of activeJobs.rows) {
      const fp = computeContentFingerprint(row.title, row.company, row.location);
      await pool.query(`UPDATE jobs SET content_fingerprint = $1 WHERE id = $2`, [fp, row.id]);
      backfilled++;
    }
  }
  console.log(`   ✅ Backfilled ${backfilled} rows.\n`);

  // ─── Step 5: Create unique index ────────────────────────────────────
  console.log("📇 Step 5: Creating unique index on content_fingerprint...");
  if (APPLY) {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_content_fingerprint
      ON jobs (content_fingerprint) WHERE content_fingerprint IS NOT NULL AND is_active = TRUE`);
    console.log("   ✅ Index created.\n");
  } else {
    console.log("   📋 Index would be ensured after the duplicate check.\n");
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
