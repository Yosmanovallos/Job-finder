/**
 * Manual closure pass (same logic the scrape tick runs, bigger cap) — used to
 * clear the backlog of closed postings right away instead of waiting for the
 * tick's 400-rows-per-run rotation.
 *
 *   npx tsx scripts/verify-source-closures.ts                    # dry-run (default): zero writes
 *   npx tsx scripts/verify-source-closures.ts --execute          # deletes confirmed-closed rows
 *   npx tsx scripts/verify-source-closures.ts --execute --limit 4000
 *
 * Requires scripts/migrate-source-closure.ts to have run.
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { createFetchContext } from "../src/engine/fetch-context.js";
import { formatClosureReport, verifyTorreClosures } from "../src/queue/source-closure.js";

dotenv.config();

const args = process.argv.slice(2);
const allowed = new Set(["--execute", "--dry-run", "--limit"]);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--limit") i++;
  else if (!allowed.has(args[i])) throw new Error(`Argumento desconocido: ${args[i]}`);
}
const execute = args.includes("--execute") && !args.includes("--dry-run");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number.parseInt(args[limitIndex + 1] ?? "", 10) : 1000;
if (!Number.isFinite(limit) || limit < 1 || limit > 5000) throw new Error("--limit debe estar entre 1 y 5000.");

const PASS_BUDGET_MS = 15 * 60 * 1000;

async function main() {
  const ctx = createFetchContext(PASS_BUDGET_MS);
  try {
    const report = await verifyTorreClosures(ctx, { limit, dryRun: !execute });
    console.log(formatClosureReport(report));
    if (!execute && report.closedJobIds.length > 0) {
      console.log(`Dry-run: nada se escribió. Repetir con --execute para eliminar ${report.closedJobIds.length} fila(s).`);
    }
  } finally {
    ctx.dispose();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[verify-source-closures] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
