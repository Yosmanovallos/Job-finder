// Country as a first-class config dimension (Venezuela expansion — see
// backlog/venezuela-expansion.md). One app, one DB, country as data — NOT
// separate apps/deployments per country. This module is the single place
// that knows which countries exist and what their per-country display data
// (cities, name) is; scraping-side per-source domain/proxy config lives
// next to each adapter instead (see src/sources/computrabajo-ve.ts etc.),
// since that's inherently source-specific, not country-generic.

export interface CountryConfig {
  code: string;
  name: string;
  // Major cities used for the dashboard's city filter and (via job-seo.ts)
  // category landing pages — same role CITY_OPTIONS plays for Colombia in
  // job-filters.ts today, just keyed by country instead of hardcoded to one.
  cities: string[];
}

export const DEFAULT_COUNTRY = "CO";

export const COUNTRIES: Record<string, CountryConfig> = {
  CO: {
    code: "CO",
    name: "Colombia",
    // Kept in sync with job-filters.ts's CITY_OPTIONS (same 2026-08-05
    // real-corpus expansion — see that file's comment) — this is the
    // country-keyed equivalent, minus the literal "Remoto" entry
    // getCityOptionsForCountry appends separately.
    cities: [
      "Bogotá",
      "Medellín",
      "Cali",
      "Barranquilla",
      "Cartagena",
      "Bucaramanga",
      "Pereira",
      "Manizales",
      "Villavicencio",
      "Ibagué",
      "Cúcuta",
      "Armenia",
      "Neiva",
      "Santa Marta",
      "Pasto",
      "Montería",
      "Popayán",
      "Valledupar",
      "Tunja",
      "Palmira"
    ]
  },
  VE: {
    code: "VE",
    name: "Venezuela",
    cities: ["Caracas", "Maracaibo", "Valencia", "Barquisimeto", "Maracay", "Ciudad Guayana"]
  }
};

export function getCountryConfig(code: string | undefined | null): CountryConfig {
  const key = (code || DEFAULT_COUNTRY).toUpperCase();
  return COUNTRIES[key] || COUNTRIES[DEFAULT_COUNTRY];
}

export function isKnownCountry(code: string | undefined | null): boolean {
  return Boolean(code && COUNTRIES[code.toUpperCase()]);
}

// Single source of truth for "which sources does the marketing site claim
// are connected for this country" — CO gets every source actually scraped
// for Colombia. VE only has LinkedIn/Computrabajo country-scoped so far
// (see src/sources/*-ve.ts) — the rest of CO's list (Elempleo, Magneto,
// Workana) has no Venezuela adapter yet, so claiming them here would
// overpromise. The shared remote-catalog sources (Torre, GetOnBoard,
// RemoteOK, Remotive, WeRemoto) are genuinely connected for both — they
// show on /ve/dashboard too (see ALWAYS_REMOTE_SOURCES/resolveJobCountry
// above). Used by SourcesAndProblem.tsx (the "Conectado a" marquee),
// Faq.tsx (faq-1's answer) and job-seo.ts's buildCategoryMeta — three
// places that would otherwise silently drift out of sync with each other
// if each kept its own copy.
export const SOURCES_BY_COUNTRY: Record<string, string[]> = {
  CO: [
    "LinkedIn Jobs",
    "Computrabajo",
    "Elempleo",
    "Magneto",
    "Torre",
    "GetOnBoard",
    "RemoteOK",
    "Remotive",
    "Workana",
    "WeRemoto"
  ],
  VE: ["LinkedIn Jobs", "Computrabajo", "Torre", "GetOnBoard", "RemoteOK", "Remotive", "WeRemoto"]
};

