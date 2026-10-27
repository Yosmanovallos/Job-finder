import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "child_process";
import { readFile } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { saveJobs } from "../src/db/job-repository.js";
import { pool } from "../src/db/client.js";
import {
  listSavedJobs,
  saveJob,
  removeSavedJob,
  SavedJobsLimitError,
  SavedJobsUnavailableError,
  SAVED_JOBS_LIMIT
} from "../src/db/saved-jobs-repository.js";
import type { Job } from "../src/sources/types.js";

// "Mis vacantes" (schema.sql's saved-jobs block, scripts/migrate-saved-jobs.ts).
// The code ships before the table exists, so this suite starts without it,
// applies the block itself (twice: it must be idempotent) and then checks
// the repository rules the API relies on. The HTTP part only checks what
// works without a real Supabase session: every route is 401 anonymous.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = Number(process.env.TEST_HTTP_PORT);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEST_URL_PREFIX = "https://www.example.com/job/saved-jobs-";
const USER_ID = "5a7ed000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "5a7ed000-0000-4000-8000-000000000002";
const UNKNOWN_JOB = "5a7ed000-0000-4000-8000-0000000000ff";

function makeJob(id: string, title: string): Job {
  return {
    jobId: id,
    title,
    company: "ZzSaved Corp",
    location: "Bogotá, Colombia",
    url: `${TEST_URL_PREFIX}${id}`,
    dateText: "Hace 1 día",
    source: "LinkedIn",
    publishedAt: new Date(Date.now() - 24 * 3600000).toISOString()
  };
}

async function waitForServer(server: ChildProcess, maxAttempts = 80, delayMs = 250): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (server.exitCode !== null) throw new Error(`El servidor de prueba terminó con código ${server.exitCode}.`);
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`El servidor no respondió en ${maxAttempts * delayMs}ms`);
}

async function jobIdByUrl(suffix: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`SELECT id FROM jobs WHERE url = $1`, [`${TEST_URL_PREFIX}${suffix}`]);
  assert.ok(result.rows[0], `no se guardó la vacante de prueba ${suffix}`);
  return result.rows[0].id;
}

async function readSchema(): Promise<string> {
  return readFile(path.join(__dirname, "..", "src", "db", "schema.sql"), "utf8");
}

// The isolated database starts from tests/fixtures/production-baseline.sql,
// which has no `users` table; production does (schema.sql). The FK target
// is created from schema.sql's own definition, not a copy.
async function ensureUsersTable(): Promise<void> {
  const statement = /CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/.exec(await readSchema())?.[0];
  assert.ok(statement, "schema.sql no contiene la tabla users");
  await pool.query(statement);
}

async function applySavedJobsBlock(): Promise<void> {
  const schema = await readSchema();
  const block = /-- BEGIN saved-jobs\r?\n([\s\S]*?)-- END saved-jobs/.exec(schema)?.[1];
  assert.ok(block, "schema.sql no contiene el bloque saved-jobs");
  await pool.query(block);
}

