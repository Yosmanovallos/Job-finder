import { SourceAdapter, Job } from './types.js';
import { scrapeTorre } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';

export const torreAdapter: SourceAdapter = {
  name: 'Torre',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (const kw of keywords) {
      const results = await executeWithResilience('Torre', () => scrapeTorre(kw));
      allJobs.push(...results);
    }
    return allJobs;
  }
};
