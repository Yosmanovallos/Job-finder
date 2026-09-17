/**
 * How a source outcome affects its circuit breaker (P4, spec SRC-003).
 *
 * THE DEFECT THIS FIXES, measured in production on 2026-09-16:
 *
 * `executeWithResilience` treated ANY array as a success —
 * `if (Array.isArray(results)) { await recordSuccess(sourceName); }` — and
 * the detail call site in scrape-worker.ts turned a missing detail into one:
 * `return result ? [result] : []`. So `fetchDetail() === null` reached
 * `recordSuccess` and reset the failure counter.
 *
 * The proof is the live table, not an inference: `source_circuit_state` held
 * exactly four rows (Glassdoor, GlassdoorV2, Indeed, Workana) and NONE ending
 * in `-detail`. Since `recordFailure` INSERTs and `recordSuccess` only
 * UPDATEs, the absence of the row shows `recordFailure` had never once been
 * called on a detail path — while Computrabajo spent 102 detail pages over 24
 * attempts for 0 usable details, paying ~3.2s per page, indefinitely.
 *
 * The fix is a third effect. A circuit has always had "success" and
 * "failure"; what it was missing is "this attempt taught me nothing".
 */

import type { SourceOutcome } from "../sources/fetch-result.js";

export type CircuitEffect = "reset" | "increment" | "neutral";

/**
 * `neutral` is the whole point: it neither resets nor increments.
 *
 * Why `empty` is neutral and not a failure: a job posting can legitimately
 * have no useful detail page, and counting that as a failure would open
 * circuits on healthy sources. What it must never do again is ERASE the
 * history of real failures.
 *
 * Why `timeout` is neutral: running out of tick budget is a fact about us,
 * not about the source's health. Penalizing a source for our own deadline
 * would open circuits every time a tick ran late.
 *
 * Why `partial` resets: data did come through, so the transport works. The
 * shortfall is recorded in the attempt's counters, which is where it belongs.
 */
const EFFECTS: Record<SourceOutcome, CircuitEffect> = {
  success: "reset",
  partial: "reset",
  empty: "neutral",
  timeout: "neutral",
  blocked: "increment",
  rate_limited: "increment",
  quota_exhausted: "increment",
  misconfigured: "increment",
  schema_changed: "increment",
  failed: "increment"
};

export function circuitEffectOf(outcome: SourceOutcome): CircuitEffect {
  return EFFECTS[outcome];
}
