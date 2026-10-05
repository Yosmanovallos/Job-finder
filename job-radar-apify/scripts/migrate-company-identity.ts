/**
 * Migration for the repeated-companies fix (2026-10-05). Applies schema.sql's
 * additive `company-identity` block — jobs.title_key / company_key /
 * location_key plus the trigger that fills them on every write — then
 * backfills the rows written before the trigger existed, in batches.
 *
 * MUST run before the code that reads those columns is deployed: every
 * listing query selects jobs.company_key, so deploying first answers 500.
 *
 * Additive only: three nullable columns (metadata-only ADD COLUMN, no table
 * rewrite), one trigger; no row is deleted and no existing column changes.
 *
 * Run once, explicitly:
 *   cd job-radar-apify && npx tsx scripts/migrate-company-identity.ts --dry-run
 *   cd job-radar-apify && npx tsx scripts/migrate-company-identity.ts
 *
 * Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE everywhere, and the
 * backfill only touches rows whose keys are still NULL.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db/client.js";
import { companyIdentityBackfillBatchSql } from "../src/lib/company-identity.js";

dotenv.config();

const BATCH_SIZE = 2_000;
// Upper bound on batches so a bug can never loop forever (AGENTS.md regla 12):
// 2,000 x 500 = 1M rows, far above the live corpus.
const MAX_BATCHES = 500;

function schemaBlock(schema: string, name: string): string {
  const block = new RegExp(`-- BEGIN ${name}\\r?\\n([\\s\\S]*?)-- END ${name}`).exec(schema)?.[1];
  if (!block) throw new Error(`schema.sql no contiene el bloque ${name}.`);
  return block;
}

async function pendingRows(): Promise<number> {
  const hasColumns = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'jobs' AND column_name IN ('title_key', 'company_key', 'location_key')`
  );
  if (hasColumns.rows[0].n < 3) {
    const total = await pool.query(`SELECT COUNT(*)::int AS n FROM jobs`);
    return total.rows[0].n;
  }
  const pending = await pool.query(
    `SELECT COUNT(*)::int AS n FROM jobs
     WHERE title_key IS NULL OR company_key IS NULL OR location_key IS NULL`
  );
  return pending.rows[0].n;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const before = await pendingRows();
  if (dryRun) {
    console.log(
      `[migrate-company-identity] --dry-run: no se escribió nada. Filas por rellenar: ${before} ` +
        `(~${Math.ceil(before / BATCH_SIZE)} lotes de ${BATCH_SIZE}).`
    );
    await pool.end();
    return;
  }

  const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  await pool.query(schemaBlock(schema, "company-identity"));
  console.log("[migrate-company-identity] Columnas y trigger listos.");

  const started = Date.now();
  let filled = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const result = await pool.query(companyIdentityBackfillBatchSql(BATCH_SIZE));
    const count = result.rowCount ?? 0;
    filled += count;
    if (count === 0) break;
    console.log(`   lote ${batch + 1}: ${count} filas (total ${filled})`);
  }
  const after = await pendingRows();
  console.log(
    `[migrate-company-identity] OK — ${filled} filas rellenadas en ${Math.round((Date.now() - started) / 1000)}s. ` +
      `Pendientes: ${after}.`
  );
  await pool.end();
  if (after > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error("[migrate-company-identity] Falló:", (error as Error)?.message || error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
