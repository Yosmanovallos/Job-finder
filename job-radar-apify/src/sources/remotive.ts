import { SourceAdapter, Job } from './types.js';
import { scrapeRemotive } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';

export const remotiveAdapter: SourceAdapter = {
  name: 'Remotive',
  async fetch(keywords: string[], _dateRange?: string): Promise<Job[]> {
    return executeWithResilience('Remotive', () => scrapeRemotive(keywords));
  }
};
