/**
 * Migration for official employer vacancies (docs/adr/0006-direct-employers.md).
 * Applies schema.sql's additive `direct-employers` block: four NEW tables with
 * RLS + REVOKE. Touches no existing table, so it takes no lock on `jobs`.
 *
 * Run once, explicitly:
 *   npx tsx scripts/migrate-direct-employers.ts --dry-run
 *   npx tsx scripts/migrate-direct-employers.ts                      (local DB)
 *   npx tsx scripts/migrate-direct-employers.ts --allow-remote-db    (production, phase D2 — needs approval)
 *
 * Safe to re-run: IF NOT EXISTS everywhere.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

const TABLES = ["employers", "employer_aliases", "employer_sources", "direct_jobs"];

async function main() {
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  try {
    const existing = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [TABLES]
    );
    const present = existing.rows.map((row) => row.table_name);
    if (process.argv.includes("--dry-run")) {
      console.log(
        `[migrate-direct-employers] --dry-run: no se escribió nada. Ya existen: ${present.join(", ") || "ninguna"}; ` +
          `se crearían: ${TABLES.filter((table) => !present.includes(table)).join(", ") || "ninguna"}.`
      );
      return;
    }
    const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
    const block = /-- BEGIN direct-employers\r?\n([\s\S]*?)-- END direct-employers/.exec(schema)?.[1];
    if (!block) throw new Error("schema.sql no contiene el bloque direct-employers.");
    await pool.query(block);
    const after = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [TABLES]
    );
    if (after.rows[0].n !== TABLES.length) throw new Error(`se esperaban ${TABLES.length} tablas, hay ${after.rows[0].n}`);
    console.log(`[migrate-direct-employers] OK — ${TABLES.join(", ")} listas.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate-direct-employers] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
