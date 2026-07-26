import { SourceAdapter, Job, deduplicateJobs } from './types.js';
import { scrapeJooble } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';

// Same shape as remoteok.ts/getonboard.ts/weremoto.ts: ignores keywords —
// Jooble is a catalog-wide source scheduled via GLOBAL_SOURCE_CADENCE_MS
// (source-cadence.ts), not per role.
export const joobleAdapter: SourceAdapter = {
  name: 'Jooble',
  async fetch(_keywords: string[], _dateRange?: string): Promise<Job[]> {
    const jobs = await executeWithResilience('Jooble', () => scrapeJooble());
    return deduplicateJobs(jobs);
  }
};
