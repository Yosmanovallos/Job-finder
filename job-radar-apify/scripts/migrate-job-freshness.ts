/**
 * Migration for the expired-jobs fix (bug reported 2026-10-04). Applies the
 * two additive schema.sql blocks it depends on, in order:
 *
 *   - `source-closure`  → jobs.source_checked_at (Torre closure check cursor)
 *   - `job-freshness`   → expired_job_urls (expired URLs never come back)
 *
 * Additive only: no row is changed or deleted. Until it runs, the closure
 * check logs a skip and saveJobs() simply cannot block re-insertion of an
 * expired URL — the age/validThrough filters on every read path and in the
 * purge work without it.
 *
 * Run once, explicitly:
 *   cd job-radar-apify && npx tsx scripts/migrate-job-freshness.ts
 *
 * Safe to re-run (IF NOT EXISTS everywhere). Supersedes running
 * scripts/migrate-source-closure.ts on its own.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db/client.js";
import { liveJobSql, MAX_JOB_AGE_DAYS } from "../src/lib/job-freshness.js";

dotenv.config();

function schemaBlock(schema: string, name: string): string {
  const block = new RegExp(`-- BEGIN ${name}\\r?\\n([\\s\\S]*?)-- END ${name}`).exec(schema)?.[1];
  if (!block) throw new Error(`schema.sql no contiene el bloque ${name}.`);
  return block;
}

async function main() {
  const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  await pool.query(schemaBlock(schema, "source-closure"));
  await pool.query(schemaBlock(schema, "job-freshness"));
  // Same defense-in-depth as the REVOKE at the end of schema.sql, applied
  // here because this script runs the block on its own.
  await pool.query(`REVOKE ALL ON expired_job_urls FROM anon, authenticated`).catch((error) => {
    // Plain Postgres (local/test) has no Supabase roles; nothing to revoke there.
    if ((error as { code?: string })?.code !== "42704") throw error;
  });

  const check = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE NOT ${liveJobSql()})::int AS stale,
            COUNT(*) FILTER (WHERE source = 'Torre' AND source_checked_at IS NULL)::int AS torre_never_checked
       FROM jobs WHERE is_active = TRUE`
  );
  console.log(
    `[migrate-job-freshness] OK — source_checked_at y expired_job_urls listos. ` +
      `Vacantes ya ocultas por vencidas (>${MAX_JOB_AGE_DAYS} días o validThrough pasado), que el próximo tick purgará: ${check.rows[0].stale}. ` +
      `Torre nunca verificadas en la fuente: ${check.rows[0].torre_never_checked}.`
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error("[migrate-job-freshness] Falló:", (error as Error)?.message || error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
