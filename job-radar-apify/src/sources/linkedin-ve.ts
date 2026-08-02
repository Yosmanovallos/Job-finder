import { SourceAdapter, Job, deduplicateJobs } from './types.js';
import { scrapeLinkedIn } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';
import { jitterDelay } from '../engine/jitter-delay.js';

// Separate adapter object (not a parameter on linkedinAdapter) so its name
// — used as the key for role_source_runs cadence and source_circuit_state
// circuit-breaker (see source-cadence.ts's SOURCE_CADENCE_MS_VE comment) —
// stays fully isolated from Colombia's "LinkedIn" bookkeeping. The jobs it
// returns still carry job.source = "LinkedIn" (hardcoded inside
// scrapeLinkedIn itself), so the UI/filters show one clean source label
// regardless of country — only this adapter's own name is country-suffixed.
export const linkedinVEAdapter: SourceAdapter = {
  name: 'LinkedIn-VE',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (let i = 0; i < keywords.length; i++) {
      if (i > 0) await jitterDelay();
      const results = await executeWithResilience('LinkedIn-VE', () =>
        scrapeLinkedIn(keywords[i], 'Venezuela')
      );
      allJobs.push(...results);
    }
    return deduplicateJobs(allJobs);
  }
};
