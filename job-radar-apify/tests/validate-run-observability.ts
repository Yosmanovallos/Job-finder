import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import type { Job, SourceAdapter } from "../src/sources/types.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.TEST_HTTP_PORT);
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = `p2-operator-${"x".repeat(40)}`;
const githubRunId = "424242424242";
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });

// Every adapter imports src/index.ts, which exits at import time without
// Notion settings. Synthetic values never reach the network: the isolated
// runner blocks every TCP connection except the disposable database.
process.env.NOTION_TOKEN = "p2-synthetic-notion-token";
process.env.NOTION_DATABASE_ID = "p2-synthetic-notion-database";
delete process.env.JOOBLE_API_KEY;

const { ScrapeWorker } = await import("../src/queue/scrape-worker.js");
const { RunRecorder } = await import("../src/observability/run-telemetry.js");
const { createPgRunStore, reconcileStaleRuns, purgeOldRuns } = await import("../src/db/run-repository.js");
const { executeWithResilience, FetchBlockedError } = await import("../src/engine/resilient-fetch.js");
const { joobleAdapter } = await import("../src/sources/jooble.js");
const { pool: appPool } = await import("../src/db/client.js");

let sequence = 0;
function syntheticJob(source = "Torre"): Job {
  sequence += 1;
  return {
    jobId: `p2-${sequence}`,
    title: `Ingeniero sintético P2 ${sequence}`,
    company: "Empresa Sintética P2",
    location: "Bogotá",
    url: `https://jobs.example.test/p2/${sequence}`,
    dateText: "Hoy",
    source,
    publishedAt: new Date().toISOString()
  };
}

async function scalar(sql: string, params: unknown[] = []): Promise<unknown> {
  const result = await pool.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

function startServer(): ChildProcess {
  return spawn(process.execPath, [...process.execArgv, path.join(root, "src/server.ts")], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), OPS_ADMIN_TOKEN: adminToken },
    shell: false,
    stdio: "inherit"
  });
}

async function waitForServer(server: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`El servidor terminó con código ${server.exitCode}.`);
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // Cold tsx startup may take several seconds.
    }
    await delay(250);
  }
  throw new Error("El servidor no inició dentro del presupuesto.");
}

const admin = { Authorization: `Bearer ${adminToken}` };
const store = createPgRunStore();
let server: ChildProcess | undefined;

