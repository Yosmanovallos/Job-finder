import { SourceAdapter, Job } from './types.js';
import { scrapeElempleo } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';
import { jitterDelay } from '../engine/jitter-delay.js';

export const elempleoAdapter: SourceAdapter = {
  name: 'Elempleo',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (let i = 0; i < keywords.length; i++) {
      if (i > 0) await jitterDelay();
      const results = await executeWithResilience('Elempleo', () => scrapeElempleo(keywords[i]));
      allJobs.push(...results);
    }
    return allJobs;
  }
};
