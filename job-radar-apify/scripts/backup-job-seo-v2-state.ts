/** Captures only mutable readiness/queue state; never credentials or descriptions. */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { requireAbsoluteSnapshotPath, writeJobSeoV2StateSnapshot } from "../src/db/job-seo-v2-state.js";
dotenv.config();
const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6);
async function main() {
  const result = await writeJobSeoV2StateSnapshot(requireAbsoluteSnapshotPath(out));
  console.log(`[job-seo-v2:backup] wrote ${result.jobs} jobs and ${result.pendingQueue} pending queue rows to ${result.destination}`);
  await pool.end();
}
main().catch(async (error) => { console.error("[job-seo-v2:backup]", error instanceof Error ? error.message : "failed"); await pool.end().catch(() => undefined); process.exit(1); });