// Mirrors job-filters.ts's getModalityLabel remote detection
// (loc.includes("remoto") / loc.includes("remote")) and
// scripts/migrate-country.ts's backfill predicate. Deliberately duplicated
// rather than imported from job-filters.ts — that file's matching logic is
// already precision-tuned (see its own comments on past false-positive
// bugs) and pulls in scheduler.js/ai-role-agent.js; this stays a
// zero-dependency leaf so nothing here can accidentally change that file's
// behavior via a shared refactor. All three copies check the same two
// substrings — if one changes, change all three together.
//
// Only reliable for sources whose own scraper guarantees the literal string
// "Remoto"/"Remote" whenever a posting is actually remote (LinkedIn,
// Computrabajo, Torre, GetOnBoard, Jooble all do — their fallback/isRemote
// branches set exactly that). It is NOT reliable for RemoteOK/Remotive/
// WeRemoto below — see ALWAYS_REMOTE_SOURCES.
export function isRemoteLocation(location: string | undefined | null): boolean {
  const loc = (location || "").toLowerCase();
  return loc.includes("remoto") || loc.includes("remote");
}

// Sources whose own scraper does NOT reliably tag "Remoto" on every remote
// posting, so isRemoteLocation() alone would leak them into whichever
// country happened to run the tick that fetched them. RemoteOK's location
// field is `item.location || "Remote"` — a real, unfiltered upstream value
// (often "Worldwide"/"Anywhere"/a specific country, never checked against
// "remote"), same for Remotive's `candidate_required_location`. WeRemoto's
// own brand is "remote" — every listing on it is remote-first by the
// source's own nature, not something its regex-parsed location field
// reliably confirms either. Once a job is saved, `saveJobs`'s
// ON CONFLICT deliberately never updates `country` (see job-repository.ts) —
// a wrong stamp here is permanent, not self-correcting on the next tick.
//
// Deliberately does NOT include GetOnBoard, Torre, or Jooble: those DO mix
// genuinely country-specific results (GetOnBoard's own isColombia check,
// Jooble's location-filtered API query) with remote ones, tagged reliably
// enough for isRemoteLocation to tell them apart — forcing them to always-
// null here would mislabel their real Colombia/Venezuela postings as
// remote-only.
//
// Workana belongs here for the same reason as RemoteOK/Remotive: its
// `location` field is the client's own country text (`item.country` in
// workana-v2-scraper.ts) — "Argentina", "México", "España", "Estados
// Unidos", etc. — almost never the literal string "remoto"/"remote", even
// though the postings are freelance/remote work from every country. Without
// this, every Workana job got hard-stamped with whichever tick fetched it
// (always CO — WorkanaV2 only runs on the CO-tick's global-catalog step,
// never VE's, to avoid double-fetching the same catalog), permanently
// mislabeling e.g. an Argentina-based project as Colombia and hiding it
// from /ve/dashboard entirely (confirmed empirically: 80/80 saved Workana
// rows had country='CO' despite locations like "Argentina"/"México"/
// "España" — see the one-time backfill in scripts/backfill-workana-country.ts).
export const ALWAYS_REMOTE_SOURCES = new Set(["RemoteOK", "Remotive", "WeRemoto", "Workana"]);

// Single source of truth for what country (if any) a freshly-fetched job
// gets stamped with — used by both the per-role path (scrape-worker.ts) and
// the global-catalog path (run-scrape-tick.ts's runGlobalCatalogSources) so
// the two can never drift into different rules for the same source.
export function resolveJobCountry(
  job: { source: string; location: string },
  tickCountry: string
): string | null {
  if (ALWAYS_REMOTE_SOURCES.has(job.source)) return null;
  return isRemoteLocation(job.location) ? null : tickCountry;
}

// Shared fallback used by every job card (JobCard, JobDetailPanel,
// JobListItem, CategoryJobRow — dashboard AND /empresas alike): when a job
// has no location text at all, show the country instead of a blank string.
// Deliberately does NOT append a country qualifier to a bare "Remoto" the
// way an earlier version of this function tried to — resolveJobCountry
// forces job.country to null for any location containing "remoto"/"remote"
// (see above), precisely because those postings (Torre, GetOnBoard...)
// genuinely have no single-country answer; they're the SAME listing shown
// on both /dashboard and /ve/dashboard. Appending a guessed country there
// would be exactly the kind of unsupported inference AGENTS.md §5 forbids
// — "Remoto" with nothing else is the honest answer, not a bug.
export function buildLocationLabel(
  job: { location?: string | null; country?: string | null },
  contextCountry?: string | null
): string {
  const loc = (job.location || "").trim();
  if (loc) return loc;
  return getCountryConfig(job.country || contextCountry).name;
}
