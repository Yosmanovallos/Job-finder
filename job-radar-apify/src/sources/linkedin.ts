import { SourceAdapter, Job } from './types.js';
import { scrapeLinkedIn } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';

export const linkedinAdapter: SourceAdapter = {
  name: 'LinkedIn',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (const kw of keywords) {
      const results = await executeWithResilience('LinkedIn', () => scrapeLinkedIn(kw));
      allJobs.push(...results);
    }
    return allJobs;
  }
};
