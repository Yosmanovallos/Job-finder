/** Restores state created by backup-job-seo-v2-state.ts; requires explicit --apply. */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db/client.js";
import { requireAbsoluteSnapshotPath } from "../src/db/job-seo-v2-state.js";
dotenv.config();
const source = process.argv.find((arg) => arg.startsWith("--from="))?.slice(7);
const APPLY = process.argv.includes("--apply");
if (!source) throw new Error("Use --from=<absolute-backup-json-path>.");
type Backup = { version: number; jobs: Array<Record<string, unknown>>; pendingQueue: Array<Record<string, unknown>> };
async function main() {
  const backup = JSON.parse(await readFile(requireAbsoluteSnapshotPath(source), "utf8")) as Backup;
  if (backup.version !== 1 || !Array.isArray(backup.jobs) || !Array.isArray(backup.pendingQueue)) throw new Error("Invalid Job SEO V2 backup.");
  console.log(`[job-seo-v2:restore] ${APPLY ? "APPLY" : "DRY-RUN"}; jobs=${backup.jobs.length}, queue=${backup.pendingQueue.length}`);
  if (!APPLY) return;
  for (let offset = 0; offset < backup.jobs.length; offset += 500) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of backup.jobs.slice(offset, offset + 500)) await client.query(
        `UPDATE jobs SET is_active=$2, title=$3, company=$4, location=$5, country=$6, url=$7, source=$8, published_at=$9,
           employment_type=$10, salary_raw=$11, salary_min=$12, salary_max=$13, salary_currency=$14,
           description_source=$15, description_kind=$16, remote_type=$17, applicant_countries=$18::jsonb, valid_through=$19,
           detail_status=$20, detail_last_error=$21, seo_ready=$22, seo_reasons=$23::jsonb, seo_evaluated_at=$24,
           seo_ready_at=$25, content_hash=$26, content_updated_at=$27 WHERE id=$1`,
        [row.id, row.is_active, row.title, row.company, row.location, row.country, row.url, row.source, row.published_at,
          row.employment_type, row.salary_raw, row.salary_min, row.salary_max, row.salary_currency,
          row.description_source, row.description_kind, row.remote_type, JSON.stringify(row.applicant_countries ?? null), row.valid_through,
          row.detail_status, row.detail_last_error, row.seo_ready, JSON.stringify(row.seo_reasons ?? []), row.seo_evaluated_at,
          row.seo_ready_at, row.content_hash, row.content_updated_at]
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }
  for (let offset = 0; offset < backup.pendingQueue.length; offset += 500) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of backup.pendingQueue.slice(offset, offset + 500)) await client.query(
        `UPDATE indexing_queue SET status=$2, priority=$3, job_id=$4, content_hash=$5, superseded_at=$6, superseded_reason=$7 WHERE id=$1`,
        [row.id, row.status, row.priority, row.job_id, row.content_hash, row.superseded_at, row.superseded_reason]
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }
  await pool.end();
}
main().catch(async (error) => { console.error("[job-seo-v2:restore]", error instanceof Error ? error.message : "failed"); await pool.end().catch(() => undefined); process.exit(1); });
