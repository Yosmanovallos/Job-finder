import { z } from "zod";
import { isValidRef, listBoard } from "../connectors.js";
import { selectColombianPostings } from "../ingest.js";
import { safeJson } from "../text.js";
import { DIRECT_ATS_TYPES, type DirectAtsType, type HttpGet } from "../types.js";
import { companyKey, companyWords, foldName, isWeakKey } from "./company-key.js";
import type { DetectableAtsType } from "./ats-links.js";
import type { SiteProbeResult } from "./site-probe.js";

/**
 * Discovery decisions (docs/adr/0006-direct-employers.md §7.1). Pure apart
 * from the injected HTTP: which boards a candidate gets, and on what
 * evidence. A board is `verified` — and only then becomes an
 * employer_sources row — when the identity is proven (the ATS declares the
 * same company_key, or the employer's own site links to the board), the
 * listing is complete and it has at least one live Colombian posting.
 */

export const DISCOVERY_RULE_VERSION = "d3-v1";

export interface DiscoveryCandidate {
  companyKey: string;
  companyName: string;
  directoryCount: number;
  /** Only a domain backed by evidence (see domainOrigin); null = none. */
  websiteDomain: string | null;
  isAgency: boolean;
}

export type EvidenceOutcome =
  | "verified"
  | "needs_review"
  | "name_mismatch"
  | "no_colombia"
  | "not_found"
  | "error"
  | "unsupported"
  | "magneto";

export interface BoardEvidence {
  method: "name" | "site";
  atsType: DetectableAtsType;
  atsRef: string;
  outcome: EvidenceOutcome;
  reason: string;
  /** Page of the employer's site that links to the board (site method). */
  pageUrl?: string;
  declaredName?: string | null;
  boardTotal?: number;
  colombiaLive?: number;
  sampleIds?: string[];
}

export type NameProbeStatus = "skipped" | "hit" | "miss" | "error";
export type SiteProbeStatus = "skipped" | "no_domain" | "found" | "no_link" | "robots_blocked" | "blocked" | "unreachable" | "redirect_offsite";
export type Decision = "verified" | "needs_review" | "unsupported_ats" | "magneto" | "not_found" | "excluded" | "pending";

/** What the site probe read, for review: never HTML, only URLs and hosts. */
export interface SiteNotes {
  pagesRead: string[];
  offsiteCareersHosts: string[];
  detail?: string;
}

export interface ProbeOutcome {
  nameProbe: NameProbeStatus;
  siteProbe: SiteProbeStatus;
  decision: Decision;
  reason: string;
  evidence: BoardEvidence[];
  site: SiteNotes | null;
}

const REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Board tokens tried for a name: "Mercado Libre" -> mercadolibre, mercado-libre. Never more than two. */
export function slugVariants(name: string): string[] {
  const words = companyWords(name);
  return [...new Set([words.join(""), words.join("-")])].filter((value) => REF.test(value));
}

// ---------- board checks ----------

const GreenhouseBoardMeta = z.object({ name: z.string() });

/** Greenhouse's own name for a board token (GET /v1/boards/{token}). */
async function greenhouseBoardName(token: string, http: HttpGet): Promise<{ kind: "found"; name: string } | { kind: "not_found" } | { kind: "error"; detail: string }> {
  try {
    const response = await http(`https://boards-api.greenhouse.io/v1/boards/${token}`);
    if (response.status === 404) return { kind: "not_found" };
    if (response.status !== 200) return { kind: "error", detail: `HTTP ${response.status}` };
    const parsed = GreenhouseBoardMeta.safeParse(safeJson(response.body));
    return parsed.success ? { kind: "found", name: parsed.data.name } : { kind: "error", detail: "forma inesperada" };
  } catch (error) {
    return { kind: "error", detail: (error instanceof Error ? error.message : String(error)).slice(0, 200) };
  }
}

