import { SourceAdapter, Job, JobDetail, deduplicateJobs } from './types.js';
import { scrapeComputrabajo, fetchComputrabajoDetail } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';
import { jitterDelay } from '../engine/jitter-delay.js';

// See linkedin-ve.ts's comment — same isolation pattern. scrapeComputrabajo's
// "VE" country arg switches it to the real ve.computrabajo.com domain/proxy
// (COMPUTRABAJO_COUNTRY_CONFIG in index.ts), not a naive .co->.ve swap.
export const computrabajoVEAdapter: SourceAdapter = {
  name: 'Computrabajo-VE',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (let i = 0; i < keywords.length; i++) {
      if (i > 0) await jitterDelay();
      const results = await executeWithResilience('Computrabajo-VE', () =>
        scrapeComputrabajo(keywords[i], 'VE')
      );
      allJobs.push(...results);
    }
    return deduplicateJobs(allJobs);
  },
  fetchDetail(url: string): Promise<Partial<JobDetail> | null> {
    // fetchComputrabajoDetail infers CO vs VE from the URL's own host
    // (COMPUTRABAJO_COUNTRY_CONFIG lookup in index.ts), same as the -VE
    // suffix here is cosmetic — the real country signal is the URL itself.
    return fetchComputrabajoDetail(url);
  }
};
