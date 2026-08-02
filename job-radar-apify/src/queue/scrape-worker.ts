import { allAdapters, Job, SourceAdapter } from "../sources/index.js";
import { saveJobs } from "../db/job-repository.js";
import { markRoleSourceRun } from "../db/scheduler-repository.js";
import { generateRoleKeywordsWithAI } from "../ai-role-agent.js";
import { DEFAULT_COUNTRY, isRemoteLocation } from "../countries/index.js";

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
    perSource: Record<string, { fetched: number; error?: string }>;
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
    const perSource: Record<string, { fetched: number; error?: string }> = {};

    // Saved per-adapter, immediately after each fetch — not batched until the
    // whole role finishes. A role needing all 12 sources can take 10-15+ min
    // sequentially, and a one-shot tick process can be killed mid-role (a
    // GitHub Actions job hitting its own timeout-minutes ceiling, confirmed
    // happening in production 2026-07-25). Saving at the very end meant a
    // kill at source #8 of 12 lost 100% of that role's work, not just the
    // unfinished part — this way, whatever already fetched is already safely
    // in Postgres by the time anything might cut the process off.
    for (const adapter of adapters) {
      try {
        const results = await adapter.fetch(keywordsToUse, dateRange);
        const fetched = Array.isArray(results) ? results.length : 0;
        totalJobs += fetched;
        perSource[adapter.name] = { fetched };

        for (const job of results) {
          job.country = isRemoteLocation(job.location) ? null : country;
        }

        if (fetched > 0) {
          const saved = await saveJobs(results, roleName);
          savedCount += saved.savedCount;
          duplicateCount += saved.duplicateCount;
        }

        await markRoleSourceRun(roleName, adapter.name);
      } catch (err: any) {
        console.error(
          `❌ [ScrapeWorker] Error en adaptador ${adapter.name} procesando "${roleName}":`,
          err?.message || err
        );
        perSource[adapter.name] = { fetched: 0, error: err?.message || String(err) };
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
