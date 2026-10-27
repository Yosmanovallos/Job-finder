import { listBoard } from "../connectors.js";
import { selectColombianPostings } from "../ingest.js";
import type { DirectAtsType, HttpGet } from "../types.js";
import { companyKey, foldName, isPlaceholderKey, isWeakKey } from "./company-key.js";
import { greenhouseBoardName, looksLikeAgency } from "./probe.js";

/**
 * ATS inventory probe and automatic enablement, phase I2
 * (openspec/changes/ats-inventory-co-2026-11, INV-010…INV-014; ADR 0006 §13).
 * Each pending inventory board is listed with its own connector and the
 * tick's Colombia filter. A board is enabled without human review only when
 * the ATS itself declares one employer name, the listing is complete, at
 * least one live posting is explicitly in Colombia, the name is no agency,
 * its key is not short or generic, and no other employer or board of the
 * same ATS claims it. Everything else gets a classified state with its
 * evidence; a block or a failed read is never `no_colombia`.
 * Pure apart from the injected HTTP and persistence.
 */

export const INVENTORY_PROBE_RULE = "i2-v1";
export const INVENTORY_DISCOVERY_ORIGIN = "ats_inventory";

/** Inventory states a probe may (re)visit; every other state is final. */
export const DUE_STATUSES = ["pending", "error", "blocked", "no_colombia"] as const;

export type ProbeStatus = "enabled" | "no_colombia" | "agency" | "ambiguous" | "blocked" | "error" | "owned";

// Workday names the employer and the country only in a posting's detail:
// a few detail reads per board are enough to find one Colombian posting.
export const WORKDAY_DETAIL_BUDGET = 5;

export interface InventoryBoard {
  id: string;
  atsType: DirectAtsType;
  atsRef: string;
  probeAttempts: number;
}

export type BoardRead =
  | { kind: "failed"; status: "blocked" | "error"; reason: string; notFound: boolean }
  | {
      kind: "listed";
      totalCount: number;
      /** Live postings explicitly in Colombia (the tick's own filter). */
      colombiaCount: number;
      /** Postings whose detail was not read (Workday budget): their country is unknown. */
      deferred: number;
      declaredNames: string[];
    };

/** 401/403/429 and robots.txt refusals are blocks; anything else is an error. */
export function failureStatus(detail: string): "blocked" | "error" {
  return /^HTTP (401|403|429)\b/.test(detail) || /robots\.txt/.test(detail) ? "blocked" : "error";
}

function clip(value: string): string {
  return value.slice(0, 200);
}

/** Lists one board and counts its live Colombian postings. Never throws. */
export async function readBoard(board: InventoryBoard, http: HttpGet, now: Date): Promise<BoardRead> {
  const ref = { atsType: board.atsType, atsRef: board.atsRef };
  const listing = await listBoard(ref, http, board.atsType === "workday" ? { detailBudget: WORKDAY_DETAIL_BUDGET } : {});
  if (listing.kind === "not_found") return { kind: "failed", status: "error", reason: `tablero inexistente: ${clip(listing.detail)}`, notFound: true };
  if (listing.kind === "error") return { kind: "failed", status: failureStatus(listing.detail), reason: clip(listing.detail), notFound: false };
  const colombiaCount = selectColombianPostings(listing.postings, now).postings.length;
  let declaredNames = [...new Set(listing.postings.map((posting) => posting.companyName?.trim()).filter((name): name is string => Boolean(name)))];
  if (board.atsType === "greenhouse") {
    // A Greenhouse posting rarely names the company; the board itself does.
    declaredNames = [];
    if (colombiaCount > 0) {
      const meta = await greenhouseBoardName(board.atsRef, http);
      if (meta.kind !== "found") {
        const detail = meta.kind === "error" ? meta.detail : "404";
        return { kind: "failed", status: failureStatus(detail), reason: clip(`nombre del tablero: ${detail}`), notFound: false };
      }
      declaredNames = [meta.name.trim()];
    }
  }
  return { kind: "listed", totalCount: listing.boardTotal, colombiaCount, deferred: listing.deferred ?? 0, declaredNames };
}

