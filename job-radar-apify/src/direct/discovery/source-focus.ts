import type { SourceCoverageRow } from "../../db/direct-discovery-repository.js";

/**
 * Discovery focus by job board (docs/adr/0006-direct-employers.md §7.1,
 * docs/direct/bolsas-a-empleadores-2026-11.md). The same discovery queue,
 * budgets and rules; only the order changes: companies seen on the chosen
 * boards go first. Nothing here touches those boards' scrapers.
 */

/** Job boards whose company names may steer discovery (the `jobs.source` values). */
export const FOCUS_SOURCES = [
  "Computrabajo", "Indeed", "Glassdoor", "LinkedIn", "Elempleo", "Magneto", "Torre", "Jooble"
] as const;
export type FocusSource = (typeof FOCUS_SOURCES)[number];

/** Named focuses the workflows pass; `browser-boards` are the boards read by browser + proxy. */
export const FOCUS_PRESETS: Record<string, readonly FocusSource[]> = {
  computrabajo: ["Computrabajo"],
  "browser-boards": ["Indeed", "Glassdoor"]
};

/** "Indeed,Glassdoor" -> validated, de-duplicated list; unknown names throw. */
export function parseFocusSources(raw: string): FocusSource[] {
  const picked = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  if (picked.length === 0) throw new Error("--focus-sources vacío");
  const unknown = picked.filter((value) => !(FOCUS_SOURCES as readonly string[]).includes(value));
  if (unknown.length) throw new Error(`fuente de foco desconocida: ${unknown.join(", ")} (válidas: ${FOCUS_SOURCES.join(", ")})`);
  return picked as FocusSource[];
}

/**
 * Focus from the command line: `--focus-computrabajo` (kept) or
 * `--focus-sources A,B`, mutually exclusive, and never with a candidates
 * file (the focus needs the live census). Null means "all job boards".
 */
export function focusFromArgs(argv: string[]): FocusSource[] | null {
  const legacy = argv.includes("--focus-computrabajo");
  const index = argv.indexOf("--focus-sources");
  const explicit = index >= 0;
  if (legacy && explicit) throw new Error("--focus-computrabajo y --focus-sources son excluyentes");
  if (!legacy && !explicit) return null;
  if (argv.includes("--candidates-file")) throw new Error("el foco por bolsa requiere el directorio vivo, no --candidates-file");
  if (legacy) return [...FOCUS_PRESETS.computrabajo];
  const raw = argv[index + 1];
  if (!raw || raw.startsWith("--")) throw new Error("--focus-sources requiere una lista, p. ej. Indeed,Glassdoor");
  return parseFocusSources(raw);
}

export interface SourceCensus {
  sources: string[];
  /** Distinct companies (company_key) per country slice. */
  companies: { CO: number; VE: number; none: number };
  /** Colombia slice from here on: the only one discovery can verify (§7.1/§13). */
  vacancies: number;
  agencies: number;
  withBoard: number;
  withLiveOfficialJobs: number;
  /** Not an agency and no enabled board: what discovery is for. */
  targets: number;
  /** Target companies (no agency, no enabled board) also seen on Computrabajo: already in the scheduled focus. */
  alsoOnComputrabajo: number;
  /** Target companies by discovery decision ("sin_fila" = not yet synced). */
  byDecision: Record<string, number>;
  /** Open decision whose retry time came: what a focused run would probe now. */
  dueNow: number;
  /** Open decision still in backoff. */
  inBackoff: number;
  /** Due now and not on Computrabajo: what this focus adds over today's schedule. */
  newDueNotOnComputrabajo: number;
}

const OPEN_DECISIONS = new Set(["pending", "not_found", "unsupported_ats", "magneto"]);

/**
 * Would the discovery queue pick this company now? Open decision (or no row
 * yet: the next sync adds it as `pending`) and retry time reached. A focused
 * dry-run uses it so it probes what an execute run would, never a company in
 * backoff or with a sticky decision.
 */
export function isDueInQueue(row: Pick<SourceCoverageRow, "decision" | "probeDue">): boolean {
  return (row.decision === null || OPEN_DECISIONS.has(row.decision)) && row.probeDue !== false;
}

export function summarizeSourceCensus(input: {
  sources: string[];
  co: SourceCoverageRow[];
  veCompanies: number;
  noCountryCompanies: number;
  agencies: ReadonlySet<string>;
  computrabajoKeys: ReadonlySet<string>;
}): SourceCensus {
  const targets = input.co.filter((row) => !input.agencies.has(row.companyKey) && row.enabledBoards === 0);
  const byDecision: Record<string, number> = {};
  for (const row of targets) {
    const key = row.decision ?? "sin_fila";
    byDecision[key] = (byDecision[key] ?? 0) + 1;
  }
  const open = targets.filter((row) => row.decision === null || OPEN_DECISIONS.has(row.decision));
  const due = open.filter(isDueInQueue);
  return {
    sources: input.sources,
    companies: { CO: input.co.length, VE: input.veCompanies, none: input.noCountryCompanies },
    vacancies: input.co.reduce((total, row) => total + row.directoryCount, 0),
    agencies: input.co.filter((row) => input.agencies.has(row.companyKey)).length,
    withBoard: input.co.filter((row) => row.enabledBoards > 0).length,
    withLiveOfficialJobs: input.co.filter((row) => row.liveOfficialJobs > 0).length,
    targets: targets.length,
    alsoOnComputrabajo: targets.filter((row) => input.computrabajoKeys.has(row.companyKey)).length,
    byDecision,
    dueNow: due.length,
    inBackoff: open.length - due.length,
    newDueNotOnComputrabajo: due.filter((row) => !input.computrabajoKeys.has(row.companyKey)).length
  };
}
