import fs from "fs";
import dotenv from "dotenv";
import { allAdapters, SourceAdapter } from "../src/sources/index.js";
import {
  SOURCE_CADENCE_MS,
  GLOBAL_SOURCE_CADENCE_MS,
  SOURCE_CADENCE_MS_VE,
  GLOBAL_SOURCE_CADENCE_MS_VE
} from "../src/queue/source-cadence.js";
import { DEFAULT_ROLES_200 } from "../src/queue/scheduler.js";
import { ScrapeWorker, type SourceRunResult } from "../src/queue/scrape-worker.js";
import { runListingAttempt } from "../src/queue/listing-attempt.js";
import { RunRecorder, runTelemetrySafely } from "../src/observability/run-telemetry.js";
import { createPgRunStore, purgeOldRuns, reconcileStaleRuns } from "../src/db/run-repository.js";
import { resolveJobCountry } from "../src/countries/index.js";
import {
  seedSearchRoles,
  getDueRoleSources,
  getDueGlobalSources,
  markGlobalSourceRun,
  purgeOldJobs
} from "../src/db/scheduler-repository.js";
import { pool } from "../src/db/client.js";
import { createFetchContext, isCancelled, type FetchContext } from "../src/engine/fetch-context.js";
import { planTickBudget, type TickBudgetPlan } from "../src/queue/tick-budget.js";
import { claimLease, refreshLeases, releaseLease, releaseRunLeases } from "../src/db/scrape-leases.js";

dotenv.config();

// Which country this tick run is for — see .github/workflows/scrape-jobs.yml
// (unset, so this defaults to "CO", zero behavior change) vs.
// scrape-jobs-ve.yml (sets TICK_COUNTRY=VE). Selects both the per-role and
// global-catalog cadence maps below, so a VE run's due-check can never touch
// a CO source's role_source_runs/source_circuit_state row and vice versa —
// see source-cadence.ts's SOURCE_CADENCE_MS_VE comment for why that
// isolation matters.
const TICK_COUNTRY = (process.env.TICK_COUNTRY || "CO").toUpperCase();
const ROLE_CADENCE_MS = TICK_COUNTRY === "VE" ? SOURCE_CADENCE_MS_VE : SOURCE_CADENCE_MS;
const GLOBAL_CADENCE_MS =
  TICK_COUNTRY === "VE" ? GLOBAL_SOURCE_CADENCE_MS_VE : GLOBAL_SOURCE_CADENCE_MS;

// One-shot tick meant to be invoked on a schedule (e.g. GitHub Actions every
// 15 min) — unlike the old in-process cron, this never retries a timed-out
// role itself. A role that times out this run simply stays "due" (its
// role_source_runs row never gets updated) and gets picked up by the very
// next scheduled invocation. That statelessness is what makes it safe to
// run as a fresh process every time instead of a long-lived server.
const MAX_ROLES_PER_RUN = 8;
const CONCURRENCY = 2;

// P3 (openspec p3-execution-deadlines, spec EXE-002/EXE-006).
//
// Before this phase the tick's timeouts were independent constants that did
// not fit inside each other:
//
//     global catalog  3 min
//     4 batches x 5 min                        = 20 min
//     ------------------------------------------------
//     permitted work                             23 min
//     OVERALL_DEADLINE_MS                        20 min
//     workflow timeout-minutes                   27 min
//
// With 23 > 20 the straggler wait computed a negative remaining budget,
// skipped itself entirely, and left the process in pool.end() — which blocks
// until stragglers release their clients and had no bound at all. That is
// the stretch that reached 27-28 min and collected GitHub's hard kill (3 of
// the last 12 CO ticks, 25%).
//
// Now the global deadline is the single source of truth and every sub-budget
// is DERIVED from what is actually left (see src/queue/tick-budget.ts), with
// a teardown reserve subtracted before any work budget is handed out.
const OVERALL_DEADLINE_MS = 20 * 60 * 1000;
// Grace for persists already in flight when the work budget ends. Fetches
// are already cancelled by then; this only covers writes that must finish
// (EXE-005). Bounded, unlike the old unbounded pool.end().
const STRAGGLER_GRACE_MS = 60 * 1000;
// Last resort so a stuck client can never be what ends the process.
const POOL_CLOSE_TIMEOUT_MS = 10 * 1000;

// Same sentinel `role_source_runs` already uses for catalog-wide sources
// (see getDueGlobalSources), reused as the lease key so a global source is
// claimed under exactly the identity its cadence is tracked by.
const GLOBAL_LEASE_ROLE = "__global__";

