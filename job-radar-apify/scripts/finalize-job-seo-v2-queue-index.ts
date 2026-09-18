/** Creates the pending queue uniqueness index only after cleanup proves it is safe. */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
dotenv.config();
const APPLY = process.argv.includes("--apply");
async function main() {
  const duplicates = await pool.query<{ n: string }>("SELECT COUNT(*) AS n FROM (SELECT 1 FROM indexing_queue WHERE status = 'pending' GROUP BY url, notification_type HAVING COUNT(*) > 1) d");
  const n = Number(duplicates.rows[0]?.n ?? 0);
  console.log(`[job-seo-v2:finalize-queue-index] ${APPLY ? "APPLY" : "DRY-RUN"}; duplicate groups=${n}`);
  if (n > 0) throw new Error("Pending queue duplicates remain; run reviewed cleanup before creating the unique index.");
  if (APPLY) await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS uq_indexing_queue_pending_url_type ON indexing_queue (url, notification_type) WHERE status = 'pending'");
  await pool.end();
}
main().catch(async (error) => { console.error("[job-seo-v2:finalize-queue-index]", error instanceof Error ? error.message : "failed"); await pool.end().catch(() => undefined); process.exit(1); });
