import { saveJobs, type InsertedJobRef } from "../db/job-repository.js";
import { estimateListingMs, hasBudget, type FetchContext } from "../engine/fetch-context.js";
import { reportSourceSignal, type RunRecorder } from "../observability/run-telemetry.js";
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
  /** P3 deadline/cancellation. Without it, behavior is unchanged. */
  ctx?: FetchContext;
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

    // P3 (EXE-003/EXE-005): the ONLY budget check in this function, and it
    // sits before the fetch. Everything past this line either hasn't fetched
    // anything yet (nothing to lose) or is already persisting (must finish).
    if (!hasBudget(options.ctx, estimateListingMs(options.source))) {
      reportSourceSignal("deadline_exceeded");
      attempt.setCounters({ received: 0, valid: 0, filtered: 0, new: 0, duplicate: 0 });
      return { fetched: 0, savedCount: 0, duplicateCount: 0, insertedJobs: [] };
    }

    const results = await fetchJobs();
    const fetched = Array.isArray(results) ? results.length : 0;
    attempt.setCounters({ received: fetched, valid: 0, filtered: 0, new: 0, duplicate: 0 });
    for (const job of results) options.stampCountry(job);
    if (fetched === 0) return { fetched, savedCount: 0, duplicateCount: 0, insertedJobs: [] };

    // NOT abortable from here on (EXE-005). Per-adapter saving exists because
    // of a real data-loss incident (2026-07-25, see scrape-worker.ts): jobs
    // already fetched must reach Postgres even if the deadline passed while
    // they were in flight. Cancelling a persist would re-create exactly the
    // bug this codebase already paid for once.
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
