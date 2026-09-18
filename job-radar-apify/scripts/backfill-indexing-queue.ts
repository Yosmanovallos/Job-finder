/**
 * Hourly reconciliation (indexing-tick.yml), rewritten for Job SEO V2.
 *
 * Before: enqueued URL_UPDATED for EVERY describable active job with no queue
 * history — which would have undone any publication gate within an hour
 * (docs/JOB-SEO-ARCHITECTURE-V2.md, finding F8).
 *
 * Now, two bounded self-heal steps, both through the shared Google gate:
 *  1. Rows from the new pipeline that were saved but never evaluated (a crash
 *     between INSERT and refreshGoogleReadiness) are evaluated now.
 *  2. Google-ready rows whose CURRENT content was never notified (no pending
 *     or sent URL_UPDATED carrying their content_hash) get one URL_UPDATED in
 *     the lowest send lane. Non-ready rows are never enqueued.
 *
 * Only writes jobs' readiness columns (via the evaluator) and indexing_queue.
 * Safe to re-run: step 2 is idempotent by (job, content_hash).
 *
 * Manual run:
 *   cd job-radar-apify && npx tsx scripts/backfill-indexing-queue.ts [--dry-run]
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { refreshGoogleReadiness } from "../src/db/job-readiness-repository.js";
import { enqueueIndexingNotifications, INDEXING_PRIORITY } from "../src/db/indexing-repository.js";
import { buildJobUrl } from "../src/lib/job-seo.js";
import { seoReadySql } from "../src/lib/google-job-readiness.js";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry-run");
/** Per run. At 200 sends/day the lowest lane never needs more than this per hour. */
const RECONCILE_EVALUATE_LIMIT = 500;
const RECONCILE_ENQUEUE_LIMIT = 200;

async function main() {
  // 0. Time passes without a write event (a source validThrough expires, a
  //    job is purged): pending URL_UPDATED rows whose target is no longer an
  //    active Google-ready job are superseded now, not only at send time.
  const staleSql = `
    FROM indexing_queue q
    LEFT JOIN jobs j ON j.id = q.job_id
    WHERE q.status = 'pending' AND q.notification_type = 'URL_UPDATED' AND q.job_id IS NOT NULL
      AND (j.id IS NULL OR NOT ${seoReadySql("j")})`;
  if (DRY_RUN) {
    const stale = await pool.query(`SELECT COUNT(*) AS n ${staleSql}`);
    console.log(`🔧 [reconcile] ${stale.rows[0].n} URL_UPDATED pendientes cuyo destino ya no es apto (dry-run).`);
  } else {
    const superseded = await pool.query(
      `UPDATE indexing_queue u
       SET status = 'superseded', superseded_at = NOW(),
           superseded_reason = CASE WHEN stale.job_exists THEN 'target_not_seo_ready' ELSE 'target_missing' END
       FROM (SELECT q.id, j.id IS NOT NULL AS job_exists ${staleSql}) stale
       WHERE u.id = stale.id AND u.status = 'pending'`
    );
    console.log(`🔧 [reconcile] ${superseded.rowCount ?? 0} URL_UPDATED pendientes superseded (destino ya no apto).`);
  }

  const unevaluated = await pool.query<{ id: string }>(
    `SELECT id FROM jobs
     WHERE is_active = TRUE AND detail_status IS NOT NULL AND seo_evaluated_at IS NULL
     ORDER BY created_at DESC LIMIT $1`,
    [RECONCILE_EVALUATE_LIMIT]
  );
  let evaluated = 0;
  if (!DRY_RUN) {
    for (const row of unevaluated.rows) {
      await refreshGoogleReadiness(row.id);
      evaluated++;
    }
  }
  console.log(
    `🔧 [reconcile] ${unevaluated.rows.length} fila(s) nuevas sin evaluar${DRY_RUN ? " (dry-run, sin escribir)" : ` → ${evaluated} evaluadas`}.`
  );

  const missing = await pool.query<{ id: string; title: string; location: string | null; content_hash: string | null }>(
    `SELECT j.id, j.title, j.location, j.content_hash
     FROM jobs j
     WHERE ${seoReadySql("j")}
       AND NOT EXISTS (
         SELECT 1 FROM indexing_queue q
         WHERE q.notification_type = 'URL_UPDATED'
           AND q.status IN ('pending', 'sent')
           AND q.job_id = j.id
           AND q.content_hash IS NOT DISTINCT FROM j.content_hash
       )
     ORDER BY j.published_at DESC, j.id DESC
     LIMIT $1`,
    [RECONCILE_ENQUEUE_LIMIT]
  );
  if (!DRY_RUN && missing.rows.length > 0) {
    await enqueueIndexingNotifications(
      missing.rows.map((row) => ({
        url: buildJobUrl({ jobId: row.id, title: row.title, location: row.location }),
        type: "URL_UPDATED" as const,
        priority: INDEXING_PRIORITY.reconcile,
        jobId: row.id,
        contentHash: row.content_hash
      }))
    );
  }
  console.log(
    `✅ [reconcile] ${missing.rows.length} vacante(s) aptas para Google sin notificación de su contenido actual${DRY_RUN ? " (dry-run)" : " → encoladas en prioridad 4"}.`
  );
  await pool.end();
}

main().catch((err) => {
  console.error("❌ [reconcile] Failed:", err instanceof Error ? err.name : "Error");
  process.exit(1);
});
