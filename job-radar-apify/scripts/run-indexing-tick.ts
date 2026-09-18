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
  getPendingIndexingLanes,
  markIndexingSent,
  markIndexingFailed,
  markIndexingSuperseded,
  checkIndexingTarget
} from "../src/db/indexing-repository.js";
import { publishUrlNotification } from "../src/lib/google-indexing.js";
import { DEFAULT_SCHEDULER, planIndexingSends } from "../src/lib/indexing-scheduler.js";

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

  // Job SEO V2: every row is checked right before spending quota. A target
  // that no longer exists, is not Google-ready, is not canonical, or whose
  // URL changed is marked 'superseded' (terminal, history kept) and does NOT
  // consume the budget — so the scan continues until the budget is really
  // used or the bounded scan window runs out.
  const MAX_SCANNED_PER_RUN = 5_000;
  let sent = 0;
  let failed = 0;
  let superseded = 0;
  let scanned = 0;
  let consecutiveFailures = 0;
  const CONSECUTIVE_FAILURE_LIMIT = 5;
  let stop = false;

  // ADR 0004: the day's budget is shared by lane (new-ready 50% / API-notified
  // deletes 50%, unused share spills new → delete → content → reconcile), so
  // neither new jobs nor deletes can starve the other. Rows the pre-send check
  // closes free their slot, so the remaining budget is planned again.
  while (!stop && sent + failed < budget && scanned < MAX_SCANNED_PER_RUN) {
    const lanes = await getPendingIndexingLanes(Math.min(500, MAX_SCANNED_PER_RUN - scanned));
    const batch = planIndexingSends(lanes, budget - sent - failed, DEFAULT_SCHEDULER, Date.now() / 3_600_000);
    if (batch.length === 0) break;
    for (const row of batch) {
      if (sent + failed >= budget) break;
      scanned++;
      const verdict = await checkIndexingTarget(row);
      if (!verdict.send) {
        await markIndexingSuperseded(row.id, verdict.reason);
        superseded++;
        continue;
      }
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
          stop = true;
          break;
        }
      }
    }
  }

  console.log(`   Superseded before sending (not sent, no quota used): ${superseded}. Scanned: ${scanned}.`);
  console.log(`✅ [indexing-tick] Done. Sent: ${sent}, Failed: ${failed}.`);
  await pool.end();
}

main().catch((err) => {
  console.error("❌ [indexing-tick] Fatal error:", err);
  process.exit(1);
});
