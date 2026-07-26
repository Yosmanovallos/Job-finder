import { SourceAdapter, Job, deduplicateJobs } from "./types.js";
import { scrapeRemotive } from "../index.js";
import { executeWithResilience } from "../engine/resilient-fetch.js";

export const remotiveAdapter: SourceAdapter = {
  name: "Remotive",
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const jobs = await executeWithResilience("Remotive", () => scrapeRemotive(keywords));
    return deduplicateJobs(jobs);
  }
};