try {
  // --- OBS-007: migration not applied yet → jobs and cadence still saved ---
  assert.equal(await scalar(`SELECT to_regclass('public.scrape_runs')::text`), null);
  const offlineRecorder = await RunRecorder.start({ workflow: "scrape-tick", country: "CO", store, env: {} });
  const offlineJobs = [syntheticJob(), syntheticJob()];
  const offline = await new ScrapeWorker(1).processRoleJob({
    roleName: "QA Engineer",
    country: "CO",
    recorder: offlineRecorder,
    adapters: [{ name: "P2-Offline", fetch: async () => offlineJobs }]
  });
  const offlineSummary = await offlineRecorder.finish();
  assert.equal(offline.savedCount, 2);
  assert.equal(offline.perSource["P2-Offline"].status, "success");
  assert.equal(offlineSummary.telemetryEnabled, false);
  assert.equal(await scalar(`SELECT COUNT(*)::int FROM jobs WHERE url = ANY($1)`, [offlineJobs.map((job) => job.url)]), 2);
  assert.equal(await scalar(`SELECT COUNT(*)::int FROM role_source_runs WHERE role_name = 'QA Engineer' AND source_name = 'P2-Offline'`), 1);
  console.log("[OBS-007] Sin tablas de telemetría, el worker guardó las vacantes y la cadencia.");

  // --- OBS-011: real schema.sql block, applied twice, RLS + REVOKE ---
  const schema = await readFile(path.join(root, "src/db/schema.sql"), "utf8");
  const block = /-- BEGIN p2-run-observability\r?\n([\s\S]*?)-- END p2-run-observability/.exec(schema)?.[1];
  assert.ok(block, "schema.sql debe contener el bloque p2-run-observability");
  assert.doesNotMatch(block, /\bDROP\b|\bTRUNCATE\b|DELETE FROM|ALTER TABLE (?!scrape_runs|source_attempts)/i, "the P2 block must be purely additive");
  await pool.query(block);
  await pool.query(block);
  const rls = await pool.query<{ relname: string; relrowsecurity: boolean }>(
    `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('scrape_runs', 'source_attempts') ORDER BY relname`
  );
  assert.deepEqual(rls.rows, [{ relname: "scrape_runs", relrowsecurity: true }, { relname: "source_attempts", relrowsecurity: true }]);
  const revoked = /REVOKE ALL ON([\s\S]*?)FROM anon, authenticated;/.exec(schema)?.[1] ?? "";
  assert.match(revoked, /\bscrape_runs\b/);
  assert.match(revoked, /\bsource_attempts\b/);
  console.log("[OBS-011] Migración aditiva idempotente, RLS habilitado y REVOKE declarado.");

  // --- OBS-001/002/003: every emitted status from real code paths ---
  await pool.query(`INSERT INTO source_circuit_state (source_name, failures, open_until) VALUES ('P2-Open', 3, NOW() + INTERVAL '1 hour')`);
  const recorder = await RunRecorder.start({
    workflow: "scrape-tick",
    country: "CO",
    store,
    env: {
      GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "schedule", GITHUB_SHA: "b".repeat(40),
      GITHUB_REPOSITORY: "owner/job-finder", GITHUB_WORKFLOW: "Job Radar Scraper Tick",
      GITHUB_RUN_ID: githubRunId, GITHUB_RUN_ATTEMPT: "1"
    }
  });
  const adapters: SourceAdapter[] = [
    { name: "P2-Ok", fetch: async () => [syntheticJob(), syntheticJob()] },
    { name: "P2-Dup", fetch: async () => offlineJobs },
    { name: "P2-Empty", fetch: async () => [] },
    { name: "P2-Blocked", fetch: () => executeWithResilience("P2-Blocked", async (): Promise<Job[]> => { throw new FetchBlockedError("P2-Blocked", 403); }) },
    { name: "P2-Open", fetch: () => executeWithResilience("P2-Open", async () => [syntheticJob()]) },
    { name: "P2-Retries", fetch: () => executeWithResilience("P2-Retries", async (): Promise<Job[]> => { throw new Error("upstream 500 https://secret.example/key"); }, 2) },
    { name: "P2-Throws", fetch: async () => { throw new Error("adapter exploded https://secret.example/key"); } },
    { name: "Jooble", fetch: (keywords, dateRange) => joobleAdapter.fetch(keywords, dateRange) },
    { name: "P2-Invalid", fetch: async () => [syntheticJob("NotARealSource")] },
    {
      name: "P2-Partial",
      fetch: async () => [
        ...(await executeWithResilience("P2-Partial-a", async () => [syntheticJob()])),
        ...(await executeWithResilience("P2-Partial-b", async (): Promise<Job[]> => { throw new FetchBlockedError("P2-Partial-b", 403); }))
      ]
    },
    {
      name: "P2-Detail",
      fetch: async () => [syntheticJob()],
      fetchDetail: async () => ({ description: "Descripción sintética P2 obtenida de la página de detalle." })
    }
  ];
  const result = await new ScrapeWorker(1).processRoleJob({ roleName: "QA Engineer", country: "CO", recorder, adapters });
  const expectedStatuses: Record<string, string> = {
    "P2-Ok": "success", "P2-Dup": "success", "P2-Empty": "empty", "P2-Blocked": "blocked", "P2-Open": "skipped",
    "P2-Retries": "failed", "P2-Throws": "failed", Jooble: "misconfigured", "P2-Invalid": "failed",
    "P2-Partial": "partial", "P2-Detail": "success"
  };
  for (const [source, status] of Object.entries(expectedStatuses)) {
    assert.equal(result.perSource[source]?.status, status, source);
  }
  assert.equal(result.perSource["P2-Throws"].error, "adapter exploded https://secret.example/key", "the worker keeps its original error");
  const summary = await recorder.finish();
  assert.equal(summary.status, "partial");
  assert.equal(summary.telemetryEnabled, true);

  const attempts = await pool.query(
    `SELECT source_name, role_name, stage, status, reason, error_class, received_count, valid_count, filtered_count,
            new_count, duplicate_count, failed_count, request_count, bytes_received, cost_usd, duration_ms, finished_at
       FROM source_attempts WHERE run_id = $1`,
    [recorder.runId]
  );
  assert.equal(attempts.rowCount, 12);
  const byKey = new Map(attempts.rows.map((row) => [`${row.source_name}/${row.stage}`, row]));
  const row = (key: string) => {
    const found = byKey.get(key);
    assert.ok(found, key);
    return found;
  };
  assert.deepEqual(
    Object.fromEntries([...byKey.entries()].map(([key, value]) => [key, `${value.status}/${value.reason}`])),
    {
      "P2-Ok/listing": "success/ok", "P2-Dup/listing": "success/ok", "P2-Empty/listing": "empty/no_results",
      "P2-Blocked/listing": "blocked/http_deny", "P2-Open/listing": "skipped/circuit_open",
      "P2-Retries/listing": "failed/retries_exhausted", "P2-Throws/listing": "failed/exception",
      "Jooble/listing": "misconfigured/missing_credentials", "P2-Invalid/listing": "failed/all_rejected_by_validation",
      "P2-Partial/listing": "partial/http_deny", "P2-Detail/listing": "success/ok", "P2-Detail/detail": "success/ok"
    }
  );
  assert.deepEqual(
    [row("P2-Ok/listing").received_count, row("P2-Ok/listing").valid_count, row("P2-Ok/listing").filtered_count, row("P2-Ok/listing").new_count, row("P2-Ok/listing").duplicate_count],
    [2, 2, 0, 2, 0]
  );
  assert.deepEqual([row("P2-Dup/listing").new_count, row("P2-Dup/listing").duplicate_count], [0, 2]);
  assert.deepEqual([row("P2-Invalid/listing").received_count, row("P2-Invalid/listing").valid_count, row("P2-Invalid/listing").filtered_count], [1, 0, 1]);
  assert.equal(row("P2-Retries/listing").request_count, 2);
  assert.equal(row("P2-Open/listing").request_count, 0);
  assert.equal(row("P2-Throws/listing").error_class, "Error");
  assert.deepEqual([row("P2-Detail/detail").received_count, row("P2-Detail/detail").valid_count, row("P2-Detail/detail").filtered_count, row("P2-Detail/detail").failed_count], [1, 1, 0, 0]);
  assert.equal(row("P2-Ok/listing").role_name, "QA Engineer");
  assert.equal(row("P2-Ok/listing").bytes_received, null, "bytes are never invented");
  assert.equal(row("P2-Ok/listing").cost_usd, null, "cost is never invented");
  assert.ok(attempts.rows.every((attempt) => attempt.finished_at && attempt.duration_ms >= 0));
  assert.ok(!JSON.stringify(attempts.rows).includes("secret.example"), "raw error messages are never persisted");

  const run = (await pool.query(`SELECT * FROM scrape_runs WHERE id = $1`, [recorder.runId])).rows[0];
  assert.deepEqual(
    [run.workflow, run.trigger, run.is_test, run.country, run.git_sha, run.gh_repository, run.gh_workflow, run.gh_run_id, run.gh_run_attempt, run.status, run.reason],
    ["scrape-tick", "schedule", false, "CO", "b".repeat(40), "owner/job-finder", "Job Radar Scraper Tick", githubRunId, 1, "partial", "some_sources_degraded"]
  );
  // received: Ok 2 + Dup 2 + Invalid 1 + Partial 1 + Detail 1.
  assert.deepEqual([run.attempts_total, run.jobs_received, run.jobs_new, run.jobs_duplicate], [12, 7, 4, 2]);
  assert.ok(run.finished_at);
  console.log("[OBS-001/002/003] Ejecución correlacionada y 12 intentos clasificados sin éxitos vacíos falsos.");

  // --- OBS-006: deadline reached with work in flight; the straggler keeps saving ---
  const timeoutRecorder = await RunRecorder.start({ workflow: "scrape-tick", country: "VE", store, env: {} });
  let release!: (jobs: Job[]) => void;
  const pending = new ScrapeWorker(1).processRoleJob({
    roleName: "Scrum Master",
    country: "VE",
    recorder: timeoutRecorder,
    adapters: [{ name: "P2-Hang", fetch: () => new Promise<Job[]>((resolve) => { release = resolve; }) }]
  });
  await delay(100);
  const timeoutSummary = await timeoutRecorder.finish();
  assert.deepEqual([timeoutSummary.status, timeoutSummary.reason], ["timeout", "deadline_exceeded"]);
  release([syntheticJob()]);
  const late = await pending;
  assert.equal(late.savedCount, 1, "a straggler still persists its jobs");
  assert.equal(late.perSource["P2-Hang"].status, "timeout");
  await delay(200);
  const hang = await pool.query(`SELECT status, reason FROM source_attempts WHERE run_id = $1`, [timeoutRecorder.runId]);
  assert.deepEqual(hang.rows, [{ status: "timeout", reason: "deadline_exceeded" }]);
  assert.equal(await scalar(`SELECT status FROM scrape_runs WHERE id = $1`, [timeoutRecorder.runId]), "timeout");
  console.log("[OBS-006] Intento en curso cerrado como timeout; el rezagado guardó sin sobrescribir el estado.");

  // --- OBS-005: a dead process is reconciled once and never revived ---
  const deadRecorder = await RunRecorder.start({ workflow: "browser-tick", country: null, store, env: {} });
  void deadRecorder.trackAttempt({ source: "Glassdoor-CO", role: null, stage: "listing" }, () => new Promise<never>(() => {}));
  await delay(200);
  await pool.query(`UPDATE scrape_runs SET heartbeat_at = date_trunc('milliseconds', NOW() - INTERVAL '20 minutes') WHERE id = $1`, [deadRecorder.runId]);
  assert.deepEqual(await reconcileStaleRuns(), { runs: 1, attempts: 1 });
  assert.deepEqual(await reconcileStaleRuns(), { runs: 0, attempts: 0 });
  await store.finishRun({ id: deadRecorder.runId, status: "success", reason: "ok", finishedAt: new Date(), totals: { attempts: 1, received: 9, new: 9, duplicate: 0 } });
  await store.heartbeatRun(deadRecorder.runId);
  const dead = (await pool.query(`SELECT status, reason, reconciled_at, finished_at FROM scrape_runs WHERE id = $1`, [deadRecorder.runId])).rows[0];
  assert.deepEqual([dead.status, dead.reason], ["interrupted", "heartbeat_expired"]);
  assert.ok(dead.reconciled_at && dead.finished_at);
  assert.deepEqual(
    (await pool.query(`SELECT status, reason FROM source_attempts WHERE run_id = $1`, [deadRecorder.runId])).rows,
    [{ status: "interrupted", reason: "run_interrupted" }]
  );
  console.log("[OBS-005] Ejecución muerta reconciliada una vez; estado terminal no sobrescrito.");

  // --- OBS-012: retention ---
  const oldRunId = randomUUID();
  await pool.query(
    `INSERT INTO scrape_runs (id, workflow, trigger, status, started_at, heartbeat_at, finished_at)
     VALUES ($1, 'scrape-tick', 'schedule', 'success', NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days')`,
    [oldRunId]
  );
  await pool.query(
    `INSERT INTO source_attempts (id, run_id, source_name, stage, status, started_at) VALUES ($1, $2, 'Torre', 'listing', 'success', NOW() - INTERVAL '40 days')`,
    [randomUUID(), oldRunId]
  );
  assert.equal(await purgeOldRuns(), 1);
  assert.equal(await scalar(`SELECT COUNT(*)::int FROM source_attempts WHERE run_id = $1`, [oldRunId]), 0);
  assert.equal(await scalar(`SELECT COUNT(*)::int FROM scrape_runs WHERE id = $1`, [recorder.runId]), 1, "recent runs are kept");
  console.log("[OBS-012] Retención de 30 días con cascada sobre intentos.");

  // --- OBS-010: runs under the isolated test environment are marked ---
  const testRecorder = await RunRecorder.start({ workflow: "scrape-tick", country: "CO", store });
  await testRecorder.trackAttempt({ source: "Torre", role: "QA Engineer", stage: "listing" }, async (attempt) => attempt.setCounters({ received: 0 }));
  await testRecorder.finish();
  assert.deepEqual(
    Object.values((await pool.query(`SELECT trigger, is_test FROM scrape_runs WHERE id = $1`, [testRecorder.runId])).rows[0]),
    ["test", true]
  );

  // A run that died and was not reconciled yet: reads must show it interrupted.
  const staleRunId = randomUUID();
  await pool.query(
    `INSERT INTO scrape_runs (id, workflow, trigger, status, country, started_at, heartbeat_at)
     VALUES ($1, 'scrape-tick', 'schedule', 'running', 'VE',
             date_trunc('milliseconds', NOW() - INTERVAL '30 minutes'), date_trunc('milliseconds', NOW() - INTERVAL '25 minutes'))`,
    [staleRunId]
  );
  await pool.query(
    `INSERT INTO source_attempts (id, run_id, source_name, role_name, stage, status, started_at)
     VALUES ($1, $2, 'LinkedIn-VE', 'Scrum Master', 'listing', 'running', date_trunc('milliseconds', NOW() - INTERVAL '29 minutes'))`,
    [randomUUID(), staleRunId]
  );

  // --- OBS-008/009 against the real HTTP server ---
  server = startServer();
  await waitForServer(server);

  const publicResponse = await fetch(`${baseUrl}/api/runs`);
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.headers.get("cache-control"), "no-store");
  const publicBody = await publicResponse.json();
  assert.equal(publicBody.count, publicBody.runs.length);
  assert.deepEqual(
    publicBody.runs.map((entry: { id: string }) => entry.id),
    [deadRecorder.runId, timeoutRecorder.runId, recorder.runId, staleRunId]
  );
  for (const entry of publicBody.runs) {
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.name, "string");
    assert.equal(typeof entry.count, "number");
    assert.deepEqual(Object.keys(entry).sort(), ["attempts", "count", "country", "finishedAt", "id", "jobs", "name", "reason", "startedAt", "status", "workflow"]);
  }
  const publicMain = publicBody.runs.find((entry: { id: string }) => entry.id === recorder.runId);
  assert.deepEqual([publicMain.status, publicMain.count, publicMain.jobs.new, publicMain.attempts.total, publicMain.attempts.byStatus.blocked], ["partial", 7, 4, 12, 1]);
  assert.match(publicMain.name, /^scrape-tick CO · \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/);
  const publicStale = publicBody.runs.find((entry: { id: string }) => entry.id === staleRunId);
  assert.deepEqual([publicStale.status, publicStale.reason, publicStale.attempts.byStatus], ["interrupted", "heartbeat_expired", { interrupted: 1 }]);
  const serialized = JSON.stringify(publicBody);
  for (const leak of ["QA Engineer", "Scrum Master", "b".repeat(40), `"${githubRunId}"`, "owner/job-finder", "Error", testRecorder.runId]) {
    assert.ok(!serialized.includes(leak), `public response leaked ${leak}`);
  }
  assert.equal(await scalar(`SELECT status FROM scrape_runs WHERE id = $1`, [staleRunId]), "running", "reads never write");

  const firstPage = await (await fetch(`${baseUrl}/api/runs?limit=2`)).json();
  assert.equal(firstPage.runs.length, 2);
  assert.ok(firstPage.nextCursor);
  const secondPage = await (await fetch(`${baseUrl}/api/runs?limit=2&before=${encodeURIComponent(firstPage.nextCursor)}`)).json();
  assert.deepEqual([...firstPage.runs, ...secondPage.runs].map((entry: { id: string }) => entry.id), publicBody.runs.map((entry: { id: string }) => entry.id));
  assert.equal(secondPage.nextCursor, null);
  assert.equal((await fetch(`${baseUrl}/api/runs?before=not-a-cursor`)).status, 400);
  console.log("[OBS-008] /api/runs compatible, paginado, sin datos operativos ni ejecuciones de prueba.");

  assert.equal((await fetch(`${baseUrl}/api/admin/runs`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/admin/runs`, { headers: { Authorization: `Bearer ${adminToken}x` } })).status, 401);
  const adminList = await fetch(`${baseUrl}/api/admin/runs?includeTest=true`, { headers: admin });
  assert.equal(adminList.status, 200);
  const adminBody = await adminList.json();
  assert.ok(adminBody.runs.some((entry: { id: string; isTest: boolean }) => entry.id === testRecorder.runId && entry.isTest));
  const adminMain = adminBody.runs.find((entry: { id: string }) => entry.id === recorder.runId);
  assert.deepEqual(adminMain.actions, {
    repository: "owner/job-finder", workflow: "Job Radar Scraper Tick", runId: githubRunId, runAttempt: 1,
    url: `https://github.com/owner/job-finder/actions/runs/${githubRunId}/attempts/1`
  });
  assert.deepEqual([adminMain.trigger, adminMain.gitSha], ["schedule", "b".repeat(40)]);
  const adminDefault = await (await fetch(`${baseUrl}/api/admin/runs`, { headers: admin })).json();
  assert.ok(!adminDefault.runs.some((entry: { id: string }) => entry.id === testRecorder.runId));

  const collected: { source: string; stage: string; status: string; role: string | null; errorClass: string | null }[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const query: string = cursor ? `&after=${encodeURIComponent(cursor)}` : "";
    const detailResponse: Response = await fetch(`${baseUrl}/api/admin/runs/${recorder.runId}?limit=5${query}`, { headers: admin });
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.ok(detail.attempts.length <= 5);
    collected.push(...detail.attempts);
    cursor = detail.nextCursor;
    if (!cursor) break;
  }
  assert.equal(collected.length, 12);
  assert.equal(new Set(collected.map((attempt) => `${attempt.source}/${attempt.stage}`)).size, 12);
  assert.equal(collected.find((attempt) => attempt.source === "P2-Throws")?.errorClass, "Error");
  const staleDetail = await (await fetch(`${baseUrl}/api/admin/runs/${staleRunId}`, { headers: admin })).json();
  assert.deepEqual(staleDetail.attempts.map((attempt: { status: string }) => attempt.status), ["interrupted"]);
  assert.equal((await fetch(`${baseUrl}/api/admin/runs/not-a-uuid`, { headers: admin })).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/admin/runs/${randomUUID()}`, { headers: admin })).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/admin/runs/${recorder.runId}?after=bad`, { headers: admin })).status, 400);
  console.log("[OBS-009] Vista admin autenticada, correlación con Actions e intentos paginados.");

  await pool.query(`ALTER TABLE source_attempts RENAME TO source_attempts_p2_hidden`);
  try {
    const failing = await fetch(`${baseUrl}/api/runs`);
    assert.equal(failing.status, 503);
    const failingBody = await failing.json();
    assert.ok(failingBody.error);
    assert.equal("runs" in failingBody, false, "a failed read is never an empty success");
  } finally {
    await pool.query(`ALTER TABLE source_attempts_p2_hidden RENAME TO source_attempts`);
  }
  console.log("[OBS-008] Fallo de base de datos → 503, nunca historial vacío.");
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server?.once("exit", resolve));
    server.kill();
    await Promise.race([exited, delay(5000)]);
  }
  await appPool.end();
  await pool.end();
}
