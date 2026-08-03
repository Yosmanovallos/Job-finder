/**
 * WorkanaV2 Adapter — Global Catalog Daily Ingestion
 *
 * ⚠️  POC FILE — NOT wired into sources/index.ts yet.
 *     This file exists so the adapter is ready for integration once the
 *     POC scraper (`src/scrapers/workana-v2-scraper.ts`) is validated.
 *
 * Pattern: identical to remoteokAdapter / getonboardAdapter — ignores
 * keywords entirely because it fetches the full daily catalog in one pass.
 *
 * The adapter name "WorkanaV2" is deliberately different from "Workana"
 * so it gets its own row in source_circuit_state (circuit breaker) and
 * role_source_runs (cadence tracking), fully isolated from the original.
 * The jobs it returns still carry source = "Workana" so the UI/dashboard
 * shows a single clean label regardless of which adapter fetched them.
 */

import { SourceAdapter, Job, deduplicateJobs } from "./types.js";
import { scrapeWorkanaV2 } from "../scrapers/workana-v2-scraper.js";
import { executeWithResilience } from "../engine/resilient-fetch.js";

export const workanaV2Adapter: SourceAdapter = {
  name: "WorkanaV2",
  async fetch(_keywords: string[], _dateRange?: string): Promise<Job[]> {
    const jobs = (await executeWithResilience("WorkanaV2", () =>
      scrapeWorkanaV2()
    )) as Job[];
    return deduplicateJobs(jobs);
  },
};
