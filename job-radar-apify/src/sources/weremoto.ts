import { SourceAdapter, Job } from './types.js';
import { scrapeWeRemoto } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';

export const weremotoAdapter: SourceAdapter = {
  name: 'WeRemoto',
  async fetch(_keywords: string[], _dateRange?: string): Promise<Job[]> {
    return executeWithResilience('WeRemoto', () => scrapeWeRemoto());
  }
};
