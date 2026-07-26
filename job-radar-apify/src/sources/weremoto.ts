import { SourceAdapter, Job, deduplicateJobs } from "./types.js";
import { scrapeWeRemoto } from "../index.js";
import { executeWithResilience } from "../engine/resilient-fetch.js";

export const weremotoAdapter: SourceAdapter = {
  name: "WeRemoto",
  async fetch(_keywords: string[], _dateRange?: string): Promise<Job[]> {
    const jobs = await executeWithResilience("WeRemoto", () => scrapeWeRemoto());
    return deduplicateJobs(jobs);
  }
};
