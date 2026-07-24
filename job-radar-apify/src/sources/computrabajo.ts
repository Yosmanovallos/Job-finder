import { SourceAdapter, Job } from './types.js';
import { scrapeComputrabajo } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';

export const computrabajoAdapter: SourceAdapter = {
  name: 'Computrabajo',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    const allJobs: Job[] = [];
    for (const kw of keywords) {
      const results = await executeWithResilience('Computrabajo', () => scrapeComputrabajo(kw));
      allJobs.push(...results);
    }
    return allJobs;
  }
};
