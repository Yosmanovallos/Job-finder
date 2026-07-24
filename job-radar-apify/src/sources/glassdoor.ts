import { SourceAdapter, Job } from './types.js';
import { scrapeGlassdoor } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';

export const glassdoorAdapter: SourceAdapter = {
  name: 'Glassdoor',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (const kw of keywords) {
      const results = await executeWithResilience('Glassdoor', () => scrapeGlassdoor(kw));
      allJobs.push(...results);
    }
    return allJobs;
  }
};
