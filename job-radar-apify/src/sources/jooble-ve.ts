import { SourceAdapter, Job, deduplicateJobs } from './types.js';
import { scrapeJooble } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';

// Same shape as jooble.ts: ignores keywords, catalog-wide, scheduled via
// GLOBAL_SOURCE_CADENCE_MS_VE under the '__global__' sentinel role — but
// registered under its OWN name ('Jooble-VE') so its cadence row never
// collides with CO's ('__global__','Jooble') row (see source-cadence.ts).
// Unlike RemoteOK/GetOnBoard/WeRemoto, this genuinely needs its own fetch:
// Jooble's API takes a location filter, so "Venezuela" returns different
// postings than CO's "Colombia" call, not the same shared catalog.
export const joobleVEAdapter: SourceAdapter = {
  name: 'Jooble-VE',
  async fetch(_keywords: string[], _dateRange?: string): Promise<Job[]> {
    const jobs = await executeWithResilience('Jooble-VE', () => scrapeJooble('Venezuela'));
    return deduplicateJobs(jobs);
  }
};
