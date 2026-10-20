/**
 * Loads data/direct-employers.seed.json into employers / employer_aliases /
 * employer_sources (docs/adr/0006-direct-employers.md). References only:
 * no posting is written here — postings come from the ATS on the tick.
 *
 *   npx tsx scripts/seed-direct-employers.ts --dry-run
 *   npx tsx scripts/seed-direct-employers.ts                     (local DB)
 *
 * Idempotent. An alias already mapped to a different employer is reported
 * and left as it is (curated mapping, never overwritten silently).
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import { parseEmployerSeed } from "../src/direct/seed.js";

dotenv.config();

async function main() {
  const seeds = parseEmployerSeed(
    JSON.parse(await readFile(new URL("../data/direct-employers.seed.json", import.meta.url), "utf8"))
  );
  const sources = seeds.flatMap((seed) => seed.sources);
  if (process.argv.includes("--dry-run")) {
    console.log(
      `[seed-direct-employers] --dry-run: ${seeds.length} empresas, ${sources.length} tableros ` +
        `(${sources.filter((source) => source.enabled).length} habilitados). No se escribió nada.`
    );
    return;
  }
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const { upsertEmployer } = await import("../src/db/direct-repository.js");
  try {
    let aliases = 0;
    for (const seed of seeds) {
      const result = await upsertEmployer(seed);
      aliases += result.aliasesAdded;
      for (const key of result.aliasConflicts) {
        console.warn(`   alias "${key}" ya pertenece a otra empresa; ${seed.slug} no lo toma.`);
      }
    }
    const counts = await pool.query<{ employers: number; sources: number }>(
      `SELECT (SELECT COUNT(*)::int FROM employers) AS employers, (SELECT COUNT(*)::int FROM employer_sources) AS sources`
    );
    console.log(
      `[seed-direct-employers] OK — ${seeds.length} empresas del seed (${aliases} alias nuevos). ` +
        `En la BD: ${counts.rows[0].employers} empresas, ${counts.rows[0].sources} tableros.`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[seed-direct-employers] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
