/**
 * Coverage report, read-only (docs/adr/0006-direct-employers.md §7.1): the
 * discovery funnel by companies and weighted by job-board vacancies, always
 * with the share actually looked at — never a bare percentage. Local
 * database only unless --allow-remote-db.
 *
 *   npx tsx scripts/direct-coverage.ts
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

async function main() {
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const { coverageBuckets, formatTickCapacity, liveOfficialCount, tickCapacity } =await import("../src/db/direct-discovery-repository.js");
  const { formatCoverage, formatDenominator, parseDenominator, summarizeCoverage } = await import("../src/direct/discovery/coverage.js");
  try {
    const summary = summarizeCoverage(await coverageBuckets());
    console.log(formatCoverage(summary));
    console.log(`\n${formatTickCapacity(await tickCapacity())}`);
    const denominator = parseDenominator(
      JSON.parse(await readFile(new URL("../data/coverage-denominator.json", import.meta.url), "utf8"))
    );
    console.log(
      denominator
        ? `\n${formatDenominator(denominator, summary.totalRows, await liveOfficialCount())}`
        : "\nDenominador externo: data/coverage-denominator.json inválido — no se reporta proporción."
    );
    console.log("Empresas: no hay denominador externo verificable (el SPE no publica empresas con vacantes; datos.gov.co no tiene el dataset).");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[direct-coverage] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
