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
import { ScrapeWorker } from "../src/queue/scrape-worker.js";
import { isRemoteLocation } from "../src/countries/index.js";
import {
  seedSearchRoles,
  getDueRoleSources,
  getDueGlobalSources,
  markGlobalSourceRun,
  purgeOldJobs
} from "../src/db/scheduler-repository.js";
import { saveJobs } from "../src/db/job-repository.js";
import { pool } from "../src/db/client.js";

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
const PER_ROLE_TIMEOUT_MS = 5 * 60 * 1000;
// Same reasoning as PER_ROLE_TIMEOUT_MS, applied to the global-catalog step
// (RemoteOK/GetOnBoard/Jooble/WeRemoto — see runGlobalCatalogSources). That
// step runs before any per-role work is attempted; without its own bound, a
// hang there (WeRemoto pages sequentially through up to 8 requests) could
// burn the whole tick's budget before a single role gets a turn.
const GLOBAL_CATALOG_TIMEOUT_MS = 3 * 60 * 1000;
// Below the workflow's own `timeout-minutes: 25` with real margin. Without
// this, a role needing all its sources at once can push the "wait for
// stragglers" step past that ceiling — GitHub then hard-cancels the whole
// job mid-scrape (confirmed happening in production, run 30170319327,
// conclusion "cancelled"), which loses the in-flight role's cadence update
// and any of its adapters not yet reached. Its already-fetched sources are
// still safe now (scrape-worker.ts saves per-adapter, not per-role), but
// exiting on our own terms is still better than being killed outright.
const OVERALL_DEADLINE_MS = 20 * 60 * 1000;

const worker = new ScrapeWorker(CONCURRENCY);
const adapterByName = new Map<string, SourceAdapter>(allAdapters.map((a) => [a.name, a]));

interface RoleResult {
  roleName: string;
  savedCount: number;
  duplicateCount: number;
  perSource: Record<string, { fetched: number; error?: string }>;
  timedOut: boolean;
}

async function runWithTimeout(
  roleName: string,
  adapters: SourceAdapter[],
  trackedPromises: Promise<any>[]
): Promise<RoleResult> {
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), PER_ROLE_TIMEOUT_MS);
  });

  const workPromise = worker
    .processRoleJob({ roleName, dateRange: "48h", adapters, country: TICK_COUNTRY })
    .catch((err) => {
      console.error(`❌ [Tick] Rol "${roleName}" falló:`, err?.message || err);
      return null;
    });

  // Track every launched scrape regardless of whether it wins the race below
  // — Promise.race never cancels the loser, so a role that "times out" here
  // keeps scraping and saving in the background. We must not close the DB
  // pool until that straggler also settles, or its save silently fails
  // against a closed pool (confirmed happening in the first local test run).
  trackedPromises.push(workPromise);

  const result = await Promise.race([workPromise, timeoutPromise]);

  if (!result) {
    console.warn(
      `⏱️ [Tick] Rol "${roleName}" superó los ${PER_ROLE_TIMEOUT_MS / 60000} min — se deja pendiente, el próximo tick lo recoge (no se reintenta en este proceso).`
    );
    return {
      roleName,
      savedCount: 0,
      duplicateCount: 0,
      perSource: {},
      timedOut: true
    };
  }

  return { ...result, timedOut: false };
}

