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
import { companyKey } from "../src/direct/discovery/company-key.js";
import { parseEmployerSeed } from "../src/direct/seed.js";

dotenv.config();

async function main() {
  const allSeeds = parseEmployerSeed(
    JSON.parse(await readFile(new URL("../data/direct-employers.seed.json", import.meta.url), "utf8"))
  );
  const slugIndex = process.argv.indexOf("--slug");
  const slug = slugIndex >= 0 ? process.argv[slugIndex + 1] : null;
  if (slugIndex >= 0 && (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) throw new Error("--slug requiere un slug válido.");
  const seeds = slug ? allSeeds.filter((seed) => seed.slug === slug) : allSeeds;
  if (seeds.length === 0) throw new Error(`No existe ${slug} en el seed.`);
  const sources = seeds.flatMap((seed) => seed.sources);
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun && !slug) {
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
      if (slug) {
        const keys = [...new Set([seed.displayName, ...seed.aliases].map(companyKey))];
        const aliasConflicts = await pool.query<{ company_key: string; slug: string }>(
          `SELECT a.company_key, e.slug FROM employer_aliases a JOIN employers e ON e.id = a.employer_id
           WHERE a.company_key = ANY($1::text[]) AND e.slug <> $2`,
          [keys, seed.slug]
        );
        if (aliasConflicts.rows.length) throw new Error(`Alias de ${seed.slug} pertenece a ${aliasConflicts.rows[0].slug}: ${aliasConflicts.rows[0].company_key}`);
        for (const source of seed.sources) {
          const boardConflict = await pool.query<{ slug: string }>(
            `SELECT e.slug FROM employer_sources s JOIN employers e ON e.id = s.employer_id
             WHERE s.ats_type = $1 AND lower(s.ats_ref) = lower($2) AND e.slug <> $3`,
            [source.atsType, source.atsRef, seed.slug]
          );
          if (boardConflict.rows.length) throw new Error(`Tablero de ${seed.slug} pertenece a ${boardConflict.rows[0].slug}: ${source.atsType}:${source.atsRef}`);
        }
      }
      if (dryRun) {
        console.log(`[seed-direct-employers] --dry-run: ${seed.displayName} → ${seed.sources.map((source) => `${source.atsType}:${source.atsRef}`).join(", ")}; sin conflictos ni escrituras.`);
        continue;
      }
      const result = await upsertEmployer(seed);
      aliases += result.aliasesAdded;
      for (const key of result.aliasConflicts) {
        console.warn(`   alias "${key}" ya pertenece a otra empresa; ${seed.slug} no lo toma.`);
      }
    }
    if (dryRun) return;
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
