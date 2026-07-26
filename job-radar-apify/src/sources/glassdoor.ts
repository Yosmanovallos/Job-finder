import { SourceAdapter, Job, deduplicateJobs } from "./types.js";
import { scrapeGlassdoor } from "../index.js";
import { executeWithResilience } from "../engine/resilient-fetch.js";
import { jitterDelay } from "../engine/jitter-delay.js";

// Started returning 403 Forbidden during testing (2026-07-25) — same missing
// protections Indeed had before it started blocking: no delay between
// requests and no cap on keyword fanout (up to 30-60 variants fired
// back-to-back). Applying the same fix.
const MAX_KEYWORDS_PER_ROLE = 12;

export const glassdoorAdapter: SourceAdapter = {
  name: "Glassdoor",
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    const limited = keywords.slice(0, MAX_KEYWORDS_PER_ROLE);
    for (let i = 0; i < limited.length; i++) {
      if (i > 0) await jitterDelay();
      const results = await executeWithResilience("Glassdoor", () => scrapeGlassdoor(limited[i]));
      allJobs.push(...results);
    }
    return deduplicateJobs(allJobs);
  }
};