interface Counts {
  declaredName: string | null;
  colombiaCount: number | null;
  totalCount: number | null;
}

export type Verdict =
  | ({ status: "eligible"; companyKey: string; declaredName: string; reason: string } & Omit<Counts, "declaredName">)
  | ({ status: "no_colombia" | "agency" | "ambiguous" | "blocked" | "error"; reason: string; notFound?: boolean } & Counts);

const BOARD_LABEL = /\b(external|internal|website|careers?|jobs?|job board|hiring|openings|positions|clients?|vacantes|trabaja con nosotros)\b/;
// Workday's hiringOrganization prefixes the legal entity with an internal
// code ("1838 AIRBUS COLOMBIA SAS", "CO02 Gases Indust. Colombia SA"). Cutting
// it off would be a guess ("3M Colombia" starts the same way): not enabled.
const ENTITY_CODE = /^(?=[A-Za-z]*\d)[A-Za-z0-9]{2,}[\s-]/;
// A staging or test board ("thltestcareers"): its postings are no evidence.
const TEST_REF = /(?:^|[^a-z])test|test(?:$|[^a-z]|careers|board|jobs)/i;

/** The decision the board's own listing supports, before any database conflict. */
export function judgeBoard(atsType: DirectAtsType, read: BoardRead, agencyKeys: ReadonlySet<string>, atsRef = ""): Verdict {
  if (read.kind === "failed") return { status: read.status, reason: read.reason, notFound: read.notFound, declaredName: null, colombiaCount: null, totalCount: null };
  const counts = { declaredName: read.declaredNames[0] ?? null, colombiaCount: read.colombiaCount, totalCount: read.totalCount };
  if (read.colombiaCount === 0) {
    return read.deferred > 0
      ? { status: "error", reason: `${read.deferred} vacantes sin detalle leído: no prueba que no haya vacantes en Colombia`, ...counts }
      : { status: "no_colombia", reason: "listado completo sin vacantes vigentes en Colombia", ...counts };
  }
  // A company page on Magneto, a job board too, is official only when the company's own site links it (site probe).
  if (atsType === "magneto") return { status: "ambiguous", reason: "Magneto también es bolsa de empleo: solo vale enlazado desde el sitio propio", ...counts };
  if (read.declaredNames.length === 0) return { status: "ambiguous", reason: `${atsType} no declara el nombre de la empresa`, ...counts };
  const agency = read.declaredNames.find((name) => agencyKeys.has(companyKey(name)) || looksLikeAgency(name));
  if (agency) return { status: "agency", reason: "agencia de empleo: publica vacantes de sus clientes", ...counts, declaredName: agency };
  // Greenhouse board names carry labels ("Backblaze External Website", "Extenteam Client Roles",
  // measured in the 2026-10-27 dry run): such a name is not the employer's.
  const label = read.declaredNames.find((name) => BOARD_LABEL.test(foldName(name)));
  if (label) return { status: "ambiguous", reason: clip(`el nombre declarado parece una etiqueta del tablero: ${label}`), ...counts };
  const coded = read.declaredNames.find((name) => ENTITY_CODE.test(name.trim()));
  if (coded) return { status: "ambiguous", reason: clip(`el nombre declarado empieza con un código interno: ${coded}`), ...counts };
  if (TEST_REF.test(atsRef)) return { status: "ambiguous", reason: "el tablero parece de prueba", ...counts };
  const keys = new Set(read.declaredNames.map(companyKey));
  if (keys.size > 1) return { status: "ambiguous", reason: clip(`el tablero declara varias empresas: ${read.declaredNames.slice(0, 3).join(" | ")}`), ...counts };
  const key = [...keys][0];
  if (isPlaceholderKey(key)) return { status: "ambiguous", reason: "nombre de relleno: no identifica una empresa", ...counts };
  if (isWeakKey(key)) return { status: "ambiguous", reason: "nombre corto o genérico: no prueba identidad", ...counts };
  return {
    status: "eligible",
    companyKey: key,
    declaredName: counts.declaredName!,
    colombiaCount: read.colombiaCount,
    totalCount: read.totalCount,
    reason: `el ATS declara "${counts.declaredName}" y hay ${read.colombiaCount} vacantes vigentes en Colombia`
  };
}

