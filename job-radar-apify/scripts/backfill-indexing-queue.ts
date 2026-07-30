/**
 * One-off backfill: enqueues URL_UPDATED for every currently active,
 * publicly-describable job that predates the indexing_queue system (the
 * saveJobs()/purgeOldJobs() hooks only cover jobs saved/purged from now on).
 *
 * Only touches indexing_queue — never writes to `jobs`. Safe to re-run:
 * skips any URL already present in the queue (any status), so a second run
 * only picks up jobs that slipped in between runs, never duplicates.
 *
 * Run once:
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
