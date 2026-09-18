/** Additive Job SEO V2 schema migration. Default is a read-only preflight. */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";

dotenv.config();
const APPLY = process.argv.includes("--apply");

const statements = [
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS detail_status VARCHAR(20)",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS detail_attempts SMALLINT NOT NULL DEFAULT 0",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS detail_next_attempt_at TIMESTAMPTZ",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS detail_last_error VARCHAR(100)",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description_fetched_at TIMESTAMPTZ",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description_source VARCHAR(20)",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description_kind VARCHAR(20)",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS remote_type VARCHAR(20)",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS applicant_countries JSONB",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS valid_through TIMESTAMPTZ",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS seo_ready BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS seo_reasons JSONB NOT NULL DEFAULT '[]'::jsonb",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS seo_evaluated_at TIMESTAMPTZ",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS seo_ready_at TIMESTAMPTZ",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)",
  "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_updated_at TIMESTAMPTZ",
  "ALTER TABLE indexing_queue ADD COLUMN IF NOT EXISTS job_id UUID",
  "ALTER TABLE indexing_queue ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 5",
  "ALTER TABLE indexing_queue ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)",
  "ALTER TABLE indexing_queue ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ",
  "ALTER TABLE indexing_queue ADD COLUMN IF NOT EXISTS superseded_reason VARCHAR(40)",
  "CREATE INDEX IF NOT EXISTS idx_jobs_detail_due ON jobs (detail_next_attempt_at) WHERE detail_status IN ('pending', 'retry')",
  "CREATE INDEX IF NOT EXISTS idx_jobs_seo_ready ON jobs (published_at DESC, id DESC) WHERE seo_ready = TRUE AND is_active = TRUE",
  "CREATE INDEX IF NOT EXISTS idx_indexing_queue_send_order ON indexing_queue (priority, created_at) WHERE status = 'pending'",
  "CREATE INDEX IF NOT EXISTS idx_indexing_queue_job ON indexing_queue (job_id) WHERE job_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_indexing_queue_url_type ON indexing_queue (url, notification_type)"
];

async function main() {
  const tables = await pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('jobs', 'indexing_queue')");
  if (tables.rows.length !== 2) throw new Error("jobs and indexing_queue must exist before Job SEO V2 migration.");
  console.log(`[job-seo-v2:migrate] ${APPLY ? "APPLY" : "DRY-RUN"}; ${statements.length} additive statements; queue uniqueness is intentionally a later phase.`);
  if (APPLY) for (const statement of statements) await pool.query(statement);
  const verify = await pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs' AND column_name IN ('seo_ready','seo_reasons','content_hash','valid_through','remote_type') ORDER BY column_name");
  console.table(verify.rows);
  if (APPLY && verify.rows.length !== 5) throw new Error("Post-migration verification failed; do not continue to classification.");
  await pool.end();
}
main().catch(async (error) => { console.error("[job-seo-v2:migrate]", error instanceof Error ? error.message : "failed"); await pool.end().catch(() => undefined); process.exit(1); });
