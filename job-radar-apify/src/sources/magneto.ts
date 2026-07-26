import { SourceAdapter, Job, deduplicateJobs } from './types.js';
import { scrapeMagneto } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';
import { jitterDelay } from '../engine/jitter-delay.js';

export const magnetoAdapter: SourceAdapter = {
  name: 'Magneto',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (let i = 0; i < keywords.length; i++) {
      if (i > 0) await jitterDelay();
      const results = await executeWithResilience('Magneto', () => scrapeMagneto(keywords[i]));
      allJobs.push(...results);
    }
    return deduplicateJobs(allJobs);
  }
};
