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
}

// Per-posting checks per board and tick (one request each).
const MAX_CLOSURE_CONFIRMATIONS = 25;

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

export async function runSource(source: EmployerSourceRow, deps: TickDeps, now = new Date()): Promise<SourceReport> {
  const board = `${source.atsType}:${source.atsRef}`;
  const listing = await listBoard(source, deps.http);
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

export async function runDirectTick(sources: EmployerSourceRow[], deps: TickDeps, now = new Date()): Promise<SourceReport[]> {
  const reports: SourceReport[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, sources.length) }, async () => {
      while (next < sources.length) {
        const source = sources[next++];
        try {
          reports.push(await runSource(source, deps, now));
        } catch (error) {
          // A database error on one board must not abort the others.
          const detail = (error instanceof Error ? error.message : String(error)).slice(0, 200);
          reports.push({ employer: source.employerSlug, board: `${source.atsType}:${source.atsRef}`, status: "error", detail, stats: null, saved: null });
        }
      }
    })
  );
  return reports;
}
