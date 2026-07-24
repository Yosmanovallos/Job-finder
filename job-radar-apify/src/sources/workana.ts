import { SourceAdapter, Job } from './types.js';
import { scrapeWorkana } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';

export const workanaAdapter: SourceAdapter = {
  name: 'Workana',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (const kw of keywords) {
      const results = await executeWithResilience('Workana', () => scrapeWorkana(kw));
      allJobs.push(...results);
    }
    return allJobs;
  }
};
