import { z } from "zod";
import { listAltipal } from "./ats/altipal.js";
import { EIGHTFOLD_REF, listEightfold } from "./ats/eightfold.js";
import { listFrisby } from "./ats/frisby.js";
import { listGoogle } from "./ats/google.js";
import { listMagneto, MAGNETO_REF } from "./ats/magneto.js";
import { listPhenom, PHENOM_REF } from "./ats/phenom.js";
import { listSuccessFactors } from "./ats/successfactors.js";
import { listTeamtailor } from "./ats/teamtailor.js";
import { listTp } from "./ats/tp.js";
import { listWorkeando } from "./ats/workeando.js";
import { listWorkday, WORKDAY_REF } from "./ats/workday.js";
import { SITE_REF } from "./ats/site.js";
import { ashby, greenhouse, lever, SmartRecruitersPage, smartRecruitersPosting } from "../lib/ats-posting-parsers.js";
import { safeJson } from "./text.js";
import type { BoardListing, DirectAtsType, EmployerSourceRef, HttpGet, ListOptions, RawAtsPosting } from "./types.js";

/**
 * Public, documented job-board APIs (ADR 0006 §5, phase D1). Each connector
 * returns the WHOLE board as the ATS states it; the Colombia filter runs
 * afterwards (src/direct/ingest.ts). Schemas are tolerant: they validate only
 * the fields we read and ignore the rest, because the providers add fields
 * without notice. A field the ATS doesn't state stays null — never inferred.
 */

// Ref formats: a board token for Greenhouse/Lever/Ashby, the company
// identifier for SmartRecruiters. Each connector declares its own pattern;
// anything else is refused before any URL is built from it.
const TOKEN_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// Board pages read per run (SmartRecruiters is the only paginated API here):
// 20 x 100 = 2,000 postings for one country, far above any board measured.
const MAX_PAGES = 20;

// ---------- registry ----------

/**
 * One entry per ATS with a connector. `list` reads the whole board and never
 * throws (listBoard wraps it); `postingUrl` exists only where the ATS answers
 * a clean 404 once a posting is gone (measured 2026-10-19 with live and
 * nonexistent ids). Ashby has none and its public page is an SPA that
 * answers 200 for any id; SmartRecruiters answers 400 for an unknown id,
 * which is not proof of closure — those close on missing listings only.
 */
interface Connector {
  refPattern: RegExp;
  portalUrl(ref: string): string;
  list(ref: string, http: HttpGet, options: ListOptions): Promise<BoardListing>;
  postingUrl?(ref: string, id: string): string;
}

function singlePage(url: (ref: string) => string, parse: (body: unknown) => RawAtsPosting[] | null) {
  return async (ref: string, http: HttpGet): Promise<BoardListing> => {
    const response = await http(url(ref));
    if (response.status === 404) return { kind: "not_found", detail: "el ATS respondió 404 para este tablero" };
    if (response.status !== 200) return { kind: "error", detail: `HTTP ${response.status}` };
    const postings = parse(safeJson(response.body));
    if (!postings) return { kind: "error", detail: "respuesta con forma inesperada" };
    return { kind: "complete", boardTotal: postings.length, postings };
  };
}

