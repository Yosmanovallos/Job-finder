/**
 * Detail-stage results (P4, spec SRC-003).
 *
 * `fetchDetail()` answers about ONE job's own page and returns
 * `Partial<JobDetail> | null`. Before P4 the call site turned that `null`
 * into `[]` so it would fit `executeWithResilience`'s `Promise<T[]>`, and the
 * wrapper read every array as a success. That is the exact path that made the
 * detail circuit unopenable.
 *
 * These two helpers exist so the call site can say which of the two happened
 * without inventing a shape: a detail that exists, or a page that yielded
 * nothing usable. "Nothing usable" is a legitimate answer about a job posting
 * — it is not a transport fault, and it is not a success either.
 */

import type { JobDetail } from "./types.js";
import {
  emptyResult as emptyFetchResult,
  successResult as successFetchResult,
  type SourceFetchResult
} from "./fetch-result.js";

export type JobDetailResult = SourceFetchResult<Partial<JobDetail>>;

/** One detail page yielded usable data. */
export function successResult(detail: Partial<JobDetail>): JobDetailResult {
  return successFetchResult([detail], { received: 1, valid: 1, requests: 1, bytes: null });
}

/**
 * The detail page was fetched and yielded nothing usable. Neutral for the
 * circuit: it neither forgives past failures nor invents a new one.
 */
export function emptyResult(): JobDetailResult {
  return emptyFetchResult("no_detail", { received: 1, valid: 0, requests: 1, bytes: null });
}