async function runBatched(
  items: { roleName: string; adapters: SourceAdapter[] }[],
  trackedPromises: Promise<any>[]
): Promise<RoleResult[]> {
  const results: RoleResult[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((item) => runWithTimeout(item.roleName, item.adapters, trackedPromises))
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
async function runGlobalCatalogSources(): Promise<RoleResult | null> {
  const dueSources = await getDueGlobalSources(GLOBAL_CADENCE_MS);
  if (dueSources.length === 0) return null;

  console.log(`🌐 [Tick] Fuentes de catálogo global vencidas: [${dueSources.join(", ")}]`);

  const perSource: Record<string, { fetched: number; error?: string }> = {};
  let savedCount = 0;
  let duplicateCount = 0;

  for (const sourceName of dueSources) {
    const adapter = adapterByName.get(sourceName);
    if (!adapter) continue;
    try {
      const results = await adapter.fetch([], "48h");
      const fetched = Array.isArray(results) ? results.length : 0;
      perSource[sourceName] = { fetched };

      for (const job of results) {
        job.country = isRemoteLocation(job.location) ? null : TICK_COUNTRY;
      }

      if (fetched > 0) {
        const saved = await saveJobs(results, "General");
        savedCount += saved.savedCount;
        duplicateCount += saved.duplicateCount;
      }

      await markGlobalSourceRun(sourceName);
    } catch (err: any) {
      console.error(`❌ [Tick] Fuente global ${sourceName} falló:`, err?.message || err);
      perSource[sourceName] = { fetched: 0, error: err?.message || String(err) };
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
 * Bounds runGlobalCatalogSources the same way runWithTimeout bounds a role:
 * Promise.race never cancels the loser, so on a timeout the fetch/save keeps
 * running in the background — it's pushed onto trackedPromises so main()
 * waits for it (bounded by OVERALL_DEADLINE_MS) before closing the pool,
 * instead of letting its eventual saveJobs/markGlobalSourceRun call fail
 * against an already-closed pool.
 */
async function runGlobalCatalogSourcesWithTimeout(
  trackedPromises: Promise<any>[]
): Promise<RoleResult | null> {
  const workPromise = runGlobalCatalogSources().catch((err) => {
    console.error(`❌ [Tick] Catálogo global falló:`, err?.message || err);
    return null;
  });
  trackedPromises.push(workPromise);

  const timeoutPromise = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), GLOBAL_CATALOG_TIMEOUT_MS)
  );

  const result = await Promise.race([workPromise, timeoutPromise]);
  if (result === "timeout") {
    console.warn(
      `⏱️ [Tick] Catálogo global superó los ${GLOBAL_CATALOG_TIMEOUT_MS / 60000} min — se deja pendiente, el siguiente tick lo recoge (lo ya guardado antes del corte queda persistido).`
    );
    return null;
  }
  return result;
}

function writeSummary(results: RoleResult[], deletedOld: number) {
  const perSourceTotals: Record<string, { fetched: number; errors: number }> = {};
  let totalSaved = 0;
  let totalDuplicates = 0;
  let timedOutRoles = 0;

  for (const r of results) {
    totalSaved += r.savedCount;
    totalDuplicates += r.duplicateCount;
    if (r.timedOut) timedOutRoles++;
    for (const [source, stats] of Object.entries(r.perSource)) {
      const bucket = (perSourceTotals[source] ||= { fetched: 0, errors: 0 });
      bucket.fetched += stats.fetched;
      if (stats.error) bucket.errors++;
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
  lines.push("| Fuente | Vacantes obtenidas | Errores |");
  lines.push("|---|---|---|");

  const sourceNames = Object.keys(perSourceTotals).sort();
  for (const source of sourceNames) {
    const { fetched, errors } = perSourceTotals[source];
    // fetched === 0 alone (even with errors === 0) is flagged too: several
    // adapters swallow request-level failures (e.g. a 403) internally and
    // just return an empty array instead of throwing, so the exception-only
    // check misses a real block. Zero results across every keyword variant
    // for an active role in a 48h window is itself the strongest signal.
    const flag = fetched === 0 ? " ⚠️ posible bloqueo/caída (0 resultados)" : "";
    lines.push(`| ${source} | ${fetched} | ${errors}${flag} |`);
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

async function main() {
  const startedAt = Date.now();
  console.log(`🌎 [Tick] TICK_COUNTRY=${TICK_COUNTRY}`);
  await seedSearchRoles(DEFAULT_ROLES_200);

  const trackedPromises: Promise<any>[] = [];

  // Independent of per-role due-ness below: these sources ignore role and
  // keywords entirely, so they run on their own source-level cadence
  // regardless of whether any role has due per-role sources this tick.
  // Bounded by its own timeout so a hang here can't eat the per-role budget
  // below (see GLOBAL_CATALOG_TIMEOUT_MS) — trackedPromises is shared with
  // the per-role path so main() waits for a straggler either way before
  // closing the pool.
  const globalResult = await runGlobalCatalogSourcesWithTimeout(trackedPromises);

  const due = await getDueRoleSources(ROLE_CADENCE_MS);
  const results: RoleResult[] = [];

  if (due.size === 0) {
    console.log("🕒 [Tick] Ningún rol/fuente vencido en este ciclo.");
  } else {
    const items = Array.from(due.entries())
      .slice(0, MAX_ROLES_PER_RUN)
      .map(([roleName, sourceNames]) => ({
        roleName,
        adapters: sourceNames
          .map((name) => adapterByName.get(name))
          .filter((a): a is SourceAdapter => !!a)
      }))
      .filter((item) => item.adapters.length > 0);

    console.log(
      `🕒 [Tick] ${due.size} roles con fuentes vencidas — procesando ${items.length} (tope ${MAX_ROLES_PER_RUN}/tick, el resto se recoge en el próximo).`
    );

    results.push(...(await runBatched(items, trackedPromises)));
  }

  if (globalResult) results.push(globalResult);
  const deletedOld = await purgeOldJobs();

  writeSummary(results, deletedOld);

  // Report and move on at the per-role timeout pace above, but don't let a
  // straggler that finishes just after its timeout lose its markRoleSourceRun
  // update — wait for every launched scrape to actually settle, bounded by
  // our own deadline so we exit cleanly instead of being hard-cancelled.
  if (trackedPromises.length > 0) {
    const remainingMs = OVERALL_DEADLINE_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      console.warn(
        `⚠️ [Tick] Presupuesto de ${OVERALL_DEADLINE_MS / 60000} min agotado — cerrando sin esperar a los ${trackedPromises.length} scrapes restantes (ya guardaron lo que alcanzaron a traer por fuente).`
      );
    } else {
      console.log(
        `⏳ [Tick] Esperando hasta ${Math.round(remainingMs / 1000)}s más a que terminen ${trackedPromises.length} scrapes en curso...`
      );
      await Promise.race([
        Promise.allSettled(trackedPromises),
        new Promise((resolve) => setTimeout(resolve, remainingMs))
      ]);
    }
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error("❌ [Tick] Error inesperado:", err?.message || err);
  await pool.end();
  process.exit(1);
});