const CONNECTORS: Record<DirectAtsType, Connector> = {
  greenhouse: {
    refPattern: TOKEN_REF,
    portalUrl: (ref) => `https://job-boards.greenhouse.io/${ref}`,
    list: singlePage((ref) => `https://boards-api.greenhouse.io/v1/boards/${ref}/jobs?content=true`, greenhouse),
    postingUrl: (ref, id) => `https://boards-api.greenhouse.io/v1/boards/${ref}/jobs/${id}`
  },
  lever: {
    refPattern: TOKEN_REF,
    portalUrl: (ref) => `https://jobs.lever.co/${ref}`,
    list: singlePage((ref) => `https://api.lever.co/v0/postings/${ref}?mode=json`, lever),
    postingUrl: (ref, id) => `https://api.lever.co/v0/postings/${ref}/${id}`
  },
  ashby: {
    refPattern: TOKEN_REF,
    portalUrl: (ref) => `https://jobs.ashbyhq.com/${ref}`,
    list: singlePage((ref) => `https://api.ashbyhq.com/posting-api/job-board/${ref}`, ashby)
  },
  smartrecruiters: {
    refPattern: TOKEN_REF,
    portalUrl: (ref) => `https://jobs.smartrecruiters.com/${ref}`,
    list: listSmartRecruiters
  },
  // Career site, not an API (docs/source-catalog/successfactors.md). An
  // unknown id redirects to a robots-forbidden error page: listings only.
  successfactors: {
    refPattern: SITE_REF,
    portalUrl: (ref) => `https://${ref}/`,
    list: listSuccessFactors
  },
  // Public RSS (docs/source-catalog/teamtailor.md). The ref is the
  // subdomain, with its region when it has one (connectassistance.na). An
  // unknown id answers 404, but no real closed posting was checked yet:
  // listings only.
  teamtailor: {
    refPattern: /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z]{2})?$/,
    portalUrl: (ref) => `https://${ref}.teamtailor.com/jobs`,
    list: listTeamtailor
  },
  // Undocumented JSON endpoint of the public career site
  // (docs/source-catalog/workday.md). A nonexistent id answers 404, but no
  // real closed posting was checked: listings only.
  workday: {
    refPattern: WORKDAY_REF,
    portalUrl: (ref) => {
      const [, tenant, pod, site] = WORKDAY_REF.exec(ref)!;
      return `https://${tenant}.${pod}.myworkdayjobs.com/${site}`;
    },
    list: listWorkday
  },
  // The site's own search widget (docs/source-catalog/phenom.md). A missing
  // posting answers 410, but only under the right locale prefix: listings only.
  phenom: {
    refPattern: PHENOM_REF,
    portalUrl: (ref) => `https://${ref}/search-results`,
    list: listPhenom
  },
  // The public career page's JSON search, explicitly allowed by robots.txt
  // (docs/source-catalog/eightfold.md). Detail 404s are clean, but no real
  // closed posting was checked yet: listings only.
  eightfold: {
    refPattern: EIGHTFOLD_REF,
    portalUrl: (ref) => `https://${ref.split("@")[0]}/careers`,
    list: listEightfold
  },
  // A company's own Magneto page, only when its own site links to it (owner
  // decision 2026-10-20; docs/source-catalog/magneto-official.md). A missing
  // posting answers 500, not 404: listings only.
  magneto: {
    refPattern: MAGNETO_REF,
    portalUrl: (ref) => `https://www.magneto365.com/co/empresas/${ref}/empleos`,
    list: listMagneto
  },
  // Google Careers' results page (docs/source-catalog/google.md): one board,
  // page 1 only (robots.txt forbids ?page=). A missing posting answers 200
  // with a generic page: listings only.
  google: {
    refPattern: /^google$/,
    portalUrl: () => "https://www.google.com/about/careers/applications/jobs/results?location=Colombia",
    list: listGoogle
  },
  // TP's own Colombia career search has a bounded JSON listing with dates.
  tp: {
    refPattern: /^colombia$/,
    portalUrl: () => "https://www.tp.com/es-co/ubicaciones/colombia/carreras/",
    list: listTp
  },
  // NEXA links to Workeando from its corporate site; only its public WP
  // collection is read. A detail-page 200 is not proof a posting is open.
  workeando: {
    refPattern: /^nexa-bpo$/,
    portalUrl: () => "https://workeando.com/ofertas/",
    list: listWorkeando
  },
  // Static vacancies from Frisby's corporate careers page.
  frisby: {
    refPattern: /^colombia$/,
    portalUrl: () => "https://frisby.info/gente-frisby/",
    list: listFrisby
  },
  // Altipal's CreeSer public vacancies, linked by its corporate site.
  altipal: {
    refPattern: /^creeser$/,
    portalUrl: () => "https://creeser.hr-suite.app/vacantes.php",
    list: listAltipal
  }
};

/** True when `ref` is a well-formed reference for that ATS. */
export function isValidRef(ref: EmployerSourceRef): boolean {
  return CONNECTORS[ref.atsType]?.refPattern.test(ref.atsRef) ?? false;
}

export function portalUrl(ref: EmployerSourceRef): string {
  return CONNECTORS[ref.atsType].portalUrl(ref.atsRef);
}

export function canConfirmClosure(atsType: EmployerSourceRef["atsType"]): boolean {
  return Boolean(CONNECTORS[atsType]?.postingUrl);
}

/**
 * True only when the ATS itself says the posting no longer exists (404/410).
 * Errors, timeouts and anything else are "not proven" — never a closure.
 */
export async function confirmPostingGone(ref: EmployerSourceRef, externalId: string, http: HttpGet): Promise<boolean> {
  const build = CONNECTORS[ref.atsType]?.postingUrl;
  if (!build || !isValidRef(ref) || !/^[A-Za-z0-9-]{1,100}$/.test(externalId)) return false;
  try {
    const response = await http(build(ref.atsRef, externalId));
    return response.status === 404 || response.status === 410;
  } catch {
    return false;
  }
}

function errorDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

/** Reads one employer board end to end. Never throws. */
export async function listBoard(ref: EmployerSourceRef, http: HttpGet, options: ListOptions = {}): Promise<BoardListing> {
  const connector = CONNECTORS[ref.atsType];
  if (!connector) return { kind: "error", detail: `ATS sin conector: ${ref.atsType}` };
  if (!connector.refPattern.test(ref.atsRef)) return { kind: "error", detail: "ats_ref con formato inválido" };
  try {
    return await connector.list(ref.atsRef, http, options);
  } catch (error) {
    return { kind: "error", detail: errorDetail(error) };
  }
}

async function listSmartRecruiters(identifier: string, http: HttpGet): Promise<BoardListing> {
  const postings: RawAtsPosting[] = [];
  const pageSize = 100;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://api.smartrecruiters.com/v1/companies/${identifier}/postings?country=co&limit=${pageSize}&offset=${page * pageSize}`;
    const response = await http(url);
    if (response.status === 404) return { kind: "not_found", detail: "el ATS respondió 404 para esta empresa" };
    if (response.status !== 200) return { kind: "error", detail: `HTTP ${response.status} en la página ${page + 1}` };
    const parsed = SmartRecruitersPage.safeParse(safeJson(response.body));
    if (!parsed.success) return { kind: "error", detail: `forma inesperada en la página ${page + 1}` };
    postings.push(...parsed.data.content.map((posting) => smartRecruitersPosting(identifier, posting)));
    if (parsed.data.content.length < pageSize || postings.length >= parsed.data.totalFound) {
      // totalFound is the Colombia count (country=co), so the board total
      // used for the mass-drop guard is the same subset.
      return { kind: "complete", boardTotal: parsed.data.totalFound, postings };
    }
  }
  return { kind: "error", detail: `más de ${MAX_PAGES} páginas: listado incompleto, no se cierra nada` };
}

