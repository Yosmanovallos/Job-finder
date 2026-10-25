import type { SourceAdapter, Job } from "./types.js";
import { deduplicateJobs } from "./types.js";
import { scrapeGetOnBoard } from "../index.js";
import { executeWithResilience } from "../engine/resilient-fetch.js";

export const getonboardAdapter: SourceAdapter = {
  name: "GetOnBoard",
  async fetch(_keywords: string[], _dateRange?: string): Promise<Job[]> {
    const jobs = await executeWithResilience("GetOnBoard", () => scrapeGetOnBoard());
    return deduplicateJobs(jobs);
  }
};