const worker = new ScrapeWorker(CONCURRENCY);
const adapterByName = new Map<string, SourceAdapter>(allAdapters.map((a) => [a.name, a]));

interface RoleResult {
  roleName: string;
  savedCount: number;
  duplicateCount: number;
  perSource: Record<string, SourceRunResult>;
  timedOut: boolean;
}

interface RoleItem {
  roleName: string;
  adapters: SourceAdapter[];
}

/**
 * Runs one role under its own derived budget.
 *
 * P3: the deadline is no longer a `Promise.race` that resolves while the
 * loser keeps scraping. The role gets a child FetchContext, so when its
 * budget ends the work itself stops starting anything new — and `perSource`
 * is a map this function owns and hands back even on timeout, so whatever
 * the role DID complete still gets reported (EXE-009). Previously a timed
 * out role returned `perSource: {}`, which is why Computrabajo, Elempleo and
 * Magneto vanished from run 35031341207's summary despite working fine.
 */
async function runRoleWithBudget(
  item: RoleItem,
  parentCtx: FetchContext,
  budgetMs: number,
  trackedPromises: Promise<any>[],
  recorder: RunRecorder
): Promise<RoleResult> {
  const { roleName, adapters } = item;
  const roleCtx = parentCtx.child(budgetMs);
  // Owned by this function, mutated by the worker as each source completes,
  // so a timeout can never erase finished work from the report.
  const perSource: Record<string, SourceRunResult> = {};

  const workPromise = worker
    .processRoleJob({
      roleName,
      dateRange: "48h",
      adapters,
      country: TICK_COUNTRY,
      recorder,
      ctx: roleCtx,
      perSourceSink: perSource
    })
    .catch((err) => {
      console.error(`❌ [Tick] Rol "${roleName}" falló:`, err?.message || err);
      return null;
    });

  // Still tracked: a persist that started before the deadline must be allowed
  // to finish before the pool closes (EXE-005).
  trackedPromises.push(workPromise);

  const result = await workPromise;
  const timedOut = isCancelled(roleCtx);
  roleCtx.dispose();

  if (timedOut) {
    console.warn(
      `⏱️ [Tick] Rol "${roleName}" agotó su presupuesto (${Math.round(budgetMs / 1000)}s) — ${Object.keys(perSource).length} fuente(s) completadas se conservan; el resto queda vencido para el próximo tick.`
    );
  }

  if (!result) {
    return { roleName, savedCount: 0, duplicateCount: 0, perSource, timedOut };
  }
  return { ...result, perSource, timedOut };
}

/**
 * P3 (EXE-002): each batch's budget is recomputed against what is genuinely
 * left, not a fixed upfront split — a fast batch hands its surplus to the
 * next, and a slow one shortens itself rather than eating the teardown
 * reserve, which `planTickBudget` excludes before handing anything out.
 */
