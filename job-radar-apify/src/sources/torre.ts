import { SourceAdapter, Job, deduplicateJobs } from './types.js';
import { scrapeTorre } from '../index.js';
import { executeWithResilienceResult } from '../engine/resilient-fetch.js';
import { liftJobArray, successResult, emptyResult, type SourceFetchResult } from './fetch-result.js';
import type { FetchContext } from '../engine/fetch-context.js';

/**
 * Torre — the single adapter migrated to the P4 contract, as the working
 * demonstration that adoption can be gradual (spec SRC-002).
 *
 * Chosen by reading the file and the data, not by feel: it is the smallest
 * adapter, it does not implement `fetchDetail`, and over 7 days of production
 * it recorded 50 listing attempts, 50 successes, 3659 received / 3654 valid
 * and zero detail rows. Migrating it exercises the new path without being
 * able to damage enrichment.
 *
 * `fetch` stays as a one-line delegation so every existing caller keeps
 * working unchanged.
 */
/**
 * Keyword variants searched per role. Torre's search is semantic, so the
 * seniority/word-order variants after the first few return the same postings
 * or none: production ticks 2026-10-21/22 sent ~11 variants per role and the
 * Spanish non-tech roles came back 0 on every one of them.
 */
export const TORRE_MAX_KEYWORDS = 3;

export const torreAdapter: SourceAdapter = {
  name: 'Torre',

  async fetchResult(
    keywords: string[],
    _dateRange?: string,
    ctx?: FetchContext
  ): Promise<SourceFetchResult<Job>> {
    const allJobs: Job[] = [];
    let requests = 0;
    let lastFailure: SourceFetchResult<Job> | null = null;

    for (const kw of keywords.slice(0, TORRE_MAX_KEYWORDS)) {
      const result = await executeWithResilienceResult<Job>(
        'Torre',
        'listing',
        async () => {
          const jobs = await scrapeTorre(kw);
          return liftJobArray<Job>(jobs);
        },
        3,
        ctx
      );
      requests += result.counters.requests;
      allJobs.push(...result.data);
      // Remember the first real fault so the aggregate can explain itself.
      // A keyword that legitimately found nothing is not a fault.
      if (!lastFailure && result.outcome !== 'success' && result.outcome !== 'empty') {
        lastFailure = result;
      }
    }

    const unique = deduplicateJobs(allJobs);
    const counters = { received: unique.length, valid: unique.length, requests, bytes: null };

    // Some keywords worked and something went wrong on others: that is
    // `partial`, and saying so is the whole point of migrating.
    if (unique.length > 0 && lastFailure?.error) {
      return {
        outcome: 'partial',
        data: unique,
        counters,
        error: lastFailure.error,
        reason: lastFailure.reason
      };
    }
    if (unique.length > 0) return successResult(unique, counters);
    // Nothing came back at all. If a fault explains it, report the fault —
    // never the empty array that used to hide it.
    if (lastFailure) return { ...lastFailure, counters };
    return emptyResult('no_results', counters);
  },

  async fetch(keywords: string[], dateRange?: string): Promise<Job[]> {
    const result = await this.fetchResult!(keywords, dateRange);
    return result.data;
  }
};
