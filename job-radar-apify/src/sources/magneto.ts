import { SourceAdapter, Job, JobDetail } from './types.js';
import { fetchMagnetoDetail } from '../index.js';
import { executeWithResilience } from '../engine/resilient-fetch.js';
import { scrapeMagnetoCatalog } from './magneto-catalog.js';

// Magneto within its robots.txt: see src/sources/magneto-catalog.ts.
export const magnetoAdapter: SourceAdapter = {
  name: 'Magneto',
  // Catalog source: keywords are ignored (the keyword search is forbidden by robots.txt).
  async fetch(_keywords: string[], _dateRange?: string): Promise<Job[]> {
    return executeWithResilience('Magneto', () => scrapeMagnetoCatalog());
  },
  fetchDetail(url: string): Promise<Partial<JobDetail> | null> {
    return fetchMagnetoDetail(url);
  }
};
