/**
 * Read-only report (docs/adr/0006-direct-employers.md): per employer, its
 * official live vacancies next to the rows the scraped job boards hold for
 * it (through employer_aliases). Local database only unless
 * --allow-remote-db.
 *
 *   npx tsx scripts/direct-report.ts
 */
import dotenv from "dotenv";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

async function main() {
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const { employerReport } = await import("../src/db/direct-repository.js");
  try {
    const rows = await employerReport();
    console.log(`${"empresa".padEnd(18)}${"oficiales".padStart(10)}${"en bolsas".padStart(11)}  estado      tableros`);
    for (const row of rows) {
      console.log(
        `${row.displayName.slice(0, 17).padEnd(18)}${String(row.officialLive).padStart(10)}${String(row.boardsLive).padStart(11)}  ` +
          `${row.status.padEnd(11)} ${row.sources}`
      );
    }
    const official = rows.reduce((sum, row) => sum + row.officialLive, 0);
    console.log(`\n${rows.length} empresas · ${official} vacantes oficiales vigentes en Colombia.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[direct-report] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
