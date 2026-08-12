import { SourceAdapter, Job, JobDetail, deduplicateJobs } from './types.js';
import { scrapeComputrabajo, fetchComputrabajoDetail } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';
import { jitterDelay } from '../engine/jitter-delay.js';

export const computrabajoAdapter: SourceAdapter = {
  name: 'Computrabajo',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (let i = 0; i < keywords.length; i++) {
      if (i > 0) await jitterDelay();
      const results = await executeWithResilience('Computrabajo', () => scrapeComputrabajo(keywords[i]));
      allJobs.push(...results);
    }
    return deduplicateJobs(allJobs);
  },
  fetchDetail(url: string): Promise<Partial<JobDetail> | null> {
    return fetchComputrabajoDetail(url);
  }
};
