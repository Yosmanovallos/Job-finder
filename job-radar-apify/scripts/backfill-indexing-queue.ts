/**
 * Reconciliation backfill: enqueues URL_UPDATED for every currently active,
 * publicly-describable job that has no indexing_queue entry at all.
 *
 * Originally written as a one-off (to cover jobs that predated the
 * indexing_queue system). Now also runs on every indexing-tick.yml cron
 * (SEO-IMPROVEMENT-PLAN.md §1.19) as a self-heal: saveJobs()'s enqueue call
 * is best-effort (wrapped in try/catch, "never let an indexing-queue write
 * fail the actual save" — see job-repository.ts) — if it throws for any
 * transient reason (connection contention, etc.), that tick's newly-saved
 * jobs are saved fine but silently never reach the queue, with nothing to
 * retry them. Confirmed in production 2026-08-10: 2,658 live, complete job
 * pages (94% from one source, clustered in batch-sized timestamp bursts —
 * consistent with occasional whole-batch enqueue failures, not missing
 * data) had zero queue history. This script is the recurring fix: it
 * doesn't matter why a job's enqueue was missed, only that it eventually
 * gets caught the next time this runs.
 *
 * Only touches indexing_queue — never writes to `jobs`. Safe to re-run:
 * skips any URL already present in the queue (any status), so a run only
 * ever picks up jobs with zero queue history, never duplicates.
 *
 * Manual run:
 *   cd job-radar-apify && npx tsx scripts/backfill-indexing-queue.ts
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { getJobs } from "../src/db/job-repository.js";
import { buildJobUrl, isPubliclyDescribable } from "../src/lib/job-seo.js";

dotenv.config();

async function main() {
  console.log("🔧 [backfill-indexing-queue] Loading active jobs...");
  const jobs = await getJobs(50000);
  console.log(`   Found ${jobs.length} active job(s).`);

  const urls = jobs.filter(isPubliclyDescribable).map((job) => buildJobUrl(job));
  console.log(`   ${urls.length} are publicly describable (have company/location/url).`);

  const existing = await pool.query(`SELECT url FROM indexing_queue`);
  const alreadyQueued = new Set(existing.rows.map((r) => r.url));

  const toInsert = urls.filter((url) => !alreadyQueued.has(url));
  console.log(`   ${toInsert.length} not yet in indexing_queue — enqueueing.`);

  if (toInsert.length === 0) {
    console.log("   Nothing to do.");
    await pool.end();
    return;
  }

  const values: string[] = [];
  const params: string[] = [];
  toInsert.forEach((url, i) => {
    values.push(`($${i + 1}, 'URL_UPDATED')`);
    params.push(url);
  });

  await pool.query(`INSERT INTO indexing_queue (url, notification_type) VALUES ${values.join(", ")}`, params);
  console.log(`✅ [backfill-indexing-queue] Enqueued ${toInsert.length} URL(s).`);
  console.log(
    `   At the default 200/day quota, draining this fully takes ~${Math.ceil(toInsert.length / 200)} days.`
  );

  await pool.end();
}

main().catch((err) => {
  console.error("❌ [backfill-indexing-queue] Failed:", err);
  process.exit(1);
});
