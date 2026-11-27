import { canConfirmClosure, confirmPostingGone, listBoard } from "./connectors.js";
import { isSuspectDrop, selectColombianPostings, SUSPECT_LISTINGS_BEFORE_ACCEPTING, type SelectionStats } from "./ingest.js";
import type { EmployerSourceRow, SaveListingResult, SourceOutcome } from "../db/direct-repository.js";
import type { DirectPosting, HttpGet } from "./types.js";

/**
 * One official-vacancy tick (ADR 0006): read each due board, keep its live
 * Colombian postings, store them, and close only on complete evidence.
 * Repository calls are injected so the integration test drives real SQL with
 * fixture HTTP, and --dry-run drives no SQL at all.
 */

export interface TickDeps {
  http: HttpGet;
  saveListing(source: EmployerSourceRow, postings: DirectPosting[], applyClosures: boolean): Promise<SaveListingResult>;
  recordOutcome(sourceId: string, outcome: SourceOutcome): Promise<void>;
  closeConfirmed(sourceId: string, externalIds: string[]): Promise<number>;
  /** External ids already stored for the board (connectors fetch details only for new ones). */
  knownIds?(sourceId: string): Promise<Set<string>>;
}

// Posting pages fetched per board and read, for connectors whose listing
// lacks the date or the description. New postings beyond it wait a read.
export const DETAIL_BUDGET = 25;

// Per-posting checks per board and tick (one request each).
const MAX_CLOSURE_CONFIRMATIONS = 25;

/**
 * Minimum hours between two reads of the same board. The cron asks for every
 * hour, but GitHub fires only ~5 scheduled runs a day, 3.5-8 h apart (ADR
 * 0006 §14). Each run reads the oldest due boards until its deadline; at 5 h
 * the runs landing ~4 h after the previous one read 0 boards, so 3 h lets
 * every run that fires read the whole due set (the report prints the oldest
 * last_ok_at to prove it).
 */
export const MIN_INTERVAL_HOURS = 3;

export interface SourceReport {
  employer: string;
  board: string;
  status: SourceOutcome["status"];
  detail: string | null;
  stats: SelectionStats | null;
  saved: SaveListingResult | null;
}

// Boards read at once. The four APIs are different hosts, but one tick may
// hold many boards of the same host; 3 keeps every host far under its limits.
const CONCURRENCY = 3;

export const WORKDAY_POD_PAUSE_MS = 2_500;
export const WORKDAY_POD_429_COOLDOWN_MS = 10_000;
export const WORKDAY_POD_MAX_CONSECUTIVE_429 = 3;

