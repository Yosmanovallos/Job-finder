import { SourceAdapter, Job } from './types.js';
import { scrapeIndeedLocal } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';

export const indeedAdapter: SourceAdapter = {
  name: 'Indeed',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (const kw of keywords) {
      const results = await executeWithResilience('Indeed', () => scrapeIndeedLocal(kw));
      allJobs.push(...results);
    }
    return allJobs;
  }
};