async function main() {
  console.log("\n🧪 SUITE: vacantes guardadas (Mi cuenta)\n");
  await pool.query(`DELETE FROM jobs WHERE url LIKE $1`, [`${TEST_URL_PREFIX}%`]);
  await saveJobs([makeJob("a", "Analista ZzSaved"), makeJob("b", "Gerente ZzSaved")], "Test Saved Jobs");
  const jobA = await jobIdByUrl("a");
  const jobB = await jobIdByUrl("b");

  const server = spawn(process.execPath, [...process.execArgv, path.join(__dirname, "..", "src", "server.ts")], {
    cwd: process.cwd(),
    shell: false,
    stdio: "inherit",
    env: { ...process.env, PORT: String(TEST_PORT) }
  });
  try {
    await waitForServer(server);

    // 1. Anonymous: every route is 401, before and after the table exists.
    for (const [method, url] of [
      ["GET", "/api/me/saved-jobs"],
      ["PUT", `/api/me/saved-jobs/${jobA}`],
      ["DELETE", `/api/me/saved-jobs/${jobA}`]
    ] as const) {
      const res = await fetch(`${BASE_URL}${url}`, { method, body: method === "PUT" ? "{}" : undefined });
      assert.equal(res.status, 401, `${method} ${url} sin sesión debía ser 401`);
      assert.equal(res.headers.get("cache-control"), "private, no-store");
    }
    console.log("✅ [PASSED] Sin sesión: 401 y sin caché.");

    // 2. Before the migration: the repository reports "unavailable" (the API's 503).
    await assert.rejects(listSavedJobs(USER_ID), SavedJobsUnavailableError);
    await assert.rejects(saveJob(USER_ID, jobA), SavedJobsUnavailableError);
    console.log("✅ [PASSED] Sin tabla: SavedJobsUnavailableError (503), nada se rompe.");

    // 3. The block is idempotent and locked down like every other table.
    for (const role of ["anon", "authenticated"]) {
      await pool.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    }
    await ensureUsersTable();
    await applySavedJobsBlock();
    await applySavedJobsBlock();
    const rls = await pool.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'user_saved_jobs'`);
    assert.equal(rls.rows[0]?.relrowsecurity, true, "RLS debe estar activo");
    const grants = await pool.query(
      `SELECT 1 FROM information_schema.role_table_grants WHERE table_name = 'user_saved_jobs' AND grantee IN ('anon', 'authenticated')`
    );
    assert.equal(grants.rowCount, 0, "anon/authenticated no deben tener permisos");
    console.log("✅ [PASSED] Bloque idempotente, RLS activo, 0 permisos públicos.");

    for (const [id, email] of [[USER_ID, "zzsaved-a@example.test"], [OTHER_USER_ID, "zzsaved-b@example.test"]]) {
      await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, email]);
    }

    // 4. Snapshot comes from `jobs`; unknown jobs are null (404).
    const saved = await saveJob(USER_ID, jobA);
    assert.ok(saved);
    assert.equal(saved.title, "Analista ZzSaved");
    assert.equal(saved.company, "ZzSaved Corp");
    assert.equal(saved.appliedAt, null);
    assert.equal(saved.available, true);
    assert.equal(await saveJob(USER_ID, UNKNOWN_JOB), null);
    console.log("✅ [PASSED] Copia tomada de jobs; vacante desconocida = null (404).");

    // 5. applied: true marks once and keeps the first date, undefined keeps it, false clears it.
    const applied = await saveJob(USER_ID, jobA, true);
    assert.ok(applied?.appliedAt);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await saveJob(USER_ID, jobA, true))?.appliedAt, applied.appliedAt);
    assert.equal((await saveJob(USER_ID, jobA))?.appliedAt, applied.appliedAt);
    assert.equal((await saveJob(USER_ID, jobA, false))?.appliedAt, null);
    console.log("✅ [PASSED] Postulada: se marca una vez, se conserva y se quita.");

    // 6. Lists are per user, newest first; an expired job stays, as unavailable.
    await new Promise((r) => setTimeout(r, 20));
    await saveJob(USER_ID, jobB, true);
    await saveJob(OTHER_USER_ID, jobA);
    const list = await listSavedJobs(USER_ID);
    assert.deepEqual(list.map((job) => job.jobId), [jobB, jobA]);
    assert.ok(list[0].appliedAt);
    assert.deepEqual((await listSavedJobs(OTHER_USER_ID)).map((job) => job.jobId), [jobA]);
    await pool.query(`UPDATE jobs SET is_active = FALSE WHERE id = $1`, [jobB]);
    const afterExpiry = await listSavedJobs(USER_ID);
    assert.equal(afterExpiry.find((job) => job.jobId === jobB)?.available, false);
    assert.equal(afterExpiry.find((job) => job.jobId === jobA)?.available, true);
    console.log("✅ [PASSED] Lista por usuario, más reciente primero; vencida = no disponible.");

    // 7. Remove only touches the caller's row.
    assert.equal(await removeSavedJob(USER_ID, jobA), true);
    assert.equal(await removeSavedJob(USER_ID, jobA), false);
    assert.deepEqual((await listSavedJobs(OTHER_USER_ID)).map((job) => job.jobId), [jobA]);
    console.log("✅ [PASSED] Borrar solo afecta al usuario dueño.");

    // 8. The limit: a full list can't grow, but an already-saved job can still change.
    await pool.query(
      `INSERT INTO user_saved_jobs (user_id, job_id, title)
       SELECT $1, gen_random_uuid(), 'Relleno' FROM generate_series(1, $2::int)`,
      [OTHER_USER_ID, SAVED_JOBS_LIMIT - 1]
    );
    await assert.rejects(saveJob(OTHER_USER_ID, jobB), SavedJobsLimitError);
    assert.ok((await saveJob(OTHER_USER_ID, jobA, true))?.appliedAt);
    console.log(`✅ [PASSED] Tope de ${SAVED_JOBS_LIMIT}: no crece, pero lo ya guardado se puede marcar.`);

    // 9. The production migration script itself (dry-run, then a re-run on
    // the existing table), with its own RLS/grant checks.
    for (const args of [["--dry-run"], []]) {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, path.join(__dirname, "..", "scripts", "migrate-saved-jobs.ts"), ...args], {
          cwd: process.cwd(),
          shell: false,
          env: process.env
        });
        let text = "";
        child.stdout?.on("data", (chunk) => (text += chunk));
        child.stderr?.on("data", (chunk) => (text += chunk));
        child.on("exit", (code) => (code === 0 ? resolve(text) : reject(new Error(`migrate-saved-jobs ${args.join(" ")} salió con ${code}: ${text}`))));
      });
      assert.match(output, args.length ? /--dry-run: no se escribió nada\. user_saved_jobs ya existe/ : /OK — user_saved_jobs lista; RLS activo/);
    }
    console.log("✅ [PASSED] scripts/migrate-saved-jobs.ts: dry-run no escribe y re-ejecutar es seguro.");

    console.log("\n🎉 [TEST SUITE PASSED] Vacantes guardadas verificadas.\n");
  } finally {
    server.kill("SIGTERM");
    await pool.query(`DELETE FROM user_saved_jobs WHERE user_id = ANY($1)`, [[USER_ID, OTHER_USER_ID]]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER_ID, OTHER_USER_ID]]);
    await pool.query(`DELETE FROM jobs WHERE url LIKE $1`, [`${TEST_URL_PREFIX}%`]);
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("❌ [FAILED]", err?.stack || err?.message || err);
    process.exit(1);
  }
);