interface BoardCheck {
  listing: "complete" | "not_found" | "error";
  detail?: string;
  boardTotal?: number;
  colombiaLive?: number;
  sampleIds?: string[];
  declaredName?: string | null;
}

/** Lists a supported board and counts its live Colombian postings with the tick's own filter. */
async function checkBoard(atsType: DirectAtsType, atsRef: string, http: HttpGet, now: Date): Promise<BoardCheck> {
  const listing = await listBoard({ atsType, atsRef }, http);
  if (listing.kind !== "complete") return { listing: listing.kind, detail: listing.detail };
  const { postings } = selectColombianPostings(listing.postings, now);
  return {
    listing: "complete",
    boardTotal: listing.boardTotal,
    colombiaLive: postings.length,
    sampleIds: postings.slice(0, 3).map((posting) => posting.externalId),
    declaredName: listing.postings.find((posting) => posting.companyName)?.companyName ?? null
  };
}

function isSupported(atsType: DetectableAtsType): atsType is DirectAtsType {
  return (DIRECT_ATS_TYPES as readonly string[]).includes(atsType);
}

// ---------- method 1: name ----------

export async function probeByName(candidate: DiscoveryCandidate, http: HttpGet, now: Date): Promise<BoardEvidence[]> {
  const evidence: BoardEvidence[] = [];
  const weak = isWeakKey(candidate.companyKey);
  for (const token of slugVariants(candidate.companyName)) {
    // Greenhouse: the board declares its name.
    const meta = await greenhouseBoardName(token, http);
    if (meta.kind === "error") evidence.push({ method: "name", atsType: "greenhouse", atsRef: token, outcome: "error", reason: meta.detail });
    if (meta.kind === "found") {
      if (companyKey(meta.name) !== candidate.companyKey) {
        evidence.push({ method: "name", atsType: "greenhouse", atsRef: token, outcome: "name_mismatch", reason: "el ATS declara otra empresa", declaredName: meta.name });
      } else {
        const check = await checkBoard("greenhouse", token, http, now);
        evidence.push(nameEvidence("greenhouse", token, { ...check, declaredName: meta.name }, weak, true));
      }
    }
    // SmartRecruiters: each posting names the company; an unknown id lists nothing.
    const smart = await checkBoard("smartrecruiters", token, http, now);
    if (smart.listing === "error") evidence.push({ method: "name", atsType: "smartrecruiters", atsRef: token, outcome: "error", reason: smart.detail ?? "error" });
    if (smart.listing === "complete" && smart.declaredName) {
      evidence.push(
        companyKey(smart.declaredName) === candidate.companyKey
          ? nameEvidence("smartrecruiters", token, smart, weak, true)
          : { method: "name", atsType: "smartrecruiters", atsRef: token, outcome: "name_mismatch", reason: "el ATS declara otra empresa", declaredName: smart.declaredName }
      );
    }
    // Lever and Ashby state no company name: a hit is only a lead.
    for (const atsType of ["lever", "ashby"] as const) {
      const check = await checkBoard(atsType, token, http, now);
      if (check.listing === "error") evidence.push({ method: "name", atsType, atsRef: token, outcome: "error", reason: check.detail ?? "error" });
      if (check.listing === "complete" && (check.boardTotal ?? 0) > 0) evidence.push(nameEvidence(atsType, token, check, weak, false));
    }
  }
  return evidence;
}

function nameEvidence(atsType: DirectAtsType, atsRef: string, check: BoardCheck, weakKey: boolean, nameDeclared: boolean): BoardEvidence {
  const base = { method: "name" as const, atsType, atsRef, declaredName: check.declaredName ?? null, boardTotal: check.boardTotal, colombiaLive: check.colombiaLive, sampleIds: check.sampleIds };
  if (check.listing === "not_found") return { ...base, outcome: "not_found", reason: "tablero inexistente" };
  if (check.listing === "error") return { ...base, outcome: "error", reason: check.detail ?? "error" };
  if ((check.colombiaLive ?? 0) === 0) return { ...base, outcome: "no_colombia", reason: "sin vacantes vigentes en Colombia" };
  if (!nameDeclared) return { ...base, outcome: "needs_review", reason: `${atsType} no declara el nombre de la empresa` };
  if (weakKey) return { ...base, outcome: "needs_review", reason: "nombre corto o genérico: no prueba identidad" };
  return { ...base, outcome: "verified", reason: "el ATS declara el mismo company_key y hay vacantes en Colombia" };
}