/** What the database already says about the board and the declared company. */
export interface EnablementContext {
  /** The board is already an employer_sources row (any employer). */
  boardOwned: boolean;
  /** Employers the key names (alias or own key). */
  employerIds: string[];
  /** Boards of the same ATS those employers already have (enabled or not). */
  sameAtsBoards: string[];
  /** A human rejected this company in discovery review (sticky). */
  rejected: boolean;
  /** company_key of the employer that holds the slug the name derives to, if any. */
  slugOwnerKey: string | null;
}

/** Null when nothing stands in the way of enabling (INV-012). */
export function conflictOf(context: EnablementContext, key: string, claimedInRun: boolean): { status: "owned" | "ambiguous"; reason: string } | null {
  if (context.boardOwned) return { status: "owned", reason: "el tablero ya pertenece a una empresa (employer_sources)" };
  if (context.rejected) return { status: "ambiguous", reason: "una revisión humana rechazó esta empresa" };
  if (context.employerIds.length > 1) return { status: "ambiguous", reason: "la clave corresponde a varias empresas" };
  if (context.sameAtsBoards.length > 0) return { status: "ambiguous", reason: clip(`la empresa ya tiene otro tablero de este ATS (${context.sameAtsBoards.slice(0, 3).join(", ")})`) };
  if (context.employerIds.length === 0 && context.slugOwnerKey !== null && context.slugOwnerKey !== key) {
    return { status: "ambiguous", reason: clip(`el slug ya pertenece a otra empresa (${context.slugOwnerKey})`) };
  }
  if (claimedInRun) return { status: "ambiguous", reason: "otro tablero de este ATS declara la misma empresa en esta corrida" };
  return null;
}

/** Days until a board is probed again; null = final (enabled, owned, or a decision for a human). */
export function nextProbeDays(status: ProbeStatus, attempts: number, notFound: boolean): number | null {
  if (status === "error" || status === "blocked") return notFound ? 30 : Math.min(2 ** attempts, 14);
  if (status === "no_colombia") return 30; // boards open Colombian postings over time
  return null;
}

export interface RecordedProbe extends Counts {
  status: Exclude<ProbeStatus, "enabled">;
  reason: string;
  nextProbeDays: number | null;
}

export type Eligible = Extract<Verdict, { status: "eligible" }>;
export type PromotionOutcome = { kind: "enabled" } | { kind: "conflict"; status: "owned" | "ambiguous"; reason: string };

export interface ProbeRunDeps {
  http: HttpGet;
  now(): Date;
  agencyKeys: ReadonlySet<string>;
  /** False = dry run: reads and simulates, never calls record or promote. */
  execute: boolean;
  maxEnable: number;
  /** No new board starts after this instant (ms). */
  deadlineAt: number;
  concurrency: number;
  isOwned(board: InventoryBoard): boolean;
  context(board: InventoryBoard, verdict: Eligible): Promise<EnablementContext>;
  promote(board: InventoryBoard, verdict: Eligible): Promise<PromotionOutcome>;
  record(board: InventoryBoard, outcome: RecordedProbe): Promise<void>;
  log(line: string): void;
}

export interface ProbeRunSummary {
  probed: number;
  enabled: number;
  /** Eligible boards left pending because --max-enable was reached. */
  deferred: number;
  byStatus: Record<string, number>;
  stoppedBy: "deadline" | null;
  remaining: number;
}

