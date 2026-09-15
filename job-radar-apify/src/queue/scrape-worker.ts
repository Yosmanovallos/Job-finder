import { allAdapters, Job, SourceAdapter } from "../sources/index.js";
import { updateJobDetail, InsertedJobRef } from "../db/job-repository.js";
import { markRoleSourceRun } from "../db/scheduler-repository.js";
import { generateRoleKeywordsWithAI } from "../ai-role-agent.js";
import { DEFAULT_COUNTRY, resolveJobCountry } from "../countries/index.js";
import { executeWithResilience } from "../engine/resilient-fetch.js";
import { jitterDelay } from "../engine/jitter-delay.js";
import { RunRecorder, type AttemptHandle, type AttemptStatus } from "../observability/run-telemetry.js";
import { runListingAttempt } from "./listing-attempt.js";

// Bounds how many detail pages get fetched per adapter per role per tick
// (AGENTS.md #12 — no unbounded loop). A role can produce dozens of new
// jobs from one HTML source; fetching a detail page for every single one,
// every 15-min tick, across ~200+ roles would multiply request volume far
// past what a source's rate limiting/bot detection tolerates. Detail
// enrichment is a nice-to-have on top of a job that's already saved and
// visible — capping it just means some new jobs keep showing without the
// rich card until a later, less busy moment (never a data-loss concern).
const MAX_DETAIL_FETCHES_PER_ADAPTER_PER_ROLE = 8;

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
    const perSource: Record<string, SourceRunResult> = {};
    const recorder = options.recorder ?? RunRecorder.disabled();

    // Saved per-adapter, immediately after each fetch — not batched until the
    // whole role finishes. A role needing all 12 sources can take 10-15+ min
    // sequentially, and a one-shot tick process can be killed mid-role (a
    // GitHub Actions job hitting its own timeout-minutes ceiling, confirmed
    // happening in production 2026-07-25). Saving at the very end meant a
    // kill at source #8 of 12 lost 100% of that role's work, not just the
    // unfinished part — this way, whatever already fetched is already safely
    // in Postgres by the time anything might cut the process off.
    for (const adapter of adapters) {
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
            attemptRef
          },
          () => adapter.fetch(keywordsToUse, dateRange)
        );
        totalJobs += listing.fetched;
        savedCount += listing.savedCount;
        duplicateCount += listing.duplicateCount;
        perSource[adapter.name] = { fetched: listing.fetched, status: listingStatus() };

        // Separate attempt, after the listing is already persisted: a slow or
        // blocked detail host shows up as its own outcome instead of hiding
        // a healthy listing (or vice versa).
        if (adapter.fetchDetail && listing.insertedJobs.length > 0) {
          await recorder.trackAttempt({ source: adapter.name, role: roleName, stage: "detail" }, (attempt) =>
            this.enrichNewJobs(adapter, listing.insertedJobs, attempt)
          );
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

  /**
   * Fetches detail-page enrichment for a bounded slice of this adapter's
   * newly-inserted rows only (never a re-scrape — see saveJobs()). Wrapped
   * in executeWithResilience per job so a source's detail pages tripping
   * its bot detection registers on that source's own circuit breaker, same
   * as its search-results fetch — a detail-page block doesn't silently
   * retry forever, and one job's failure never stops the rest of the
   * batch (each iteration has its own try/catch).
   */
  private async enrichNewJobs(
    adapter: SourceAdapter,
    insertedJobs: InsertedJobRef[],
    attempt: AttemptHandle
  ): Promise<void> {
    const slice = insertedJobs.slice(0, MAX_DETAIL_FETCHES_PER_ADAPTER_PER_ROLE);
    let obtained = 0;
    let failed = 0;
    // received = new rows eligible for detail; filtered = left out by the cap.
    attempt.setCounters({ received: insertedJobs.length, filtered: insertedJobs.length - slice.length, valid: 0, failed: 0 });
    // Cool-down before the first detail request: confirmed live (2026-08-11)
    // that starting detail fetches immediately after a source's search
    // phase (which can already be 20-30+ requests across keyword variants,
    // e.g. Computrabajo's translate.goog proxy) measurably raises the null
    // rate on the very next requests against the same host — a same-URL
    // retest moments later succeeded where the in-tick attempt didn't. This
    // doesn't fix a code bug, it just stops piling detail requests directly
    // on top of a host that may still be warm from the search burst.
    await jitterDelay(3000, 6000);
    for (let i = 0; i < slice.length; i++) {
      if (i > 0) await jitterDelay();
      const ref = slice[i];
      try {
        // executeWithResilience's contract is `fetcher: () => Promise<T[]>`
        // (shared with the reputation pipeline) — fetchDetail returns a
        // single object or null, so it's wrapped/unwrapped at this call
        // site rather than changing that shared function's contract.
        const [detail] = await executeWithResilience(`${adapter.name}-detail`, async () => {
          const result = await adapter.fetchDetail!(ref.url);
          return result ? [result] : [];
        });
        if (detail) {
          await updateJobDetail(ref.id, {
            description: detail.description,
            requirements: detail.requirements,
            technologies: detail.technologies,
            employmentType: detail.employmentType,
            salaryMin: detail.salaryMin,
            salaryMax: detail.salaryMax,
            salaryCurrency: detail.salaryCurrency,
            salaryRaw: detail.salaryRaw,
            applicantCount: detail.applicantCount
          });
          obtained++;
          attempt.setCounters({ valid: obtained });
        }
      } catch (err: any) {
        console.warn(
          `⚠️ [ScrapeWorker] Detalle fallido para ${adapter.name} (${ref.url}):`,
          err?.message || err
        );
        failed++;
        attempt.setCounters({ failed });
      }
    }
  }
}