// ---------- method 2: the employer's own site ----------

export async function boardsFromSite(candidate: DiscoveryCandidate, site: Extract<SiteProbeResult, { status: "done" }>, http: HttpGet, now: Date): Promise<BoardEvidence[]> {
  const evidence: BoardEvidence[] = [];
  for (const link of site.links) {
    const base = { method: "site" as const, atsType: link.atsType, atsRef: link.atsRef, pageUrl: link.pageUrl };
    if (link.atsType === "magneto") {
      evidence.push({ ...base, outcome: "magneto", reason: "página de Magneto (bolsa): pregunta abierta del dueño" });
      continue;
    }
    if (!isSupported(link.atsType)) {
      evidence.push({ ...base, outcome: "unsupported", reason: `${link.atsType} aún sin conector (D5)` });
      continue;
    }
    // A supported ATS reached through a portal our connector doesn't read
    // (SuccessFactors' classic career{N}.successfactors.com?company=X, which
    // robots.txt forbids, vs. the RMK site the connector uses): evidence
    // only, never a transient error retried forever.
    if (!isValidRef({ atsType: link.atsType, atsRef: link.atsRef })) {
      evidence.push({ ...base, outcome: "unsupported", reason: `${link.atsType}: este tipo de enlace no lo lee el conector` });
      continue;
    }
    const check = await checkBoard(link.atsType, link.atsRef, http, now);
    let declaredName = check.declaredName ?? null;
    if (link.atsType === "greenhouse" && check.listing === "complete") {
      const meta = await greenhouseBoardName(link.atsRef, http);
      if (meta.kind === "found") declaredName = meta.name;
    }
    const stats = { declaredName, boardTotal: check.boardTotal, colombiaLive: check.colombiaLive, sampleIds: check.sampleIds };
    if (check.listing === "not_found") evidence.push({ ...base, ...stats, outcome: "not_found", reason: "el sitio enlaza a un tablero inexistente" });
    else if (check.listing === "error") evidence.push({ ...base, ...stats, outcome: "error", reason: check.detail ?? "error" });
    else if ((check.colombiaLive ?? 0) === 0) evidence.push({ ...base, ...stats, outcome: "no_colombia", reason: "sin vacantes vigentes en Colombia" });
    else if (declaredName && companyKey(declaredName) !== candidate.companyKey) {
      // The site links a board the ATS says belongs to someone else (a client, a parent company).
      evidence.push({ ...base, ...stats, outcome: "needs_review", reason: "el sitio enlaza a un tablero con otro nombre declarado" });
    } else evidence.push({ ...base, ...stats, outcome: "verified", reason: "el sitio propio enlaza al tablero y hay vacantes en Colombia" });
  }
  return evidence;
}

// ---------- decision ----------

export interface ProbeDeps {
  http: HttpGet;
  probeSite(domain: string): Promise<SiteProbeResult>;
}

