/**
 * Job SEO V2 — one-time triage of the production indexing_queue backlog
 * (docs/JOB-SEO-ARCHITECTURE-V2.md F7: 76% of the daily quota was going to
 * URLs that no longer exist).
 *
 *   npx tsx scripts/cleanup-indexing-queue.ts                      # dry-run (default), read-only
 *   npx tsx scripts/cleanup-indexing-queue.ts --http-sample=20     # + a small real HTTP sample (max 50, 1 req/s)
 *   npx tsx scripts/cleanup-indexing-queue.ts --apply --snapshot-out=<absolute-path> # perform transitions
 *
 * State transitions (--apply), ALL from status 'pending', nothing deleted:
 *   pending → superseded  'duplicate'              a 2nd+ pending row for the same (url, type); the oldest is kept
 *   pending → superseded  'target_deleted'         URL_UPDATED whose job is gone AND whose URL has a pending URL_DELETED
 *   pending → superseded  'target_missing'         URL_UPDATED whose job no longer exists (NOT turned into a DELETE:
 *                                                  a deletion is only ever recorded by purgeOldJobs(), which knows
 *                                                  the page really existed and was removed)
 *   pending → superseded  'target_non_canonical'   URL_UPDATED for a non-canonical duplicate
 *   pending → superseded  'target_not_seo_ready'   URL_UPDATED for a job that fails the shared Google gate
 *   pending → superseded  'url_changed'            URL_UPDATED for an outdated slug of a live job
 *   pending → superseded  'target_still_exists'    URL_DELETED whose job is active again
 *   pending (kept)        URL_UPDATED for a Google-ready canonical job at its current URL → priority 4, job_id + content_hash filled
 *   pending (kept)        URL_DELETED, legitimately removed → priority 1 if Google was ever told about the URL
 *                         (a sent URL_UPDATED exists), otherwise priority 4
 * The separately reviewed finalize-job-seo-v2-queue-index.ts command creates
 * uq_indexing_queue_pending_url_type only after this cleanup proves it safe.
 *
 * Refuses --apply while legacy jobs are unclassified (run classify-job-readiness.ts --apply first):
 * otherwise every URL_UPDATED would be judged against an empty readiness state.
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { canonicalSql, seoReadySql } from "../src/lib/google-job-readiness.js";
import { buildJobUrl } from "../src/lib/job-seo.js";
import { requireAbsoluteSnapshotPath, writeJobSeoV2StateSnapshot } from "../src/db/job-seo-v2-state.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const sampleArg = process.argv.find((a) => a.startsWith("--http-sample="));
const HTTP_SAMPLE = sampleArg ? Math.min(Math.max(Number(sampleArg.split("=")[1]) || 0, 0), 50) : 0;
const SNAPSHOT_OUT = process.argv.find((a) => a.startsWith("--snapshot-out="))?.slice("--snapshot-out=".length);

// One classification of every pending row, shared by the report and the apply.
const CLASSIFIED = `
WITH pending AS (
  SELECT q.id, q.url, q.notification_type, q.created_at,
         substring(q.url FROM '/empleos/([0-9a-fA-F-]{36})/')::uuid AS target_id,
         ROW_NUMBER() OVER (PARTITION BY q.url, q.notification_type ORDER BY q.created_at, q.id) AS dup_rank
  FROM indexing_queue q
  WHERE q.status = 'pending'
),
enriched AS (
  SELECT p.*,
         j.id IS NOT NULL AS target_exists,
         COALESCE(${seoReadySql("j")}, FALSE) AS target_ready,
         COALESCE(${canonicalSql("j")}, FALSE) AS target_canonical,
         j.title, j.location, j.content_hash,
         EXISTS (SELECT 1 FROM indexing_queue d
                 WHERE d.url = p.url AND d.notification_type = 'URL_DELETED') AS has_deleted,
         EXISTS (SELECT 1 FROM indexing_queue d
                 WHERE d.url = p.url AND d.notification_type = 'URL_DELETED' AND d.status = 'pending') AS has_pending_deleted,
         EXISTS (SELECT 1 FROM indexing_queue s
                 WHERE s.url = p.url AND s.notification_type = 'URL_UPDATED' AND s.status = 'sent') AS was_notified
  FROM pending p
  LEFT JOIN jobs j ON j.id = p.target_id AND j.is_active = TRUE
)
SELECT e.*,
  CASE
    WHEN e.dup_rank > 1 THEN 'duplicate'
    WHEN e.notification_type = 'URL_UPDATED' AND e.has_pending_deleted AND NOT e.target_exists THEN 'target_deleted'
    WHEN e.notification_type = 'URL_UPDATED' AND NOT e.target_exists THEN 'target_missing'
    WHEN e.notification_type = 'URL_UPDATED' AND NOT e.target_canonical THEN 'target_non_canonical'
    WHEN e.notification_type = 'URL_UPDATED' AND NOT e.target_ready THEN 'target_not_seo_ready'
    WHEN e.notification_type = 'URL_DELETED' AND e.target_exists THEN 'target_still_exists'
    ELSE NULL
  END AS supersede_reason
FROM enriched e`;

async function report() {
  const result = await pool.query(
    `SELECT
       COUNT(*) AS pending_total,
       COUNT(*) FILTER (WHERE notification_type = 'URL_UPDATED') AS pending_updated,
       COUNT(*) FILTER (WHERE notification_type = 'URL_DELETED') AS pending_deleted,
       COUNT(*) FILTER (WHERE notification_type = 'URL_UPDATED' AND target_exists) AS updated_target_exists,
       COUNT(*) FILTER (WHERE notification_type = 'URL_UPDATED' AND NOT target_exists AND NOT has_deleted) AS updated_target_404,
       COUNT(*) FILTER (WHERE notification_type = 'URL_UPDATED' AND NOT target_exists AND has_deleted) AS updated_target_410,
       COUNT(*) FILTER (WHERE notification_type = 'URL_UPDATED' AND target_ready) AS updated_target_seo_ready,
       COUNT(*) FILTER (WHERE notification_type = 'URL_UPDATED' AND target_exists AND NOT target_ready) AS updated_target_not_seo_ready,
       COUNT(*) FILTER (WHERE notification_type = 'URL_UPDATED' AND target_exists AND NOT target_canonical) AS updated_target_non_canonical,
       COUNT(*) FILTER (WHERE notification_type = 'URL_DELETED' AND NOT target_exists AND was_notified) AS deleted_legit_notified,
       COUNT(*) FILTER (WHERE notification_type = 'URL_DELETED' AND NOT target_exists AND NOT was_notified) AS deleted_legit_never_notified,
       COUNT(*) FILTER (WHERE notification_type = 'URL_DELETED' AND target_exists) AS deleted_target_still_exists,
       COUNT(*) FILTER (WHERE dup_rank > 1) AS pending_duplicates,
       COUNT(*) FILTER (WHERE supersede_reason IS NOT NULL) AS would_supersede,
       COUNT(*) FILTER (WHERE supersede_reason IS NULL) AS would_keep
     FROM (${CLASSIFIED}) c`
  );
  const byReason = await pool.query(
    `SELECT notification_type, COALESCE(supersede_reason, 'keep') AS outcome, COUNT(*) AS n
     FROM (${CLASSIFIED}) c GROUP BY 1, 2 ORDER BY 1, 3 DESC`
  );
  const already = await pool.query(
    `SELECT COALESCE(superseded_reason, '(none)') AS reason, COUNT(*) AS n FROM indexing_queue
     WHERE status = 'superseded' GROUP BY 1 ORDER BY 2 DESC`
  );
  return { summary: result.rows[0], byReason: byReason.rows, alreadySuperseded: already.rows };
}

// Slugs are title-derived; the app serves 200 for any slug of a live id and
// never redirects, so "redirect" is reported from HTTP only (expected 0).
async function httpSample(n: number) {
  const rows = await pool.query<{ url: string }>(
    `SELECT url FROM indexing_queue WHERE status = 'pending' AND notification_type = 'URL_UPDATED'
     ORDER BY random() LIMIT $1`,
    [n]
  );
  const counts: Record<string, number> = {};
  for (const [index, row] of rows.rows.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    let key: string;
    try {
      const res = await fetch(row.url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000) });
      key = res.status >= 300 && res.status < 400 ? `redirect_${res.status}` : String(res.status);
      await res.body?.cancel();
    } catch (error) {
      key = error instanceof Error ? error.name : "error";
    }
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function apply() {
  const unclassified = await pool.query(`SELECT COUNT(*) AS n FROM jobs WHERE is_active = TRUE AND detail_status IS NULL`);
  if (Number(unclassified.rows[0].n) > 0) {
    throw new Error(
      `${unclassified.rows[0].n} vacantes activas sin clasificar. Ejecuta primero scripts/classify-job-readiness.ts --apply.`
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const planned = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM (${CLASSIFIED}) c WHERE supersede_reason IS NOT NULL`
    );
    const superseded = await client.query(
      `UPDATE indexing_queue q
       SET status = 'superseded', superseded_at = NOW(), superseded_reason = c.supersede_reason
       FROM (${CLASSIFIED}) c
       WHERE q.id = c.id AND q.status = 'pending' AND c.supersede_reason IS NOT NULL`
    );
    if ((superseded.rowCount ?? 0) !== Number(planned.rows[0].n)) {
      throw new Error(`Plan ${planned.rows[0].n} ≠ escritas ${superseded.rowCount}. Revertido.`);
    }
    // Kept URL_UPDATED rows: lowest lane, linked to the job and its current content.
    const keptUpdated = await client.query(
      `UPDATE indexing_queue q
       SET priority = 4, job_id = j.id, content_hash = j.content_hash
       FROM jobs j
       WHERE q.status = 'pending' AND q.notification_type = 'URL_UPDATED'
         AND j.id = substring(q.url FROM '/empleos/([0-9a-fA-F-]{36})/')::uuid`
    );
    const keptDeleted = await client.query(
      `UPDATE indexing_queue q
       SET priority = CASE WHEN EXISTS (
             SELECT 1 FROM indexing_queue s
             WHERE s.url = q.url AND s.notification_type = 'URL_UPDATED' AND s.status = 'sent'
           ) THEN 1 ELSE 4 END,
           job_id = substring(q.url FROM '/empleos/([0-9a-fA-F-]{36})/')::uuid
       WHERE q.status = 'pending' AND q.notification_type = 'URL_DELETED'`
    );
    // Stale slugs of a live job are detected after the join (needs the current title/location).
    const current = await client.query<{ id: string; url: string; job_id: string; title: string; location: string | null }>(
      `SELECT q.id, q.url, q.job_id, j.title, j.location FROM indexing_queue q JOIN jobs j ON j.id = q.job_id
       WHERE q.status = 'pending' AND q.notification_type = 'URL_UPDATED'`
    );
    const stale = current.rows
      .filter((row) => buildJobUrl({ jobId: row.job_id, title: row.title, location: row.location }) !== row.url)
      .map((row) => row.id);
    if (stale.length > 0) {
      await client.query(
        `UPDATE indexing_queue SET status = 'superseded', superseded_at = NOW(), superseded_reason = 'url_changed'
         WHERE id = ANY($1::uuid[]) AND status = 'pending'`,
        [stale]
      );
    }
    await client.query("COMMIT");
    return {
      superseded: superseded.rowCount ?? 0,
      urlChanged: stale.length,
      keptUpdatedLinked: keptUpdated.rowCount ?? 0,
      keptDeletedPrioritized: keptDeleted.rowCount ?? 0
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const before = await report();
  console.log(`\n🧹 [cleanup-indexing-queue] ${APPLY ? "APPLY" : "DRY-RUN (solo lectura)"}`);
  console.table(Object.entries(before.summary).map(([metric, value]) => ({ metric, value: Number(value) })));
  console.table(before.byReason.map((row) => ({ ...row, n: Number(row.n) })));
  console.log("Ya superseded antes de esta ejecución:");
  console.table(before.alreadySuperseded.map((row) => ({ ...row, n: Number(row.n) })));
  if (HTTP_SAMPLE > 0) {
    console.log(`Muestra HTTP real (${HTTP_SAMPLE} URL_UPDATED pendientes al azar, 1 req/s):`);
    console.table(await httpSample(HTTP_SAMPLE));
  }
  if (APPLY) {
    const snapshot = await writeJobSeoV2StateSnapshot(requireAbsoluteSnapshotPath(SNAPSHOT_OUT));
    console.log(`[cleanup-indexing-queue] snapshot: ${snapshot.destination} (${snapshot.jobs} jobs, ${snapshot.pendingQueue} pending queue rows)`);
    const applied = await apply();
    console.log("Aplicado:", applied);
    const after = await report();
    console.table(Object.entries(after.summary).map(([metric, value]) => ({ metric, value: Number(value) })));
  }
  await pool.end();
}

main().catch(async (error) => {
  console.error("❌ [cleanup-indexing-queue]", error instanceof Error ? error.message : "Error");
  await pool.end().catch(() => undefined);
  process.exit(1);
});
