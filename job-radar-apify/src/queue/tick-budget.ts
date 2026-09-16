/**
 * Budget arithmetic for one scrape tick (P3, spec EXE-002).
 *
 * The defect this replaces: the tick's sub-timeouts were independent
 * constants that happened not to fit inside the global deadline —
 *
 *     global catalog  3 min
 *     8 roles / concurrency 2 = 4 batches x 5 min = 20 min
 *     -------------------------------------------------
 *     permitted work                              23 min
 *     OVERALL_DEADLINE_MS                         20 min
 *     workflow timeout-minutes                    27 min
 *
 * With 23 > 20 the straggler wait computed a negative `remainingMs`, skipped
 * itself entirely, and left the process in `pool.end()` — which blocks until
 * stragglers release their clients and had no bound at all. That is the
 * stretch that reached 27-28 min and collected the hard kill (25% of CO
 * ticks).
 *
 * The fix is directional: the global deadline is the source of truth and
 * every sub-budget is DERIVED from what is actually left. A fast batch hands
 * its surplus to the next one; a slow batch cannot take the close-out
 * reserve, because the reserve is subtracted before any of the work budget
 * is handed out.
 */

/** Held back for finish() + purge + pool.end(), outside the work budget. */
export const TEARDOWN_RESERVE_MS = 2 * 60_000;
/** Ceiling for one batch, so one stuck batch can't absorb the whole tick. */
export const MAX_PER_BATCH_MS = 5 * 60_000;
/** Global catalog takes at most this, or a quarter of the work budget. */
export const MAX_GLOBAL_CATALOG_MS = 3 * 60_000;
const GLOBAL_CATALOG_SHARE = 0.25;

export interface TickBudgetInput {
  totalMs: number;
  roleCount: number;
  concurrency: number;
}

export interface BatchBudgetInput {
  /** Milliseconds since the tick started. */
  elapsedMs: number;
  /** Batches still to run, including this one. */
  batchesRemaining: number;
}

export interface TickBudgetPlan {
  totalMs: number;
  reserveMs: number;
  /** Total time available for actual scraping (total − reserve). */
  workMs: number;
  globalCatalogMs: number;
  batchCount: number;
  maxPerBatchMs: number;
  budgetForBatch(input: BatchBudgetInput): number;
}

export function planTickBudget({ totalMs, roleCount, concurrency }: TickBudgetInput): TickBudgetPlan {
  const reserveMs = Math.min(TEARDOWN_RESERVE_MS, Math.floor(totalMs / 4));
  const workMs = Math.max(0, totalMs - reserveMs);
  const globalCatalogMs = Math.min(MAX_GLOBAL_CATALOG_MS, Math.floor(workMs * GLOBAL_CATALOG_SHARE));
  const batchCount = concurrency > 0 ? Math.ceil(roleCount / concurrency) : 0;

  // The ceiling is whichever is smaller: the fixed per-batch cap, or an even
  // share of what's left after the catalog step. This is what makes the
  // invariant `catalog + batches*ceiling <= workMs` hold by construction
  // instead of by coincidence.
  const evenShare = batchCount > 0 ? Math.floor((workMs - globalCatalogMs) / batchCount) : 0;
  const maxPerBatchMs = Math.min(MAX_PER_BATCH_MS, Math.max(0, evenShare));

  return {
    totalMs,
    reserveMs,
    workMs,
    globalCatalogMs,
    batchCount,
    maxPerBatchMs,
    budgetForBatch({ elapsedMs, batchesRemaining }: BatchBudgetInput): number {
      if (batchesRemaining <= 0) return 0;
      // What's genuinely left for work right now — the reserve is already
      // excluded, so a late batch shortens itself instead of the teardown.
      const leftForWork = Math.max(0, workMs - elapsedMs);
      const fairShare = Math.floor(leftForWork / batchesRemaining);
      return Math.min(maxPerBatchMs, fairShare);
    }
  };
}