export async function probeCandidate(candidate: DiscoveryCandidate, deps: ProbeDeps, now = new Date()): Promise<ProbeOutcome> {
  if (candidate.isAgency) {
    // Agencies link and post their clients' boards: never matched by name or site.
    return { nameProbe: "skipped", siteProbe: "skipped", decision: "excluded", reason: "agencia de empleo (lista curada)", evidence: [], site: null };
  }
  // An initial or a person's name ("J.", "A. M.") names no board: not probed by name.
  const evidence = candidate.companyKey.length < 3 ? [] : await probeByName(candidate, deps.http, now);
  const nameProbe: NameProbeStatus = candidate.companyKey.length < 3 ? "skipped" : evidence.some((entry) => entry.outcome === "verified" || entry.outcome === "needs_review")
    ? "hit"
    : evidence.some((entry) => entry.outcome === "error")
      ? "error"
      : "miss";

  let siteProbe: SiteProbeStatus = "no_domain";
  let notes: SiteNotes | null = null;
  if (candidate.websiteDomain) {
    const site = await deps.probeSite(candidate.websiteDomain);
    if (site.status === "done") {
      const fromSite = await boardsFromSite(candidate, site, deps.http, now);
      evidence.push(...fromSite);
      siteProbe = site.links.length > 0 ? "found" : "no_link";
      notes = { pagesRead: site.pagesRead, offsiteCareersHosts: site.offsiteCareersHosts };
    } else {
      siteProbe = site.status;
      notes = { pagesRead: [], offsiteCareersHosts: [], detail: site.detail };
    }
  }
  // The curated agency list only covers the directory's top; past it, a name
  // that declares itself an agency never auto-verifies (BPOs are employers
  // and stay out of this pattern).
  if (looksLikeAgency(candidate.companyName)) {
    for (const entry of evidence) {
      if (entry.outcome === "verified") Object.assign(entry, { outcome: "needs_review", reason: "el nombre parece de agencia de empleo: revisión humana" });
    }
  }
  return { nameProbe, siteProbe, evidence, site: notes, ...decide(nameProbe, siteProbe, evidence) };
}

const AGENCY_WORDS = /\b(temporal(es)?|empleos?|staffing|recruit(ing|ment|ers?)?|reclutamiento|headhunt(ers?|ing)?|seleccion de personal|bolsa de trabajo)\b/;

/** Name declares an employment agency ("Servicios Temporales", "XYZ Staffing"). */
export function looksLikeAgency(name: string): boolean {
  return AGENCY_WORDS.test(foldName(name));
}

function decide(nameProbe: NameProbeStatus, siteProbe: SiteProbeStatus, evidence: BoardEvidence[]): { decision: Decision; reason: string } {
  const has = (outcome: EvidenceOutcome) => evidence.some((entry) => entry.outcome === outcome);
  if (has("verified")) return { decision: "verified", reason: "tablero verificado" };
  if (has("needs_review")) return { decision: "needs_review", reason: evidence.find((entry) => entry.outcome === "needs_review")!.reason };
  if (has("unsupported")) return { decision: "unsupported_ats", reason: "el sitio enlaza a un ATS aún sin conector" };
  if (has("magneto")) return { decision: "magneto", reason: "el sitio enlaza a Magneto" };
  // A transient failure is retried later, never recorded as "nothing there".
  if (nameProbe === "error" || siteProbe === "unreachable") return { decision: "pending", reason: "error transitorio: se reintenta" };
  return { decision: "not_found", reason: siteProbe === "no_domain" ? "no encontrado por nombre (sin dominio para leer el sitio)" : "no encontrado por nombre ni en el sitio" };
}

/** Boards to promote: verified, one per (ats_type, ats_ref), supported types only. */
export function verifiedBoards(evidence: BoardEvidence[]): { atsType: DirectAtsType; atsRef: string; method: "name" | "site" }[] {
  const boards = new Map<string, { atsType: DirectAtsType; atsRef: string; method: "name" | "site" }>();
  for (const entry of evidence) {
    if (entry.outcome !== "verified" || !isSupported(entry.atsType)) continue;
    const key = `${entry.atsType}:${entry.atsRef.toLowerCase()}`;
    if (!boards.has(key)) boards.set(key, { atsType: entry.atsType, atsRef: entry.atsRef, method: entry.method });
  }
  return [...boards.values()];
}
