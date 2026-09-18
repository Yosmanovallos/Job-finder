/**
 * Detail enrichment through the persistent state machine (Job SEO V2, phase C).
 *
 * Two entry points share one attempt loop:
 *  - enrichInsertedJobs(): the in-tick slice right after a listing saved new
 *    rows (same cap and cool-down as before);
 *  - drainDetailQueue(): a bounded step at the end of the tick for rows that
 *    were left 'pending' by the cap, or are due for a 'retry'.
 *
 * Source safety (AGENTS.md #8/#12): per-(source, 'detail') circuit and policy
 * from P4, jitter between requests, the tick's FetchContext deadline, and the
 * loop stops for that source on an open circuit, a block, a rate limit or the
 * deadline — without charging the job an attempt for our own decision to stop.
 */
import type { SourceAdapter, JobDetail } from "../sources/types.js";
import { executeWithResilienceResult } from "../engine/resilient-fetch.js";
import { emptyResult, successResult, type JobDetailResult } from "../sources/detail-result.js";
import { circuitKeyFor, resolvePolicy } from "../sources/source-policy.js";
import { BUDGET_ESTIMATES, hasBudget, isCancelled, type FetchContext } from "../engine/fetch-context.js";
import { jitterDelay } from "../engine/jitter-delay.js";
import { reportSourceSignal, type AttemptHandle } from "../observability/run-telemetry.js";
import { claimDueDetailJobs, recordDetailOutcome, type ClaimedDetailJob } from "../db/job-readiness-repository.js";
import { DETAIL_ADAPTER_NAMES } from "../sources/detail-capability.js";

/** Fallback cap when a source declares no maxRequestsPerAttempt (today's behavior). */
export const DEFAULT_DETAIL_CAP = 8;

const STOP_REASONS = new Set(["circuit_open", "deadline_exceeded"]);
const STOP_OUTCOMES = new Set(["blocked", "rate_limited", "quota_exhausted"]);

export interface EnrichmentCounters {
  claimed: number;
  complete: number;
  rejected: number;
  retry: number;
  noDetail: number;
  failed: number;
  stoppedEarly: boolean;
}

function emptyCounters(): EnrichmentCounters {
  return { claimed: 0, complete: 0, rejected: 0, retry: 0, noDetail: 0, failed: 0, stoppedEarly: false };
}

export function detailCapFor(adapterName: string): number {
  return resolvePolicy(adapterName, "detail").maxRequestsPerAttempt ?? DEFAULT_DETAIL_CAP;
}

async function runClaimed(
  adapter: SourceAdapter,
  jobs: ClaimedDetailJob[],
  counters: EnrichmentCounters,
  ctx?: FetchContext,
  attempt?: AttemptHandle
): Promise<void> {
  for (let i = 0; i < jobs.length; i++) {
    if (!hasBudget(ctx, BUDGET_ESTIMATES.detailFetch) || isCancelled(ctx)) {
      reportSourceSignal("deadline_exceeded");
      counters.stoppedEarly = true;
      break;
    }
    if (i > 0) await jitterDelay(1000, 3000, ctx);
    const job = jobs[i];
    const result = await executeWithResilienceResult<Partial<JobDetail>>(
      circuitKeyFor(adapter.name, "detail"),
      "detail",
      async (): Promise<JobDetailResult> => {
        const detail = await adapter.fetchDetail!(job.url);
        return detail ? successResult(detail) : emptyResult();
      },
      3,
      ctx
    );

    // Our own decision to stop is not the job's fault: the row keeps its
    // state and becomes claimable again when the lease expires.
    if (STOP_REASONS.has(result.reason) || STOP_OUTCOMES.has(result.outcome)) {
      if (STOP_OUTCOMES.has(result.outcome)) {
        await recordDetailOutcome(job.id, {
          kind: "fault",
          errorClass: result.error?.class ?? result.outcome,
          retryAfterMs: result.error?.retryAfterMs
        });
        counters.retry++;
      }
      counters.stoppedEarly = true;
      break;
    }

    const detail = result.data[0];
    const status = detail
      ? await recordDetailOutcome(job.id, { kind: "success", detail })
      : result.outcome === "empty"
        ? await recordDetailOutcome(job.id, { kind: "no_detail" })
        : await recordDetailOutcome(job.id, {
            kind: "fault",
            errorClass: result.error?.class ?? result.outcome,
            retryAfterMs: result.error?.retryAfterMs
          });
    if (status === "complete") counters.complete++;
    else if (status === "rejected") counters.rejected++;
    else if (status === "retry") counters.retry++;
    else if (status === "no_detail") counters.noDetail++;
    else if (status === "failed") counters.failed++;
    // "valid" = a usable detail really obtained from the source (P2/P4
    // telemetry meaning), whether or not it later passes the Google gate.
    attempt?.setCounters({ valid: counters.complete + counters.rejected, failed: counters.failed + counters.retry });
  }
}

/** In-tick slice for rows this listing just inserted (only those still 'pending'). */
export async function enrichInsertedJobs(
  adapter: SourceAdapter,
  insertedIds: string[],
  attempt?: AttemptHandle,
  ctx?: FetchContext
): Promise<EnrichmentCounters> {
  const counters = emptyCounters();
  if (!adapter.fetchDetail || insertedIds.length === 0) return counters;
  const cap = detailCapFor(adapter.name);
  const claimed = await claimDueDetailJobs({ ids: insertedIds }, cap);
  counters.claimed = claimed.length;
  attempt?.setCounters({ received: insertedIds.length, filtered: insertedIds.length - claimed.length, valid: 0, failed: 0 });
  if (claimed.length === 0) return counters;
  // Cool-down before the first detail request (confirmed live 2026-08-11:
  // starting right after a listing burst raises the null rate on the host).
  await jitterDelay(3000, 6000, ctx);
  await runClaimed(adapter, claimed, counters, ctx, attempt);
  return counters;
}

/**
 * Bounded drain of due 'pending'/'retry' rows, one adapter at a time, each
 * capped by its own detail policy. Never touches legacy 'backlog' rows.
 */
export async function drainDetailQueue(
  adapters: SourceAdapter[],
  ctx?: FetchContext
): Promise<Record<string, EnrichmentCounters>> {
  const report: Record<string, EnrichmentCounters> = {};
  for (const name of DETAIL_ADAPTER_NAMES) {
    const adapter = adapters.find((candidate) => candidate.name === name);
    if (!adapter?.fetchDetail) continue;
    if (!hasBudget(ctx, BUDGET_ESTIMATES.detailFetch) || isCancelled(ctx)) break;
    const counters = emptyCounters();
    const claimed = await claimDueDetailJobs(
      { source: name.replace(/-VE$/, ""), market: name.endsWith("-VE") ? "VE" : "OTHER" },
      detailCapFor(name)
    );
    counters.claimed = claimed.length;
    if (claimed.length > 0) await runClaimed(adapter, claimed, counters, ctx);
    report[name] = counters;
  }
  return report;
}
