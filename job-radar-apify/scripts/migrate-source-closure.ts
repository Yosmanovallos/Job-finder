/**
 * Migration: `jobs.source_checked_at` + its partial index (schema.sql block
 * `source-closure`). Additive only — no row is changed or deleted.
 *
 * Applies exactly the block from schema.sql so the file stays the single
 * definition. Until it runs, the scrape tick's closure check logs a skip and
 * does nothing else (src/queue/source-closure.ts → missing_column).
 *
 * Run once, explicitly:
 *   cd job-radar-apify && npx tsx scripts/migrate-source-closure.ts
 *
 * Safe to re-run (IF NOT EXISTS everywhere).
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db/client.js";

dotenv.config();

async function main() {
  const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  const block = /-- BEGIN source-closure\r?\n([\s\S]*?)-- END source-closure/.exec(schema)?.[1];
  if (!block) throw new Error("schema.sql no contiene el bloque source-closure.");

  await pool.query(block);
  const check = await pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE source_checked_at IS NULL)::int AS never_checked
       FROM jobs WHERE is_active = TRUE AND source = 'Torre'`
  );
  console.log(
    `[migrate-source-closure] OK — columna e índice listos. Torre activas: ${check.rows[0].total}, nunca verificadas: ${check.rows[0].never_checked}.`
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error("[migrate-source-closure] Falló:", (error as Error)?.message || error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
