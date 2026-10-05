/**
 * Source-closure check — removes postings the SOURCE says are closed.
 *
 * Why: until 2026-10-04 the only expiration path was purgeOldJobs() ("not
 * re-seen for 30 days"). A read-only audit of production that day found 3410
 * of 3703 visible Torre rows (92%) already `status: "closed"` on Torre. Users
 * were sent to dead postings. Torre is the first source wired here because it
 * exposes a public per-posting status endpoint (src/sources/torre-status.ts).
 *
 * Bounded by design (AGENTS.md rule 12): a row cap per pass, fixed
 * concurrency, a FetchContext deadline, and no retries inside a pass — an
 * inconclusive answer simply waits for the next pass.
 *
 * Deletion policy (evidence only):
 *   - explicit non-"open" status in a 200 JSON body → delete. Trusted even
 *     when other answers in the pass are failing: it is the source's own word.
 *   - 404 → delete, UNLESS the pass looks degraded (more than half the
 *     answers were 404/unknown). A 404 storm means the endpoint moved, not
 *     that every posting vanished at once; then 404s are left for later.
 *   - unknown (timeouts, 5xx, 429, malformed) → never delete.
 */
import type { FetchContext } from "../engine/fetch-context.js";
import { hasBudget, isCancelled } from "../engine/fetch-context.js";
import { fetchTorreOpportunityStatus, torreIdFromUrl, type TorreStatusVerdict } from "../sources/torre-status.js";
import {
  isMissingClosureColumn,
  markClosureChecked,
  pickJobsForClosureCheck,
  type ClosureCandidate
} from "../db/source-closure-repository.js";
import { deleteClosedJobs } from "../db/scheduler-repository.js";

export const CLOSURE_DEFAULT_LIMIT = 400;
export const CLOSURE_DEFAULT_CONCURRENCY = 3;
/** One status request plausibly fits in this; below it no new request starts. */
const PER_REQUEST_ESTIMATE_MS = 2_000;
/** Below this many answers the degraded-pass ratio is noise, not a signal. */
const DEGRADED_MIN_SAMPLE = 10;

export interface ClosureDeps {
  pick(source: string, limit: number): Promise<ClosureCandidate[]>;
  markChecked(jobIds: string[]): Promise<void>;
  deleteClosed(jobIds: string[]): Promise<number>;
  check(externalId: string, signal?: AbortSignal): Promise<TorreStatusVerdict>;
}

export interface ClosureReport {
  source: "Torre";
  skipped: null | "missing_column";
  dryRun: boolean;
  picked: number;
  checked: number;
  open: number;
  closed: number;
  notFound: number;
  unknown: number;
  unverifiable: number;
  deleted: number;
  degraded: boolean;
  stoppedEarly: boolean;
  closedStatuses: Record<string, number>;
  /** Job ids that were (or, in dry-run, would be) deleted. */
  closedJobIds: string[];
}

const defaultDeps: ClosureDeps = {
  pick: pickJobsForClosureCheck,
  markChecked: markClosureChecked,
  deleteClosed: deleteClosedJobs,
  check: (id, signal) => fetchTorreOpportunityStatus(id, { signal })
};

export async function verifyTorreClosures(
  ctx?: FetchContext,
  options: { limit?: number; concurrency?: number; dryRun?: boolean; deps?: ClosureDeps } = {}
): Promise<ClosureReport> {
  const deps = options.deps ?? defaultDeps;
  const limit = Math.max(1, Math.min(options.limit ?? CLOSURE_DEFAULT_LIMIT, 5000));
  const concurrency = Math.max(1, Math.min(options.concurrency ?? CLOSURE_DEFAULT_CONCURRENCY, 6));
  const dryRun = options.dryRun === true;
  const report: ClosureReport = {
    source: "Torre",
    skipped: null,
    dryRun,
    picked: 0,
    checked: 0,
    open: 0,
    closed: 0,
    notFound: 0,
    unknown: 0,
    unverifiable: 0,
    deleted: 0,
    degraded: false,
    stoppedEarly: false,
    closedStatuses: {},
    closedJobIds: []
  };

  let candidates: ClosureCandidate[];
  try {
    candidates = await deps.pick("Torre", limit);
  } catch (error) {
    if (isMissingClosureColumn(error)) {
      report.skipped = "missing_column";
      return report;
    }
    throw error;
  }
  report.picked = candidates.length;

  const toCheck: { id: string; externalId: string }[] = [];
  const checkedIds: string[] = [];
  for (const candidate of candidates) {
    const externalId = torreIdFromUrl(candidate.url);
    if (externalId) toCheck.push({ id: candidate.id, externalId });
    else {
      // Nothing to ask the source about. Rotate it out; the age purge remains its backstop.
      report.unverifiable++;
      checkedIds.push(candidate.id);
    }
  }

  const closedIds: string[] = [];
  const notFoundIds: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < toCheck.length) {
      if (isCancelled(ctx) || !hasBudget(ctx, PER_REQUEST_ESTIMATE_MS)) {
        report.stoppedEarly = true;
        return;
      }
      const item = toCheck[next++];
      const verdict = await deps.check(item.externalId, ctx?.signal);
      report.checked++;
      switch (verdict.kind) {
        case "open":
          report.open++;
          checkedIds.push(item.id);
          break;
        case "closed":
          report.closed++;
          report.closedStatuses[verdict.status] = (report.closedStatuses[verdict.status] ?? 0) + 1;
          closedIds.push(item.id);
          break;
        case "not_found":
          report.notFound++;
          notFoundIds.push(item.id);
          break;
        case "unknown":
          report.unknown++;
          // Rotated, not retried in-pass: the next pass after the recheck window asks again.
          checkedIds.push(item.id);
          break;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, toCheck.length) }, worker));

  const anomalies = report.notFound + report.unknown;
  report.degraded = report.checked >= DEGRADED_MIN_SAMPLE && anomalies * 2 > report.checked;

  const toDelete = report.degraded ? closedIds : [...closedIds, ...notFoundIds];
  if (report.degraded) checkedIds.push(...notFoundIds);
  report.closedJobIds = toDelete;

  if (!dryRun) {
    report.deleted = await deps.deleteClosed(toDelete);
    await deps.markChecked(checkedIds);
  }
  return report;
}

export function formatClosureReport(report: ClosureReport): string {
  if (report.skipped === "missing_column") {
    return "🧹 [Cierre fuente] Torre omitido: falta jobs.source_checked_at — correr scripts/migrate-source-closure.ts.";
  }
  const statuses = Object.entries(report.closedStatuses)
    .map(([status, count]) => `${status}=${count}`)
    .join(", ");
  return (
    `🧹 [Cierre fuente] Torre${report.dryRun ? " (dry-run)" : ""}: ${report.picked} candidatas, ${report.checked} consultadas → ` +
    `${report.open} abiertas, ${report.closed} cerradas${statuses ? ` (${statuses})` : ""}, ${report.notFound} no encontradas, ` +
    `${report.unknown} sin respuesta concluyente, ${report.unverifiable} sin id. ` +
    `${report.dryRun ? "Se eliminarían" : "Eliminadas"}: ${report.dryRun ? report.closedJobIds.length : report.deleted}` +
    `${report.degraded ? " — pasada degradada: 404 conservados" : ""}${report.stoppedEarly ? " — detenida por plazo" : ""}.`
  );
}