function line(board: InventoryBoard, status: string, counts: Counts, reason: string): string {
  const stats = counts.colombiaCount === null ? "" : `${counts.colombiaCount}/${counts.totalCount} CO`;
  return `  ${`${board.atsType}:${board.atsRef}`.slice(0, 48).padEnd(49)}${status.padEnd(12)}${stats.padEnd(12)}${(counts.declaredName ?? "—").slice(0, 32).padEnd(33)}${reason}`;
}

/**
 * Probes boards with bounded concurrency until the list or the deadline ends.
 * Reads run in parallel; the conflict check and the promotion run one at a
 * time, so two boards declaring the same company can't both be enabled.
 */
export async function runInventoryProbe(boards: InventoryBoard[], deps: ProbeRunDeps): Promise<ProbeRunSummary> {
  const summary: ProbeRunSummary = { probed: 0, enabled: 0, deferred: 0, byStatus: {}, stoppedBy: null, remaining: 0 };
  const claimed = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = (task: () => Promise<void>): Promise<void> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };
  const tally = (status: string) => {
    summary.byStatus[status] = (summary.byStatus[status] ?? 0) + 1;
  };
  const finish = async (board: InventoryBoard, outcome: RecordedProbe) => {
    if (deps.execute) await deps.record(board, outcome);
    tally(outcome.status);
    deps.log(line(board, outcome.status, outcome, outcome.reason));
  };

  const probeOne = async (board: InventoryBoard) => {
    if (deps.isOwned(board)) {
      await finish(board, { status: "owned", reason: "el tablero ya pertenece a una empresa (employer_sources)", declaredName: null, colombiaCount: null, totalCount: null, nextProbeDays: null });
      return;
    }
    const verdict = judgeBoard(board.atsType, await readBoard(board, deps.http, deps.now()), deps.agencyKeys, board.atsRef);
    if (verdict.status !== "eligible") {
      const { notFound = false, ...rest } = verdict;
      await finish(board, { ...rest, nextProbeDays: nextProbeDays(verdict.status, board.probeAttempts, notFound) });
      return;
    }
    await exclusive(async () => {
      const claim = `${verdict.companyKey}:${board.atsType}`;
      const conflict = conflictOf(await deps.context(board, verdict), verdict.companyKey, claimed.has(claim));
      const conflicted = async (found: { status: "owned" | "ambiguous"; reason: string }) =>
        finish(board, { ...verdict, status: found.status, reason: found.reason, nextProbeDays: null });
      if (conflict) return conflicted(conflict);
      if (summary.enabled >= deps.maxEnable) {
        // Over the cap: left pending as it was, the next run picks it again.
        summary.deferred++;
        deps.log(line(board, "deferred", verdict, "tope --max-enable alcanzado: queda pendiente"));
        return;
      }
      if (deps.execute) {
        const promotion = await deps.promote(board, verdict);
        if (promotion.kind === "conflict") return conflicted(promotion);
      }
      claimed.add(claim);
      summary.enabled++;
      tally("enabled");
      deps.log(line(board, deps.execute ? "enabled" : "enabled*", verdict, verdict.reason));
    });
  };

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(deps.concurrency, boards.length)) }, async () => {
      while (next < boards.length) {
        if (deps.now().getTime() >= deps.deadlineAt) {
          summary.stoppedBy = "deadline";
          return;
        }
        const board = boards[next++];
        summary.probed++;
        try {
          await probeOne(board);
        } catch (error) {
          const reason = clip(`fallo inesperado: ${(error as Error)?.message ?? String(error)}`);
          await finish(board, { status: "error", reason, declaredName: null, colombiaCount: null, totalCount: null, nextProbeDays: nextProbeDays("error", board.probeAttempts, false) }).catch(
            (recordError) => deps.log(line(board, "error", { declaredName: null, colombiaCount: null, totalCount: null }, clip(`no se pudo registrar: ${(recordError as Error)?.message}`)))
          );
        }
      }
    })
  );
  summary.remaining = boards.length - next;
  return summary;
}
