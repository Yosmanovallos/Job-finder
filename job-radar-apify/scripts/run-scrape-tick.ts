import fs from "fs";
import dotenv from "dotenv";
import { allAdapters, SourceAdapter } from "../src/sources/index.js";
import { SOURCE_CADENCE_MS } from "../src/queue/source-cadence.js";
import { DEFAULT_ROLES_200 } from "../src/queue/scheduler.js";
import { ScrapeWorker } from "../src/queue/scrape-worker.js";
import {
  seedSearchRoles,
  getDueRoleSources,
  purgeOldJobs
} from "../src/db/scheduler-repository.js";
import { pool } from "../src/db/client.js";

dotenv.config();

// One-shot tick meant to be invoked on a schedule (e.g. GitHub Actions every
// 15 min) — unlike the old in-process cron, this never retries a timed-out
// role itself. A role that times out this run simply stays "due" (its
// role_source_runs row never gets updated) and gets picked up by the very
// next scheduled invocation. That statelessness is what makes it safe to
// run as a fresh process every time instead of a long-lived server.
const MAX_ROLES_PER_RUN = 8;
const CONCURRENCY = 2;
const PER_ROLE_TIMEOUT_MS = 5 * 60 * 1000;
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
    .processRoleJob({ roleName, dateRange: "48h", adapters })
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
  await seedSearchRoles(DEFAULT_ROLES_200);

  const due = await getDueRoleSources(SOURCE_CADENCE_MS);
  if (due.size === 0) {
    console.log("🕒 [Tick] Ningún rol/fuente vencido en este ciclo.");
    writeSummary([], 0);
    await pool.end();
    return;
  }

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

  const trackedPromises: Promise<any>[] = [];
  const results = await runBatched(items, trackedPromises);
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
