/**
 * Migration for the 410 tombstone lookup (2026-11-03).
 * Applies schema.sql's `purged-lookup` block: fills job_id on URL_DELETED
 * rows that predate that column, so wasJobPurged() can use the job_id index
 * instead of scanning indexing_queue. Only NULLs are written; safe to re-run.
 *
 *   npx tsx scripts/migrate-purged-lookup.ts                                  (dry-run, no connection)
 *   npx tsx scripts/migrate-purged-lookup.ts --execute                        (local DB)
 *   npx tsx scripts/migrate-purged-lookup.ts --execute --allow-remote-db      (production — only after the
 *                                                                            owner approves the SQL)
 *
 * Run it BEFORE deploying the code: until then, an old tombstone without
 * job_id would answer 404 instead of 410.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

const args = process.argv.slice(2);
if (args.some((arg) => !["--execute", "--dry-run", "--allow-remote-db"].includes(arg)) ||
    (args.includes("--execute") && args.includes("--dry-run"))) {
  throw new Error("Use --dry-run (default) OR --execute [--allow-remote-db].");
}
const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
const sql = /-- BEGIN purged-lookup\r?\n([\s\S]*?)-- END purged-lookup/.exec(schema)?.[1];
if (!sql) throw new Error("Missing purged-lookup schema block.");
if (!args.includes("--execute")) {
  console.log("[migrate-purged-lookup] DRY RUN — no connection or writes. SQL:\n" + sql);
} else {
  dotenv.config();
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5min'");
    const result = await client.query(sql);
    const pending = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM indexing_queue WHERE notification_type = 'URL_DELETED' AND job_id IS NULL`
    );
    await client.query("COMMIT");
    console.log(
      `[migrate-purged-lookup] OK — ${result.rowCount ?? 0} URL_DELETED rows got job_id; ` +
        `${pending.rows[0].n} still without one (URL has no job id).`
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[migrate-purged-lookup] Failed; transaction rolled back.");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
