/**
 * Drains `indexing_queue` (SEO Fase 3), respecting Google's daily quota.
 * Meant to run on a schedule via GitHub Actions (indexing-tick.yml),
 * separate from run-scrape-tick.ts since it needs different secrets
 * (GOOGLE_INDEXING_CLIENT_EMAIL/GOOGLE_INDEXING_PRIVATE_KEY) and has
 * nothing to do with scraping.
 *
 * The budget check is stateful (DB-backed, see indexing-repository.ts), so
 * running this more or less often than the cron's actual cadence never
 * over-sends — it just changes how evenly the day's 200 are paced.
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import {
  getIndexingBudgetRemaining,
  getPendingIndexingBatch,
  markIndexingSent,
  markIndexingFailed
} from "../src/db/indexing-repository.js";
import { publishUrlNotification } from "../src/lib/google-indexing.js";

dotenv.config();

async function main() {
  if (!process.env.GOOGLE_INDEXING_CLIENT_EMAIL || !process.env.GOOGLE_INDEXING_PRIVATE_KEY) {
    // Leave the queue untouched (pending, not failed) — this is expected
    // until the user finishes the Google Cloud setup in docs/SEO-PLAN.md
    // section 7.2, not an error condition to alarm on.
    console.log("⏭️  [indexing-tick] Google credentials not configured yet — skipping, queue left pending.");
    await pool.end();
    return;
  }

  const budget = await getIndexingBudgetRemaining();
  console.log(`📊 [indexing-tick] Budget remaining today: ${budget}`);

  if (budget <= 0) {
    console.log("   Nothing to do — daily quota already spent.");
    await pool.end();
    return;
  }

  const batch = await getPendingIndexingBatch(budget);
  console.log(`📦 [indexing-tick] Draining ${batch.length} pending notification(s)...`);

  let sent = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  // A misconfigured service account (wrong Search Console permission, bad
  // key) fails every single request the same way — without this, one run
  // would burn the whole batch as 403s. 5 in a row is a config problem,
  // not a per-URL problem; stop and let the next tick retry once it's fixed
  // instead of hammering Google with requests certain to fail.
  const CONSECUTIVE_FAILURE_LIMIT = 5;

  for (const row of batch) {
    try {
      await publishUrlNotification(row.url, row.notification_type);
      await markIndexingSent(row.id);
      sent++;
      consecutiveFailures = 0;
    } catch (err: any) {
      await markIndexingFailed(row.id, String(err?.message ?? err));
      failed++;
      consecutiveFailures++;
      console.warn(`   ⚠️ Failed: ${row.url} (${row.notification_type}) — ${err?.message ?? err}`);

      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        console.error(
          `   🛑 ${CONSECUTIVE_FAILURE_LIMIT} failures in a row — stopping this run (likely a config issue, not a per-URL one). Remaining pending rows are untouched.`
        );
        break;
      }
    }
  }

  console.log(`✅ [indexing-tick] Done. Sent: ${sent}, Failed: ${failed}.`);
  await pool.end();
}

main().catch((err) => {
  console.error("❌ [indexing-tick] Fatal error:", err);
  process.exit(1);
});
