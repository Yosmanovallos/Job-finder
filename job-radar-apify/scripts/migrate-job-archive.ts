import { readFile } from "node:fs/promises";

// Do not connect, or load a local environment, for a dry-run.
const args = process.argv.slice(2);
if (args.some((arg) => !["--execute", "--dry-run"].includes(arg)) ||
    (args.includes("--execute") && args.includes("--dry-run"))) {
  throw new Error("Use --dry-run (default) OR --execute.");
}
const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
const sql = /-- BEGIN job-archive\r?\n([\s\S]*?)-- END job-archive/.exec(schema)?.[1];
if (!sql) throw new Error("Missing job-archive schema block.");
if (!args.includes("--execute")) {
  console.log("[migrate-job-archive] DRY RUN — no connection or writes. Additive SQL:\n" + sql);
} else {
  const { pool } = await import("../src/db/client.js");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '30s'");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("[migrate-job-archive] OK — private archive ready; no jobs moved.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[migrate-job-archive] Failed; transaction rolled back.");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
