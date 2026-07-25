import { SourceAdapter, Job } from "./types.js";
import { scrapeWorkana } from "../index.js";
import { executeWithResilience } from "../engine/resilient-fetch.js";
import { jitterDelay } from "../engine/jitter-delay.js";

// Already blocking with 403 on every request during testing — cut fanout
// further on top of the existing jitter delay. `keywords` is a Set built by
// ai-role-agent.ts with the core canonical terms inserted first and the
// Senior/Líder/Gerente variant explosion appended after, so keeping only the
// first N preserves the most relevant searches while cutting request volume.
const MAX_KEYWORDS_PER_ROLE = 12;

export const workanaAdapter: SourceAdapter = {
  name: "Workana",
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    const limited = keywords.slice(0, MAX_KEYWORDS_PER_ROLE);
    for (let i = 0; i < limited.length; i++) {
      if (i > 0) await jitterDelay();
      const results = await executeWithResilience("Workana", () => scrapeWorkana(limited[i]));
      allJobs.push(...results);
    }
    return allJobs;
  }
};