export interface DirectTickOptions {
  workdayPodPauseMs?: number;
  workdayPod429CooldownMs?: number;
  workdayPodMaxConsecutive429?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Extracts the `wdN` cluster pod from a Workday source; null for any other ATS. */
export function workdayPodOf(source: Pick<EmployerSourceRow, "atsType" | "atsRef">): string | null {
  if (source.atsType !== "workday") return null;
  const match = /^[^/]+\/(wd\d{1,3})\//i.exec(source.atsRef);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Round-robins sources by ATS/pod bucket while keeping relative order inside
 * each bucket, preventing back-to-back Workday pod bursts.
 */
export function interleaveSourcesByHost(sources: EmployerSourceRow[]): EmployerSourceRow[] {
  const buckets = new Map<string, EmployerSourceRow[]>();
  for (const source of sources) {
    const pod = workdayPodOf(source);
    const key = source.atsType === "workday" ? `workday:${pod ?? "unknown"}` : source.atsType;
    const list = buckets.get(key);
    if (list) list.push(source);
    else buckets.set(key, [source]);
  }
  const ordered: EmployerSourceRow[] = [];
  const queues = [...buckets.values()];
  let index = 0;
  while (ordered.length < sources.length) {
    for (const queue of queues) {
      if (index < queue.length) ordered.push(queue[index]);
    }
    index++;
  }
  return ordered;
}

export async function runSource(source: EmployerSourceRow, deps: TickDeps, now = new Date()): Promise<SourceReport> {
  const board = `${source.atsType}:${source.atsRef}`;
  const knownIds = deps.knownIds ? await deps.knownIds(source.id) : new Set<string>();
  const listing = await listBoard(source, deps.http, { knownIds, detailBudget: DETAIL_BUDGET });
  if (listing.kind !== "complete") {
    await deps.recordOutcome(source.id, { status: listing.kind, detail: listing.detail });
    return { employer: source.employerSlug, board, status: listing.kind, detail: listing.detail, stats: null, saved: null };
  }
  const { postings, stats } = selectColombianPostings(listing.postings, now);
  const drop = isSuspectDrop(source.lastBoardTotal, listing.boardTotal)
    ? `el tablero pasó de ${source.lastBoardTotal} a ${listing.boardTotal} vacantes`
    : isSuspectDrop(source.lastColombiaTotal, stats.colombia)
      ? `las vacantes en Colombia pasaron de ${source.lastColombiaTotal} a ${stats.colombia}`
      : null;
  // The same drop seen SUSPECT_LISTINGS_BEFORE_ACCEPTING times in a row is
  // real: accept it as the new baseline and let closures run.
  const suspect = drop !== null && source.consecutiveSuspect + 1 < SUSPECT_LISTINGS_BEFORE_ACCEPTING;
  // A suspicious listing still refreshes what it does show; it just can't
  // prove anything is gone.
  const saved = await deps.saveListing(source, postings, !suspect);
  // First miss: where the ATS has a per-posting endpoint, ask it. A 404/410
  // closes now — the apply link is already dead — instead of after a second
  // listing. Bounded per board.
  if (canConfirmClosure(source.atsType) && saved.missingIds.length > 0) {
    const gone: string[] = [];
    for (const externalId of saved.missingIds.slice(0, MAX_CLOSURE_CONFIRMATIONS)) {
      if (await confirmPostingGone(source, externalId, deps.http)) gone.push(externalId);
    }
    const confirmed = await deps.closeConfirmed(source.id, gone);
    saved.closed += confirmed;
    saved.markedMissing -= confirmed;
  }
  const detail = suspect ? `${drop}: no se cerró nada` : drop ? `${drop}: aceptado tras ${SUSPECT_LISTINGS_BEFORE_ACCEPTING} listados` : null;
  await deps.recordOutcome(
    source.id,
    suspect
      ? { status: "suspect", detail: detail! }
      : { status: "ok", boardTotal: listing.boardTotal, colombiaTotal: stats.colombia }
  );
  return { employer: source.employerSlug, board, status: suspect ? "suspect" : "ok", detail, stats, saved };
}

/**
 * Reads the due boards, oldest first. `deadline` bounds the run: once it
 * passes no new board starts (the ones in flight finish), and the rest stay
 * due for the next hourly run — the workflow's 20-minute timeout never cuts a
 * board in the middle of its writes.
 */
interface WorkdayPodState {
  chain: Promise<void>;
  lastFinishedAt: number;
  consecutive429: number;
  tripped: boolean;
}

export async function runDirectTick(
  sources: EmployerSourceRow[],
  deps: TickDeps,
  now = new Date(),
  deadline: number = Number.POSITIVE_INFINITY,
  options: DirectTickOptions = {}
): Promise<SourceReport[]> {
  const ordered = interleaveSourcesByHost(sources);
  const pauseMs = options.workdayPodPauseMs ?? WORKDAY_POD_PAUSE_MS;
  const cooldownMs = options.workdayPod429CooldownMs ?? WORKDAY_POD_429_COOLDOWN_MS;
  const maxConsecutive429 = options.workdayPodMaxConsecutive429 ?? WORKDAY_POD_MAX_CONSECUTIVE_429;
  const sleep = options.sleep ?? defaultSleep;
  const podStates = new Map<string, WorkdayPodState>();
  const reports: SourceReport[] = [];
  let next = 0;

  const executeSource = async (source: EmployerSourceRow): Promise<SourceReport | null> => {
    if (Date.now() >= deadline) return null;
    try {
      return await runSource(source, deps, now);
    } catch (error) {
      // A database error on one board must not abort the others.
      const detail = (error instanceof Error ? error.message : String(error)).slice(0, 200);
      return {
        employer: source.employerSlug,
        board: `${source.atsType}:${source.atsRef}`,
        status: "error",
        detail,
        stats: null,
        saved: null
      };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ordered.length) }, async () => {
      while (next < ordered.length && Date.now() < deadline) {
        const source = ordered[next++];
        const pod = workdayPodOf(source);
        if (!pod) {
          const report = await executeSource(source);
          if (report) reports.push(report);
          continue;
        }
        let state = podStates.get(pod);
        if (!state) {
          state = { chain: Promise.resolve(), lastFinishedAt: 0, consecutive429: 0, tripped: false };
          podStates.set(pod, state);
        }
        const currentState = state;
        const resultPromise = currentState.chain.then(async (): Promise<SourceReport | null> => {
          if (currentState.tripped || Date.now() >= deadline) return null;
          if (currentState.lastFinishedAt > 0) {
            const gapMs = currentState.consecutive429 > 0 ? cooldownMs : pauseMs;
            const remainingMs = gapMs - (Date.now() - currentState.lastFinishedAt);
            if (remainingMs > 0) {
              if (Date.now() + remainingMs >= deadline) return null;
              await sleep(remainingMs);
            }
          }
          if (Date.now() >= deadline) return null;
          const report = await executeSource(source);
          currentState.lastFinishedAt = Date.now();
          if (report) {
            const is429 = report.status === "error" && /\bHTTP 429\b/.test(report.detail ?? "");
            if (is429) {
              currentState.consecutive429++;
              if (currentState.consecutive429 >= maxConsecutive429) currentState.tripped = true;
            } else {
              currentState.consecutive429 = 0;
            }
          }
          return report;
        });
        currentState.chain = resultPromise.then(() => undefined, () => undefined);
        const report = await resultPromise;
        if (report) reports.push(report);
      }
    })
  );
  return reports;
}
