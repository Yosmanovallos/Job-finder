import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import type { Job, SourceAdapter } from "../src/sources/types.js";
import type { SourceRunResult } from "../src/queue/scrape-worker.js";

/**
 * P3 integration checks (openspec/changes/p3-execution-deadlines).
 * Runs against the disposable PostgreSQL of the isolated runner — never
 * production. Covers the requirements that need a real database:
 * EXE-005 (no data loss on abort), EXE-006 (bounded close), EXE-007 (atomic
 * claim), EXE-008 (manual rescan vs. live lease), EXE-009 (partial report).
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });

// Every adapter imports src/index.ts, which exits at import time without
// Notion settings. Synthetic values never reach the network: the isolated
// runner blocks every TCP connection except the disposable database.
process.env.NOTION_TOKEN = "p3-synthetic-notion-token";
process.env.NOTION_DATABASE_ID = "p3-synthetic-notion-database";

const { ScrapeWorker } = await import("../src/queue/scrape-worker.js");
const { RunRecorder } = await import("../src/observability/run-telemetry.js");
const { createPgRunStore } = await import("../src/db/run-repository.js");
const { BUDGET_ESTIMATES, createFetchContext } = await import("../src/engine/fetch-context.js");
const { claimLease, refreshLeases, releaseLease, releaseRunLeases } = await import("../src/db/scrape-leases.js");
const { markRoleForImmediateRescan, markRoleSourceRun } = await import("../src/db/scheduler-repository.js");
const { planTickBudget } = await import("../src/queue/tick-budget.js");
const { pool: appPool } = await import("../src/db/client.js");

let sequence = 0;
function syntheticJob(source: string): Job {
  sequence += 1;
  return {
    jobId: `p3-${sequence}`,
    title: `Ingeniero sintético P3 ${sequence}`,
    company: "Empresa Sintética P3",
    location: "Bogotá",
    url: `https://jobs.example.test/p3/${sequence}`,
    dateText: "Hoy",
    source,
    publishedAt: new Date().toISOString()
  };
}

/** Adapter that takes `fetchMs` to answer, then returns `count` jobs. */
function slowAdapter(name: string, fetchMs: number, count: number): SourceAdapter {
  return {
    name,
    async fetch(): Promise<Job[]> {
      await delay(fetchMs);
      return Array.from({ length: count }, () => syntheticJob(name));
    }
  } as SourceAdapter;
}

async function newRun(country = "CO") {
  return RunRecorder.start({
    workflow: "scrape-tick",
    country,
    store: createPgRunStore(),
    env: { ...process.env, JOB_RADAR_TEST_MODE: "integration" }
  });
}

