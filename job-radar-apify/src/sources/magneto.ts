import { SourceAdapter, Job } from './types.js';
import { scrapeMagneto } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';

export const magnetoAdapter: SourceAdapter = {
  name: 'Magneto',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (const kw of keywords) {
      const results = await executeWithResilience('Magneto', () => scrapeMagneto(kw));
      allJobs.push(...results);
    }
    return allJobs;
  }
};
