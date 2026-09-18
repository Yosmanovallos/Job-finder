import { allAdapters, SourceAdapter } from "../sources/index.js";
import { markRoleSourceRun } from "../db/scheduler-repository.js";
import { generateRoleKeywordsWithAI } from "../ai-role-agent.js";
import { DEFAULT_COUNTRY, resolveJobCountry } from "../countries/index.js";
import { enrichInsertedJobs } from "./detail-enrichment.js";
import { BUDGET_ESTIMATES, estimateListingMs, hasBudget, type FetchContext } from "../engine/fetch-context.js";
import { RunRecorder, type AttemptStatus } from "../observability/run-telemetry.js";
import { runListingAttempt } from "./listing-attempt.js";

// Detail pages per adapter per role per tick are bounded by the source's
// detail policy (source-policy.ts, default 8 — AGENTS.md #12); see
// src/queue/detail-enrichment.ts.

interface WorkerJobOptions {
  roleName: string;
  dateRange?: string;
  /** Restricts this run to a subset of adapters (used by the cron scheduler
   * to respect per-source cadence). Defaults to all sources, preserving the
   * existing manual/admin trigger behavior. */
  adapters?: SourceAdapter[];
  /** Which country tick this is (see run-scrape-tick.ts's TICK_COUNTRY).
   * Defaults to 'CO' so any caller that doesn't pass it (manual/admin
   * triggers, older call sites) keeps today's behavior unchanged. Stamped
   * onto every fetched job below UNLESS its own location reads as remote,
   * in which case it's left null — remote jobs must stay visible to every
   * country regardless of which country's tick happened to discover them
   * (see schema.sql's jobs.country comment). */
  country?: string;
  /** P2 run telemetry. Optional: without it, attempts are still classified
   * in memory (perSource[].status) but nothing is persisted. */
  recorder?: RunRecorder;
  /** P3 deadline/cancellation. Without it, behavior is unchanged. */
  ctx?: FetchContext;
  /** P3 (EXE-009): when the caller owns this map, whatever a role completed
   * before its deadline survives the role timing out. Previously the caller
   * discarded the whole result on timeout, which erased completed sources
   * from the report — that is why Computrabajo/Elempleo/Magneto went missing
   * from run 35031341207's summary. */
  perSourceSink?: Record<string, SourceRunResult>;
}

export interface SourceRunResult {
  fetched: number;
  error?: string;
  /** Classified outcome of this source's listing attempt (P2). */
  status?: AttemptStatus;
}

export class ScrapeWorker {
  private maxConcurrency: number;
  private activeJobsCount: number = 0;

  constructor(maxConcurrency: number = 3) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Memory management check: trigger garbage collection if RAM > 200MB
   */
  private checkMemory() {
    const memory = process.memoryUsage();
    const heapUsedMb = memory.heapUsed / (1024 * 1024);
    if (heapUsedMb > 200) {
      console.warn(
        `⚠️ [ScrapeWorker] Consumo de memoria RAM elevado (${heapUsedMb.toFixed(2)} MB > 200 MB). Ejecutando limpieza...`
      );
      if (global.gc) {
        try {
          global.gc();
        } catch (e) {}
      }
    }
  }