try {
  // --- EXE-007: additive, idempotent migration (must run first: every
  // check below needs the table it creates) ---------------------------
  // Same guard P2 applies to its own block: a phase may only ADD to the
  // schema, and running its block twice must be a no-op.
  {
    const schema = await readFile(path.join(root, "src/db/schema.sql"), "utf8");
    const block = /-- BEGIN p3-execution-deadlines\r?\n([\s\S]*?)-- END p3-execution-deadlines/.exec(schema)?.[1];
    assert.ok(block, "schema.sql debe contener el bloque p3-execution-deadlines");
    assert.doesNotMatch(
      block!,
      /\bDROP\b|\bTRUNCATE\b|DELETE FROM|ALTER TABLE (?!scrape_leases)/i,
      "the P3 block must be purely additive"
    );
    await pool.query(block!);
    await pool.query(block!);

    const rls = await pool.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'scrape_leases'`
    );
    assert.equal(rls.rows[0]?.relrowsecurity, true, "scrape_leases must have RLS enabled");
    console.log("[EXE-007] Bloque de esquema aditivo, idempotente y con RLS activo.");
  }

  // --- EXE-007: atomic claim -------------------------------------------
  {
    const runA = await newRun();
    const runB = await newRun();
    const role = `p3-role-${randomUUID().slice(0, 8)}`;

    const results = await Promise.all([
      claimLease({ roleName: role, sourceName: "Torre", runId: runA.runId, country: "CO", budgetMs: 60_000 }),
      claimLease({ roleName: role, sourceName: "Torre", runId: runB.runId, country: "CO", budgetMs: 60_000 })
    ]);
    assert.equal(results.filter(Boolean).length, 1, "exactly one of two concurrent claims may win");

    // A live claim is not stealable.
    assert.equal(
      await claimLease({ roleName: role, sourceName: "Torre", runId: runB.runId, country: "CO", budgetMs: 60_000 }),
      false,
      "a live lease cannot be taken by another run"
    );

    // An expired claim (dead process) is reclaimable with no manual step.
    await pool.query(`UPDATE scrape_leases SET expires_at = NOW() - INTERVAL '1 minute' WHERE role_name = $1`, [role]);
    assert.equal(
      await claimLease({ roleName: role, sourceName: "Torre", runId: runB.runId, country: "CO", budgetMs: 60_000 }),
      true,
      "an expired lease must be reclaimable by the next tick"
    );

    // The heartbeat extends only this run's leases.
    const before = await pool.query(`SELECT expires_at FROM scrape_leases WHERE role_name = $1`, [role]);
    await delay(50);
    const refreshed = await refreshLeases(runB.runId, 120_000);
    assert.equal(refreshed, 1);
    const after = await pool.query(`SELECT expires_at FROM scrape_leases WHERE role_name = $1`, [role]);
    assert.ok(
      new Date(after.rows[0].expires_at).getTime() > new Date(before.rows[0].expires_at).getTime(),
      "the heartbeat must extend a live lease"
    );

    await releaseLease(role, "Torre", runB.runId);
    const gone = await pool.query(`SELECT 1 FROM scrape_leases WHERE role_name = $1`, [role]);
    assert.equal(gone.rowCount, 0, "releasing must free the pair immediately");

    await runA.finish();
    await runB.finish();
    console.log("[EXE-007] Reclamación atómica: una sola gana, la caducada se recupera sola, el latido extiende.");
  }

  // --- EXE-008: manual rescan must not free a live lease -----------------
  {
    const run = await newRun();
    const role = `p3-rescan-${randomUUID().slice(0, 8)}`;
    await markRoleSourceRun(role, "Torre");
    assert.equal(
      await claimLease({ roleName: role, sourceName: "Torre", runId: run.runId, country: "CO", budgetMs: 60_000 }),
      true
    );

    // The authenticated rescan endpoint (src/server.ts) does exactly this.
    await markRoleForImmediateRescan(role);

    const cadenceGone = await pool.query(`SELECT 1 FROM role_source_runs WHERE role_name = $1`, [role]);
    assert.equal(cadenceGone.rowCount, 0, "rescan must still clear the cadence row");

    const leaseAlive = await pool.query(`SELECT 1 FROM scrape_leases WHERE role_name = $1`, [role]);
    assert.equal(leaseAlive.rowCount, 1, "a manual rescan must NOT free a lease held by a live scrape");

    // This is the whole reason the lease lives in its own table: had it been
    // columns on role_source_runs, the DELETE above would have dropped it and
    // a second tick could scrape the same pair concurrently.
    const other = await newRun();
    assert.equal(
      await claimLease({ roleName: role, sourceName: "Torre", runId: other.runId, country: "CO", budgetMs: 60_000 }),
      false,
      "the pair must stay protected across a manual rescan"
    );

    await releaseRunLeases(run.runId);
    await run.finish();
    await other.finish();
    console.log("[EXE-008] El rescan manual borra la cadencia pero nunca un lease vivo.");
  }

  // --- EXE-005 + EXE-009: nothing fetched is lost, partial work is reported ---
  //
  // Budget is set just above ONE source's estimate (BUDGET_ESTIMATES
  // .sourceListing), so the first source starts and persists in full while
  // the second is refused for lack of budget. That is the realistic shape of
  // a tick running out of room: it stops at a source boundary, which is the
  // cheapest place to stop. The abort-DURING-a-persist ordering is covered
  // by the unit test (validate-fetch-context.test.ts, EXE-005), where it can
  // be exercised without waiting out a 30s budget.
  {
    const run = await newRun();
    const worker = new ScrapeWorker(1);
    const plan = planTickBudget({ totalMs: 20 * 60_000, roleCount: 8, concurrency: 2 });
    assert.ok(plan.globalCatalogMs + plan.batchCount * plan.maxPerBatchMs <= plan.workMs);

    const perSource: Record<string, SourceRunResult> = {};
    // Only 300ms of slack above one source's estimate: the first source fits,
    // and the time it actually spends is what pushes the second below the bar.
    const ctx = createFetchContext(BUDGET_ESTIMATES.sourceListing + 300);
    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM jobs`);

    await worker.processRoleJob({
      roleName: `p3-abort-${randomUUID().slice(0, 8)}`,
      adapters: [slowAdapter("Torre", 1_500, 3), slowAdapter("Magneto", 200, 5)],
      country: "CO",
      recorder: run,
      ctx,
      perSourceSink: perSource
    });

    assert.equal(ctx.hasBudgetFor(BUDGET_ESTIMATES.sourceListing), false,
      "after the first source there must be no room left for another");

    const after = await pool.query(`SELECT COUNT(*)::int AS n FROM jobs`);
    assert.equal(after.rows[0].n - before.rows[0].n, 3,
      "every job fetched before the deadline must be persisted — cancelling a persist is the 2026-07-25 data-loss bug");

    // EXE-009: the completed source is still reported even though the role
    // ran out of budget. Before P3 this map came back empty on timeout.
    assert.ok(perSource.Torre, "a source completed before the deadline must still be reported");
    assert.equal(perSource.Torre.fetched, 3);
    assert.equal(perSource.Magneto, undefined, "a source never started must not be invented as a result");

    ctx.dispose();
    await run.finish();
    console.log("[EXE-005/EXE-009] Lo obtenido se guarda y se informa; lo no iniciado no se inventa.");
  }

  // --- EXE-005: a persist already under way is never cut ------------------
  {
    const run = await newRun();
    const worker = new ScrapeWorker(1);
    // Already expired before the source even starts.
    const ctx = createFetchContext(0);
    const perSource: Record<string, SourceRunResult> = {};
    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM jobs`);

    await worker.processRoleJob({
      roleName: `p3-expired-${randomUUID().slice(0, 8)}`,
      adapters: [slowAdapter("Torre", 10, 4)],
      country: "CO",
      recorder: run,
      ctx,
      perSourceSink: perSource
    });

    const after = await pool.query(`SELECT COUNT(*)::int AS n FROM jobs`);
    assert.equal(after.rows[0].n, before.rows[0].n, "an expired budget must not start the source at all");
    assert.equal(Object.keys(perSource).length, 0, "nothing started, nothing reported");

    ctx.dispose();
    await run.finish();
    console.log("[EXE-003/EXE-005] Con el plazo ya vencido no se inicia ninguna fuente.");
  }

  // --- EXE-006: the run closes itself, leases included --------------------
  {
    const run = await newRun();
    const role = `p3-close-${randomUUID().slice(0, 8)}`;
    await claimLease({ roleName: role, sourceName: "Torre", runId: run.runId, country: "CO", budgetMs: 60_000 });
    await claimLease({ roleName: role, sourceName: "Magneto", runId: run.runId, country: "CO", budgetMs: 60_000 });

    const released = await releaseRunLeases(run.runId);
    assert.equal(released, 2, "closing a run must release everything it still holds");

    const summary = await run.finish();
    assert.ok(summary.runId);
    const row = await pool.query(`SELECT status FROM scrape_runs WHERE id = $1::uuid`, [run.runId]);
    assert.notEqual(row.rows[0]?.status, "running", "a finished run must not be left running");
    console.log("[EXE-006] La ejecución se cierra sola y libera sus leases.");
  }

  console.log("\n✅ P3: plazos, cancelación y coordinación verificados contra PostgreSQL desechable.");
} finally {
  await appPool.end();
  await pool.end();
}
