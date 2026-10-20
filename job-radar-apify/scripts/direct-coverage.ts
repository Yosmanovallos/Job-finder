/**
 * Coverage report, read-only (docs/adr/0006-direct-employers.md §7.1): the
 * discovery funnel by companies and weighted by job-board vacancies, always
 * with the share actually looked at — never a bare percentage. Local
 * database only unless --allow-remote-db.
 *
 *   npx tsx scripts/direct-coverage.ts
 */
import dotenv from "dotenv";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

async function main() {
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const { coverageBuckets, tickCapacity } = await import("../src/db/direct-discovery-repository.js");
  const { formatCoverage, summarizeCoverage } = await import("../src/direct/discovery/coverage.js");
  try {
    console.log(formatCoverage(summarizeCoverage(await coverageBuckets())));
    const capacity = await tickCapacity();
    console.log(
      `\nTick: ${capacity.enabledBoards} tableros habilitados (${capacity.neverRead} sin leer aún); ` +
        `cada uno se lee cada ~${Math.ceil(capacity.enabledBoards / 50) * 6} h con el tope de 50 por tick; último OK más viejo: ${capacity.oldestOkAt ?? "—"}.`
    );
    console.log("Denominador externo (datos.gov.co, empresas por NIT): pendiente — este reporte cubre solo el directorio de BuscoTrabajo.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[direct-coverage] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
