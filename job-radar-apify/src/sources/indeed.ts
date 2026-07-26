import { SourceAdapter, Job, deduplicateJobs } from "./types.js";
import { scrapeIndeedLocal } from "../index.js";
import { executeWithResilience } from "../engine/resilient-fetch.js";
import { jitterDelay } from "../engine/jitter-delay.js";

// Indeed has no official API — HTML scraping is the compliant fallback per
// the source-priority ladder, but it needs the same pacing/fanout limits
// already applied to the other fragile HTML sources (see jitter-delay.ts:
// firing 30-60 keyword requests back-to-back "reads as bot traffic"). This
// adapter previously had neither, which is the most likely reason it moved
// from working to a 403-on-every-request block during testing.
const MAX_KEYWORDS_PER_ROLE = 12;

export const indeedAdapter: SourceAdapter = {
  name: "Indeed",
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    const limited = keywords.slice(0, MAX_KEYWORDS_PER_ROLE);
    for (let i = 0; i < limited.length; i++) {
      if (i > 0) await jitterDelay();
      const results = await executeWithResilience("Indeed", () => scrapeIndeedLocal(limited[i]));
      allJobs.push(...results);
    }
    return deduplicateJobs(allJobs);
  }
};
