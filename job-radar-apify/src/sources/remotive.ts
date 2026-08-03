import { SourceAdapter, Job, deduplicateJobs } from "./types.js";
import { scrapeRemotive } from "../index.js";
import { executeWithResilience } from "../engine/resilient-fetch.js";

// Ignores keywords — Remotive's `search` query param no longer filters
// anything (confirmed live 2026-08-03, see scrapeRemotive's comment in
// index.ts), so every call already returns the same fixed catalog
// regardless of what's asked. Catalog-wide source now, same shape as
// RemoteOK/GetOnBoard (see GLOBAL_SOURCE_CADENCE_MS in source-cadence.ts).
export const remotiveAdapter: SourceAdapter = {
  name: "Remotive",
  async fetch(_keywords: string[], _dateRange?: string): Promise<Job[]> {
    const jobs = await executeWithResilience("Remotive", () => scrapeRemotive());
    return deduplicateJobs(jobs);
  }
};
