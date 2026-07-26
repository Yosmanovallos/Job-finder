import { SourceAdapter, Job, deduplicateJobs } from "./types.js";
import { scrapeRemoteOK } from "../index.js";
import { executeWithResilience } from "../engine/resilient-fetch.js";

export const remoteokAdapter: SourceAdapter = {
  name: "RemoteOK",
  async fetch(_keywords: string[], _dateRange?: string): Promise<Job[]> {
    const jobs = await executeWithResilience("RemoteOK", () => scrapeRemoteOK());
    return deduplicateJobs(jobs);
  }
};
