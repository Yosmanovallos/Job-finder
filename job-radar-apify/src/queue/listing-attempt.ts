import { saveJobs, type InsertedJobRef } from "../db/job-repository.js";
import type { RunRecorder } from "../observability/run-telemetry.js";
import type { Job } from "../sources/types.js";

// Shared by ScrapeWorker, the global-catalog step and the browser tick
// (P2). Kept out of scrape-worker.ts on purpose: importing that module pulls
// in src/sources -> src/index.ts, which exits the process without Notion
// settings — the browser tick's workflow doesn't define them.

export interface ListingOutcome {
  fetched: number;
  savedCount: number;
  duplicateCount: number;
  insertedJobs: InsertedJobRef[];
}

export interface ListingAttemptOptions {
  source: string;
  role: string | null;
  roleOrigin: string;
  stampCountry: (job: Job) => void;
  /** Receives the attempt id as soon as it starts, so a caller's catch can still read its status. */
  attemptRef?: { id?: string };
}

/**
 * Fetch + persist one source's listing inside a tracked attempt. Jobs are
 * saved exactly as before; telemetry only observes (its writes are queued
 * off this path), and any error propagates unchanged to the caller.
 */
export async function runListingAttempt(
  recorder: RunRecorder,
  options: ListingAttemptOptions,
  fetchJobs: () => Promise<Job[]>
): Promise<ListingOutcome> {
  return recorder.trackAttempt({ source: options.source, role: options.role, stage: "listing" }, async (attempt) => {
    if (options.attemptRef) options.attemptRef.id = attempt.id;
    const results = await fetchJobs();
    const fetched = Array.isArray(results) ? results.length : 0;
    attempt.setCounters({ received: fetched, valid: 0, filtered: 0, new: 0, duplicate: 0 });
    for (const job of results) options.stampCountry(job);
    if (fetched === 0) return { fetched, savedCount: 0, duplicateCount: 0, insertedJobs: [] };

    attempt.setPhase("persist");
    const saved = await saveJobs(results, options.roleOrigin);
    attempt.setCounters({
      valid: saved.validCount,
      filtered: fetched - saved.validCount,
      new: saved.savedCount,
      duplicate: saved.duplicateCount
    });
    return { fetched, savedCount: saved.savedCount, duplicateCount: saved.duplicateCount, insertedJobs: saved.insertedJobs };
  });
}
