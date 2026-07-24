import { SourceAdapter, Job } from './types.js';
import { scrapeElempleo } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';

export const elempleoAdapter: SourceAdapter = {
  name: 'Elempleo',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (const kw of keywords) {
      const results = await executeWithResilience('Elempleo', () => scrapeElempleo(kw));
      allJobs.push(...results);
    }
    return allJobs;
  }
};
