// Freezes one edition of the monthly labour-market report
// (openspec/changes/adsense-readiness F4) into data/market-reports/.
//
//   npx tsx scripts/build-market-report.ts --dry-run            # print, write nothing
//   npx tsx scripts/build-market-report.ts --write              # CO edition of the current month
//   npx tsx scripts/build-market-report.ts --write --country VE # VE (hub comparisons only)
//
// One bounded query (the dashboard's canonical projection, light columns, no
// URL/id/description) inside BEGIN READ ONLY with a statement_timeout, then
// pure aggregation (src/lib/market-report.ts). The file holds aggregates
// only: groups under 10 vacancies are suppressed, no URLs, ids or personal
// data. Running it against production is the owner's call; the server never
// runs it and never queries the database for the report.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/client.js";
import { queryMarketRows } from "../src/db/job-repository.js";
import { buildMarketSnapshot, isMarketSnapshot } from "../src/lib/market-report.js";

const STATEMENT_TIMEOUT_MS = 60_000;
const args = process.argv.slice(2);
const write = args.includes("--write");
const dryRun = args.includes("--dry-run") || !write;
const countryArg = args[args.indexOf("--country") + 1];
const country = args.includes("--country") ? countryArg : "CO";
if (country !== "CO" && country !== "VE") throw new Error("--country debe ser CO o VE");
if (write && args.includes("--dry-run")) throw new Error("Usa --dry-run o --write, no ambos.");
const outDir = process.env.MARKET_REPORTS_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "market-reports");

const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
  const cutoff = new Date();
  const rows = await queryMarketRows(client, country);
  await client.query("ROLLBACK");
  const snapshot = await buildMarketSnapshot(rows, { country, cutoff });
  if (!isMarketSnapshot(snapshot)) throw new Error("El informe generado no pasó la validación de forma.");
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  const file = path.join(outDir, `${country}-${snapshot.period}.json`);
  if (dryRun) {
    process.stdout.write(body);
    console.error(`[market-report] --dry-run: ${rows.length} vacantes leídas; no se escribió ${file}.`);
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(file, body);
    console.error(`[market-report] ${rows.length} vacantes leídas; escrito ${file}. Revísalo y haz commit.`);
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