async function runBatched(
  items: RoleItem[],
  parentCtx: FetchContext,
  plan: TickBudgetPlan,
  startedAt: number,
  trackedPromises: Promise<any>[],
  recorder: RunRecorder
): Promise<RoleResult[]> {
  const results: RoleResult[] = [];
  const batches: RoleItem[][] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) batches.push(items.slice(i, i + CONCURRENCY));

  for (let b = 0; b < batches.length; b++) {
    if (isCancelled(parentCtx)) {
      const skipped = batches.slice(b).reduce((n, batch) => n + batch.length, 0);
      console.warn(`⏱️ [Tick] Presupuesto agotado — ${skipped} rol(es) no se inician (quedan vencidos).`);
      break;
    }
    const budgetMs = plan.budgetForBatch({
      elapsedMs: Date.now() - startedAt,
      batchesRemaining: batches.length - b
    });
    if (budgetMs <= 0) {
      console.warn(`⏱️ [Tick] Sin presupuesto para el lote ${b + 1}/${batches.length} — no se inicia.`);
      break;
    }
    const batchResults = await Promise.all(
      batches[b].map((item) => runRoleWithBudget(item, parentCtx, budgetMs, trackedPromises, recorder))
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * Runs catalog-wide sources (RemoteOK, GetOnBoard, WeRemoto, Jooble) once
 * per due source, not once per role — see getDueGlobalSources. Reuses the
 * RoleResult shape purely so the existing writeSummary/reporting path can
 * fold this in without a second code path.
 */
async function runGlobalCatalogSources(
  recorder: RunRecorder,
  ctx: FetchContext,
  runId: string
): Promise<RoleResult | null> {
  const dueSources = await getDueGlobalSources(GLOBAL_CADENCE_MS);
  if (dueSources.length === 0) return null;

  console.log(`🌐 [Tick] Fuentes de catálogo global vencidas: [${dueSources.join(", ")}]`);

  const perSource: Record<string, SourceRunResult> = {};
  let savedCount = 0;
  let duplicateCount = 0;

  for (const sourceName of dueSources) {
    const adapter = adapterByName.get(sourceName);
    if (!adapter) continue;
    if (isCancelled(ctx)) {
      console.warn(`⏱️ [Tick] Sin presupuesto para la fuente global ${sourceName} — no se inicia.`);
      continue;
    }
    // P3 (EXE-007): a global source is claimed under the `__global__`
    // sentinel, the same key its cadence already uses, so two overlapping
    // ticks can't both fetch the identical catalog.
    const claimed = await claimLease({
      roleName: GLOBAL_LEASE_ROLE,
      sourceName,
      runId,
      country: TICK_COUNTRY,
      budgetMs: ctx.remainingMs()
    });
    if (!claimed) {
      console.log(`🔒 [Tick] ${sourceName} lo tiene otra ejecución en curso — se omite sin error.`);
      continue;
    }
    const attemptRef: { id?: string } = {};
    const listingStatus = () => (attemptRef.id ? recorder.statusOf(attemptRef.id) : undefined);
    try {
      const listing = await runListingAttempt(
        recorder,
        {
          source: sourceName,
          role: null,
          roleOrigin: "General",
          stampCountry: (job) => {
            job.country = resolveJobCountry(job, TICK_COUNTRY);
          },
          attemptRef,
          ctx
        },
        () => adapter.fetch([], "48h")
      );
      perSource[sourceName] = { fetched: listing.fetched, status: listingStatus() };
      savedCount += listing.savedCount;
      duplicateCount += listing.duplicateCount;

      await markGlobalSourceRun(sourceName);
    } catch (err: any) {
      console.error(`❌ [Tick] Fuente global ${sourceName} falló:`, err?.message || err);
      perSource[sourceName] = { fetched: 0, error: err?.message || String(err), status: listingStatus() };
    } finally {
      await releaseLease(GLOBAL_LEASE_ROLE, sourceName, runId);
    }
  }

  return {
    roleName: "(catálogo global — todas las fuentes que ignoran keywords)",
    savedCount,
    duplicateCount,
    perSource,
    timedOut: false
  };
}

/**
 * P3: bounded by a child context rather than a `Promise.race` — the old race
 * left the catalog step fetching and saving in the background after its
 * "timeout", which is what made the budget overrun invisible.
 */
async function runGlobalCatalogWithBudget(
  trackedPromises: Promise<any>[],
  recorder: RunRecorder,
  parentCtx: FetchContext,
  budgetMs: number,
  runId: string
): Promise<RoleResult | null> {
  const ctx = parentCtx.child(budgetMs);
  const workPromise = runGlobalCatalogSources(recorder, ctx, runId).catch((err) => {
    console.error(`❌ [Tick] Catálogo global falló:`, err?.message || err);
    return null;
  });
  trackedPromises.push(workPromise);

  const result = await workPromise;
  if (isCancelled(ctx)) {
    console.warn(
      `⏱️ [Tick] Catálogo global agotó su presupuesto (${Math.round(budgetMs / 1000)}s) — lo ya guardado queda persistido; el resto lo recoge el próximo tick.`
    );
  }
  ctx.dispose();
  return result;
}


function writeSummary(results: RoleResult[], deletedOld: number) {
  const perSourceTotals: Record<string, { fetched: number; errors: number; statuses: Set<string> }> = {};
  let totalSaved = 0;
  let totalDuplicates = 0;
  let timedOutRoles = 0;

  for (const r of results) {
    totalSaved += r.savedCount;
    totalDuplicates += r.duplicateCount;
    if (r.timedOut) timedOutRoles++;
    for (const [source, stats] of Object.entries(r.perSource)) {
      const bucket = (perSourceTotals[source] ||= { fetched: 0, errors: 0, statuses: new Set() });
      bucket.fetched += stats.fetched;
      if (stats.error) bucket.errors++;
      if (stats.status) bucket.statuses.add(stats.status);
    }
  }

  const lines: string[] = [];
  lines.push(`## 🕒 Scrape tick — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Roles procesados: **${results.length}** | Timeouts: **${timedOutRoles}**`);
  lines.push(
    `Vacantes nuevas guardadas: **${totalSaved}** | Duplicadas fusionadas: **${totalDuplicates}** | Purgadas (>30d): **${deletedOld}**`
  );
  lines.push("");
  lines.push("| Fuente | Vacantes obtenidas | Errores | Estado |");
  lines.push("|---|---|---|---|");

  const sourceNames = Object.keys(perSourceTotals).sort();
  for (const source of sourceNames) {
    const { fetched, errors, statuses } = perSourceTotals[source];
    // fetched === 0 alone (even with errors === 0) is flagged too: several
    // adapters swallow request-level failures (e.g. a 403) internally and
    // just return an empty array instead of throwing, so the exception-only
    // check misses a real block. Zero results across every keyword variant
    // for an active role in a 48h window is itself the strongest signal.
    const flag = fetched === 0 ? " ⚠️ posible bloqueo/caída (0 resultados)" : "";
    lines.push(`| ${source} | ${fetched} | ${errors}${flag} | ${[...statuses].sort().join(", ") || "—"} |`);
  }

  const summary = lines.join("\n");
  console.log("\n" + summary + "\n");

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  }

  for (const source of sourceNames) {
    const { fetched, errors } = perSourceTotals[source];
    if (fetched === 0) {
      console.log(
        `::warning title=Fuente posiblemente bloqueada::${source} devolvió 0 vacantes en este tick${errors > 0 ? ` (${errors} errores)` : ""}.`
      );
    }
  }
}

// Set as soon as main() opens a run, so the fatal handler can still close it
// (a crash would otherwise leave it `running` until reconciled as interrupted).
let activeRecorder: RunRecorder | null = null;

async function main() {
  const startedAt = Date.now();
  console.log(`🌎 [Tick] TICK_COUNTRY=${TICK_COUNTRY}`);

  // P2 (openspec p2-run-observability): a tick killed by Actions never writes
  // its own outcome — close runs whose heartbeat stopped before opening a new
  // one. Telemetry calls never throw and never gate the scrape itself.
  const reconciled = await runTelemetrySafely("reconcileStaleRuns", () => reconcileStaleRuns(), { runs: 0, attempts: 0 });
  if (reconciled.runs > 0) {
    console.warn(
      `🧟 [Tick] ${reconciled.runs} ejecución(es) sin latido marcadas como interrupted (${reconciled.attempts} intentos en curso).`
    );
  }

  // P3 (EXE-002): one budget, derived. Everything below asks the plan what it
  // may spend instead of consulting an independent constant that might not
  // fit — the failure mode that produced 27-min hard kills.
  const plan = planTickBudget({ totalMs: OVERALL_DEADLINE_MS, roleCount: MAX_ROLES_PER_RUN, concurrency: CONCURRENCY });
  const rootCtx = createFetchContext(plan.workMs);
  console.log(
    `⏱️ [Tick] Presupuesto: ${Math.round(plan.workMs / 1000)}s de trabajo + ${Math.round(plan.reserveMs / 1000)}s de cierre (total ${Math.round(plan.totalMs / 1000)}s).`
  );

  const recorder = await RunRecorder.start({
    workflow: "scrape-tick",
    country: TICK_COUNTRY,
    store: createPgRunStore(),
    // P3 (EXE-007): the run's 60s heartbeat is also the leases' heartbeat, so
    // a long-but-healthy source keeps its claim while a dead process simply
    // stops refreshing and its leases expire on their own.
    onHeartbeat: (runId) => {
      void refreshLeases(runId, plan.maxPerBatchMs);
    }
  });
  activeRecorder = recorder;

  await seedSearchRoles(DEFAULT_ROLES_200);

  const trackedPromises: Promise<any>[] = [];

  // Independent of per-role due-ness below: these sources ignore role and
  // keywords entirely, so they run on their own source-level cadence
  // regardless of whether any role has due per-role sources this tick.
  const globalResult = await runGlobalCatalogWithBudget(
    trackedPromises,
    recorder,
    rootCtx,
    plan.globalCatalogMs,
    recorder.runId
  );

  const due = await getDueRoleSources(ROLE_CADENCE_MS);
  const results: RoleResult[] = [];

  if (due.size === 0) {
    console.log("🕒 [Tick] Ningún rol/fuente vencido en este ciclo.");
  } else {
    const candidates = Array.from(due.entries())
      .slice(0, MAX_ROLES_PER_RUN)
      .map(([roleName, sourceNames]) => ({ roleName, sourceNames }));

    // P3 (EXE-007): claim before working. A pair another live run already
    // holds is dropped from this tick's list without error — it stays due.
    const items: RoleItem[] = [];
    let skippedByLease = 0;
    for (const candidate of candidates) {
      const claimedSources: string[] = [];
      for (const sourceName of candidate.sourceNames) {
        if (!adapterByName.has(sourceName)) continue;
        const claimed = await claimLease({
          roleName: candidate.roleName,
          sourceName,
          runId: recorder.runId,
          country: TICK_COUNTRY,
          budgetMs: plan.maxPerBatchMs
        });
        if (claimed) claimedSources.push(sourceName);
        else skippedByLease++;
      }
      const adapters = claimedSources
        .map((name) => adapterByName.get(name))
        .filter((a): a is SourceAdapter => !!a);
      if (adapters.length > 0) items.push({ roleName: candidate.roleName, adapters });
    }

    if (skippedByLease > 0) {
      console.log(`🔒 [Tick] ${skippedByLease} par(es) rol/fuente los tiene otra ejecución en curso — se omiten sin error.`);
    }

    console.log(
      `🕒 [Tick] ${due.size} roles con fuentes vencidas — procesando ${items.length} (tope ${MAX_ROLES_PER_RUN}/tick, el resto se recoge en el próximo).`
    );

    results.push(...(await runBatched(items, rootCtx, plan, startedAt, trackedPromises, recorder)));
  }

  if (globalResult) results.push(globalResult);

  // Retention cleanup, not ingestion: if the budget is gone it simply waits
  // for the next tick rather than pushing the process past its deadline.
  let deletedOld = 0;
  if (!isCancelled(rootCtx)) {
    deletedOld = await purgeOldJobs();
  } else {
    console.warn("⏱️ [Tick] Sin presupuesto para la purga de vacantes antiguas — se hará en el próximo tick.");
  }

  writeSummary(results, deletedOld);

  // --- Cierre acotado (P3, EXE-006) ---------------------------------------
  // Every stretch below has a bound. Before this phase the process ended here
  // in an unbounded pool.end() that waited on straggler clients — the reason
  // 25% of ticks were hard-killed by Actions at 27-28 min instead of exiting
  // on their own terms.

  // 1. Nothing new starts from here on.
  rootCtx.dispose();

  // 2. Bounded grace for writes already in flight. Fetches are already
  //    cancelled; this exists so a save that began before the deadline
  //    reaches Postgres (EXE-005).
  if (trackedPromises.length > 0) {
    const graceMs = Math.min(STRAGGLER_GRACE_MS, Math.max(0, plan.totalMs - (Date.now() - startedAt) - POOL_CLOSE_TIMEOUT_MS));
    if (graceMs > 0) {
      console.log(`⏳ [Tick] Hasta ${Math.round(graceMs / 1000)}s para que terminen las escrituras en curso...`);
      await Promise.race([
        Promise.allSettled(trackedPromises),
        new Promise((resolve) => setTimeout(resolve, graceMs).unref?.())
      ]);
    }
  }

  // 3. Close the run and release what this tick still holds.
  const run = await recorder.finish();
  console.log(
    `📡 [Tick] Ejecución ${run.runId}: ${run.status} (${run.reason})${run.telemetryEnabled ? "" : " — telemetría no persistida"}.`
  );
  await runTelemetrySafely("releaseRunLeases", () => releaseRunLeases(recorder.runId), 0);
  await runTelemetrySafely("purgeOldRuns", () => purgeOldRuns(), 0);

  // 4. Bounded pool close. This is the line that used to hang.
  const closed = await Promise.race([
    pool.end().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), POOL_CLOSE_TIMEOUT_MS).unref?.())
  ]);

  // 5. Exit on our own terms. Everything fetched is saved and the run is
  //    closed in Postgres; what remains is at worst an adapter's in-flight
  //    HTTP request, which a hard kill would have lost anyway. Terminating
  //    deliberately is strictly better than being cancelled by Actions.
  if (!closed) {
    console.warn(`⚠️ [Tick] El pool no cerró en ${POOL_CLOSE_TIMEOUT_MS / 1000}s — se sale de forma explícita (lo guardado ya está guardado).`);
    process.exit(0);
  }
  console.log(`✅ [Tick] Finalizado en ${Math.round((Date.now() - startedAt) / 1000)}s.`);
}

main().catch(async (err) => {
  console.error("❌ [Tick] Error inesperado:", err?.message || err);
  if (activeRecorder) {
    await activeRecorder.finish({ fatal: true });
    // Don't make the next tick wait out the TTL for claims this dead run held.
    await runTelemetrySafely("releaseRunLeases", () => releaseRunLeases(activeRecorder!.runId), 0);
  }
  await Promise.race([
    pool.end(),
    new Promise((resolve) => setTimeout(resolve, POOL_CLOSE_TIMEOUT_MS).unref?.())
  ]);
  process.exit(1);
});