  /**
   * Executes a single scraping job for a role across all registered SourceAdapters.
   */
  async processRoleJob(options: WorkerJobOptions): Promise<{
    roleName: string;
    totalJobs: number;
    savedCount: number;
    duplicateCount: number;
    perSource: Record<string, SourceRunResult>;
  }> {
    this.checkMemory();

    const {
      roleName,
      dateRange = "48h",
      adapters = allAdapters,
      country = DEFAULT_COUNTRY
    } = options;
    console.log(
      `\n⚙️ [ScrapeWorker] Procesando rol: "${roleName}" (Concurrencia activa: ${this.activeJobsCount + 1}/${this.maxConcurrency}, fuentes: [${adapters.map((a) => a.name).join(", ")}])...`
    );

    // Expand role keywords using ai-role-agent.ts
    const keywordsToUse = generateRoleKeywordsWithAI([roleName]);
    console.log(
      `🔍 [ScrapeWorker] Variantes generadas para "${roleName}": [${keywordsToUse.join(", ")}]`
    );

    let totalJobs = 0;
    let savedCount = 0;
    let duplicateCount = 0;
    const perSource: Record<string, SourceRunResult> = options.perSourceSink ?? {};
    const recorder = options.recorder ?? RunRecorder.disabled();
    const ctx = options.ctx;

    // Saved per-adapter, immediately after each fetch — not batched until the
    // whole role finishes. A role needing all 12 sources can take 10-15+ min
    // sequentially, and a one-shot tick process can be killed mid-role (a
    // GitHub Actions job hitting its own timeout-minutes ceiling, confirmed
    // happening in production 2026-07-25). Saving at the very end meant a
    // kill at source #8 of 12 lost 100% of that role's work, not just the
    // unfinished part — this way, whatever already fetched is already safely
    // in Postgres by the time anything might cut the process off.
    for (const adapter of adapters) {
      // P3 (EXE-003): stop the loop at a source boundary — the cheapest
      // possible place to stop, since nothing has been fetched yet. The
      // remaining sources simply stay due and the next tick takes them.
      // Estimación POR FUENTE, medida (ver SOURCE_LISTING_ESTIMATE_MS): la
      // constante única de 30s daba por buena una fuente que en realidad
      // tarda 2-5 min, así que se arrancaban listados sin ninguna
      // posibilidad de terminar dentro del plazo.
      if (!hasBudget(ctx, estimateListingMs(adapter.name))) {
        console.warn(
          `⏱️ [ScrapeWorker] Sin presupuesto para ${adapter.name} en "${roleName}" — no se inicia (queda vencida para el próximo tick).`
        );
        continue;
      }
      const attemptRef: { id?: string } = {};
      const listingStatus = () => (attemptRef.id ? recorder.statusOf(attemptRef.id) : undefined);
      try {
        const listing = await runListingAttempt(
          recorder,
          {
            source: adapter.name,
            role: roleName,
            roleOrigin: roleName,
            stampCountry: (job) => {
              job.country = resolveJobCountry(job, country);
            },
            attemptRef,
            ctx
          },
          // Prefer the P4 contract when the adapter provides it; otherwise
          // the historical one. This single line is the whole of "gradual
          // adoption" at the call site.
          () =>
            adapter.fetchResult
              ? adapter.fetchResult(keywordsToUse, dateRange, ctx)
              : adapter.fetch(keywordsToUse, dateRange)
        );
        totalJobs += listing.fetched;
        savedCount += listing.savedCount;
        duplicateCount += listing.duplicateCount;
        perSource[adapter.name] = { fetched: listing.fetched, status: listingStatus() };

        // Separate attempt, after the listing is already persisted: a slow or
        // blocked detail host shows up as its own outcome instead of hiding
        // a healthy listing (or vice versa).
        // Detail enrichment is explicitly optional work on top of a job that
        // is already saved and visible (cap: detail policy, see detail-enrichment.ts),
        // so it is the first thing to give up when the budget is thin — never
        // at the cost of the listing that already landed.
        // Job SEO V2: goes through the persistent detail state machine, so a
        // row the cap or the budget leaves out stays 'pending' and the tick's
        // drain step (or a later tick) picks it up — no longer lost.
        if (adapter.fetchDetail && listing.insertedJobs.length > 0 && hasBudget(ctx, BUDGET_ESTIMATES.detailFetch)) {
          await recorder.trackAttempt({ source: adapter.name, role: roleName, stage: "detail" }, async (attempt) => {
            await enrichInsertedJobs(
              adapter,
              listing.insertedJobs.map((ref) => ref.id),
              attempt,
              ctx
            );
          });
        }

        await markRoleSourceRun(roleName, adapter.name);
      } catch (err: any) {
        console.error(
          `❌ [ScrapeWorker] Error en adaptador ${adapter.name} procesando "${roleName}":`,
          err?.message || err
        );
        perSource[adapter.name] = { fetched: 0, error: err?.message || String(err), status: listingStatus() };
      }
    }

    console.log(
      `✅ [ScrapeWorker] Rol "${roleName}" completado: ${totalJobs} vacantes encontradas (${savedCount} nuevas, ${duplicateCount} duplicadas fusionadas).`
    );

    this.checkMemory();
    return {
      roleName,
      totalJobs,
      savedCount,
      duplicateCount,
      perSource
    };
  }
}
