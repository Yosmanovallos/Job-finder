import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1, connectionTimeoutMillis: 3000 });
const runId = process.env.JOB_RADAR_TEST_RUN;

try {
  const identity = await pool.query("SELECT current_database() AS name, current_user AS username");
  assert.equal(identity.rows[0].name, `job_radar_test_${runId}`);
  assert.equal(identity.rows[0].username, "job_radar_test");
  await pool.query("UPDATE test_sandbox SET run_id = $1 WHERE run_id = $2", ["foreign-sandbox", runId]);
  try {
    const child = spawnSync(process.execPath, [
      "--import", import.meta.resolve("tsx"), "--import", new URL("./require-test-environment.ts", import.meta.url).href,
      "--eval", "process.exit(0)"
    ], { cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 10000 });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /\[P0\] La base no pertenece/);
  } finally {
    await pool.query("UPDATE test_sandbox SET run_id = $1 WHERE run_id = $2", [runId, "foreign-sandbox"]);
  }
  console.log("[P0-DB-004] Una base local sin la identidad de esta ejecución es rechazada antes de cargar la aplicación.");
} finally {
  await pool.end();
}
