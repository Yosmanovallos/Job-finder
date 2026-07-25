import { SourceAdapter, Job } from './types.js';
import { scrapeLinkedIn } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';
import { jitterDelay } from '../engine/jitter-delay.js';

export const linkedinAdapter: SourceAdapter = {
  name: 'LinkedIn',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (let i = 0; i < keywords.length; i++) {
      if (i > 0) await jitterDelay();
      const results = await executeWithResilience('LinkedIn', () => scrapeLinkedIn(keywords[i]));
      allJobs.push(...results);
    }
    return allJobs;
  }
};
