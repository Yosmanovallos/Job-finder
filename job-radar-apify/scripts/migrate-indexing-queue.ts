/**
 * Migration: create the `indexing_queue` table (SEO Fase 3 — Google
 * Indexing API). Additive only, no existing data touched.
 *
 * Run once:
 *   cd job-radar-apify && npx tsx scripts/migrate-indexing-queue.ts
 *
 * Safe to re-run — every step is idempotent (IF NOT EXISTS).
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";

dotenv.config();

async function main() {
  console.log("🔧 [migrate-indexing-queue] Starting migration...\n");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS indexing_queue (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        url                TEXT NOT NULL,
        notification_type  VARCHAR(20) NOT NULL,
        status             VARCHAR(20) DEFAULT 'pending',
        error              TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at            TIMESTAMPTZ
    )
  `);
  console.log("   ✅ Table indexing_queue ready.");

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_indexing_queue_status ON indexing_queue (status) WHERE status = 'pending'`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_indexing_queue_sent_at ON indexing_queue (sent_at) WHERE status = 'sent'`
  );
  // SEO Fase 5 (docs/SEO-PLAN.md §5.6): text_pattern_ops is what lets a
  // `LIKE 'prefix%'` lookup (wasJobPurged() in indexing-repository.ts) use
  // this index instead of a full table scan — a plain btree index doesn't
  // support LIKE-prefix matching in the default locale.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_indexing_queue_url_prefix ON indexing_queue (url text_pattern_ops)`
  );
  console.log("   ✅ Indexes ready.");

  await pool.query(`ALTER TABLE indexing_queue ENABLE ROW LEVEL SECURITY`);
  console.log("   ✅ RLS enabled (zero policies — same pattern as every other table here).\n");

  const count = await pool.query(`SELECT COUNT(*) AS total FROM indexing_queue`);
  console.log(`📊 indexing_queue currently has ${count.rows[0].total} row(s).\n`);

  await pool.end();
}

main().catch((err) => {
  console.error("❌ [migrate-indexing-queue] Failed:", err);
  process.exit(1);
});
