import { Job } from "../sources/types.js";
import { DEFAULT_ROLES_200 } from "../queue/scheduler.js";
import { TRANSLATION_MAP } from "../ai-role-agent.js";
import { getCountryConfig } from "../countries/index.js";

// Shared between the server (GET /api/jobs, so a 10k+ job corpus is filtered
// before it's ever serialized to the browser) and, previously, the client —
// keeping one copy avoids the filter logic silently drifting between them.

const ROLE_STOPWORDS = new Set(["de", "la", "el", "los", "las", "en", "y", "del", "para"]);

// role_origin only records which of the searched roles happened to discover
// a job's URL first (the dedup upsert never updates it on later
// re-discovery), and some sources match keyword variants loosely enough that
// a totally unrelated posting can end up permanently stamped with the wrong
// role_origin. Filtering on that field alone let jobs like "Jefe de
// enfermería" show up under a "QA Engineer" filter.
//
// A first attempt at fixing this (matching if the title contains ANY
// significant word from the role name) was still badly broken: "QA Engineer"
// and "Data Engineer" and "AI Engineer" all share the word "engineer", so
// matching on it alone made every one of those roles match every "Engineer"
// job site-wide — verified against the real corpus, "QA Engineer" matched 89
// titles that way, only 8 of which were actually QA-related.
//
// A word alone isn't enough vocabulary either — a title can legitimately be
// "Ingeniero de Calidad" for what we search as "QA Engineer", with zero words
// literally in common. Each role's own words are expanded through the same
// synonym dictionary the scraper uses to generate search keywords
// (ai-role-agent.ts), so a title only has to match the role in EITHER
// language/phrasing, not the exact words used in the role's display name.
export function expandRoleWords(role: string): string[] {
  const words = role
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !ROLE_STOPWORDS.has(w));
  const expanded = new Set(words);
  for (const w of words) {
    const synonyms = TRANSLATION_MAP[w];
    if (synonyms) for (const s of synonyms) expanded.add(s);
  }
  return Array.from(expanded);
}

// Word frequency across all configured roles' EXPANDED vocabularies is
// computed once so a word shared by 2+ roles (engineer, data, analyst,
// manager, auxiliar, designer, desarrollador, ingeniero, ...) is never
// trusted alone — only a role's genuinely distinctive word(s) can trigger a
// match by themselves. If every word in a role happens to be shared with
// another role (e.g. "Data Engineer" — both "data" and "engineer" are
// generic), it falls back to requiring all of them together instead of any
// one, which is stricter but still far more precise than matching on a
// single generic word.
const ROLE_WORD_FREQUENCY: Record<string, number> = {};
for (const role of DEFAULT_ROLES_200) {
  for (const w of new Set(expandRoleWords(role))) {
    ROLE_WORD_FREQUENCY[w] = (ROLE_WORD_FREQUENCY[w] || 0) + 1;
  }
}

export function jobMatchesRole(role: string, job: any): boolean {
  const title = (job.title || "").toLowerCase();
  const words = expandRoleWords(role);
  const distinctive = words.filter((w) => (ROLE_WORD_FREQUENCY[w] || 0) < 2);
  if (distinctive.length > 0) return distinctive.some((w) => title.includes(w));
  return words.every((w) => title.includes(w));
}

// Same detection the modality filter uses, exposed separately so the job
// card can show a "Remoto/Híbrido/Presencial" tag consistent with what
// filtering that same job would match — derived from the real `location`
// text, never a separate/inventable field.
export function getModalityLabel(location: string | undefined | null): string | null {
  const loc = (location || "").toLowerCase();
  if (!loc) return null;
  if (loc.includes("remoto") || loc.includes("remote")) return "Remoto";
  if (loc.includes("híbrido") || loc.includes("hibrido")) return "Híbrido";
  return "Presencial";
}

// Raw `location` values are messy free text (hundreds of variants like
// "Bogotá, D.C., Capital District, Colombia" vs plain "Bogotá"), so this is a
// substring bucket per major city rather than an exact-match dropdown over
// the raw field. Lives here (not FilterBar.tsx) so server.ts can import it
// without pulling in React/Radix — this file is already the shared
// server+client home for filtering/taxonomy logic.
export const CITY_OPTIONS = [
  "Bogotá",
  "Medellín",
  "Cali",
  "Barranquilla",
  "Cartagena",
  "Bucaramanga",
  "Pereira",
  "Manizales",
  "Remoto"
];

// Country-aware equivalent of CITY_OPTIONS above, for the multi-country
// dashboard/FilterBar (see backlog/venezuela-expansion.md). CITY_OPTIONS
// itself is left untouched — job-seo.ts's category pages/sitemap still
// resolve against it directly and must keep working exactly as they do
// today for Colombia.
export function getCityOptionsForCountry(country: string | undefined | null): string[] {
  return [...getCountryConfig(country).cities, "Remoto"];
}

export interface JobFilterParams {
  search?: string;
  sources?: string[];
  cities?: string[];
  modality?: string;
  freshness?: string;
  roles?: string[];
  // Exact (not fuzzy, not case-insensitive) match against job.company —
  // used by the /empresas/:slug company page (company-reputation-repository.ts's
  // getReputationForCompanies/resolveCompanyBySlug key reputation by this
  // same exact raw string, e.g. "TERPEL " with a trailing space; any other
  // matching semantics here would drift out of sync with that pipeline).
  company?: string;
  // ISO 3166-1 alpha-2 ('CO'/'VE'). A job with country IS NULL (remote —
  // see schema.sql's jobs.country comment) always passes regardless of this
  // filter's value — remote postings are meant to show for every country,
  // not just the one whose tick happened to discover them. Never filter on
  // `country === value` alone; that silently drops every remote job (see
  // GET /api/jobs in server.ts for the same rule applied server-side).
  country?: string;
}

const normalizeText = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Applies every corpus-wide filter (search/sources/cities/modality/
 * freshness/roles) in one pass. Deliberately excludes savedOnly/appliedOnly
 * — those depend on client-only session state (never persisted server-side
 * today), so the caller applies them itself on top of whatever page is
 * already loaded.
 */
export function applyJobFilters(jobs: Job[], filters: JobFilterParams): Job[] {
  let result = jobs;

  const rawSearch = filters.search?.trim();
  if (rawSearch) {
    const search = rawSearch.toLowerCase();
    // Only drop genuine stopwords ("de", "la", ...) — NOT short words. A
    // 1-2 char query ("r", "go") is a legitimate literal search and must
    // still be required below; dropping it here would leave searchWords
    // empty and match the entire corpus instead of nothing extra.
    const searchWords = search.split(/\s+/).filter((w) => w.length > 0 && !ROLE_STOPWORDS.has(w));

    if (searchWords.length <= 1) {
      // Single word (or only stopwords): unchanged from before this fix —
      // plain substring PLUS jobMatchesRole's synonym-aware OR. Left
      // exactly as-is because jobMatchesRole's "distinctive word" gate is
      // load-bearing here: a bare word like "desarrollador" expands (via
      // TRANSLATION_MAP) to also include "engineer", which is shared by
      // dozens of tracked roles (QA/Data/AI Engineer, ...) — the gate
      // excludes it from matching alone specifically so a lone
      // "desarrollador" search doesn't pull in every unrelated Engineer
      // posting. That guard only makes sense with nothing else narrowing
      // the query, which is exactly the single-word case.
      result = result.filter(
        (j: any) =>
          (j.title && j.title.toLowerCase().includes(search)) ||
          (j.company && j.company.toLowerCase().includes(search)) ||
          (j.location && j.location.toLowerCase().includes(search)) ||
          jobMatchesRole(rawSearch, j)
      );
    } else {
      // 2+ words: require EACH word independently (AND across words), using
      // the full synonym set per word (expandRoleWords, unfiltered by
      // jobMatchesRole's frequency gate) for recall — e.g. "ingeniería" also
      // matching "ingeniero"/"engineer". This is safe to be permissive on a
      // single word's synonyms specifically because another word in the
      // query still has to match too: "ingeniería civil" only matches
      // "Civil Engineer" because "civil" independently confirms it, not
      // because "ingeniería" alone decided it. The bug this replaces was
      // passing the WHOLE multi-word phrase to jobMatchesRole, which ORs
      // together words the 200 tracked role names don't share — "ingeniería"
      // and "civil" both counted as "distinctive" (neither appears in any
      // tracked role name, those are English, e.g. "QA Engineer") and got
      // OR'd, so any "ingeniería" job matched regardless of "civil": the
      // second word never actually narrowed anything.
      result = result.filter((j: any) => {
        const title = (j.title || "").toLowerCase();
        const company = (j.company || "").toLowerCase();
        const location = (j.location || "").toLowerCase();
        return searchWords.every((word) => {
          // expandRoleWords applies its own length/stopword filter, so it
          // can return [] for a short word even though we already decided
          // to require it — fall back to the literal word so it's still
          // checked, just without synonym expansion.
          const candidates = expandRoleWords(word);
          const forms = candidates.length > 0 ? candidates : [word];
          return forms.some(
            (candidate) =>
              title.includes(candidate) ||
              company.includes(candidate) ||
              location.includes(candidate)
          );
        });
      });
    }
  }

  if (filters.sources && filters.sources.length > 0) {
    const wanted = new Set(filters.sources);
    result = result.filter(
      (j: any) =>
        wanted.has(j.source) ||
        (Array.isArray(j.sources) && j.sources.some((s: string) => wanted.has(s))) ||
        (Array.isArray(j.alsoIn) && j.alsoIn.some((s: string) => wanted.has(s)))
    );
  }

  if (filters.cities && filters.cities.length > 0) {
    const wanted = filters.cities.map(normalizeText);
    result = result.filter((j: any) => {
      if (!j.location) return false;
      const loc = normalizeText(j.location);
      return wanted.some((c) => loc.includes(c));
    });
  }

  if (filters.modality && filters.modality !== "all") {
    const m = filters.modality.toLowerCase();
    result = result.filter((j: any) => {
      const loc = (j.location || "").toLowerCase();
      if (m === "remoto") return loc.includes("remoto") || loc.includes("remote");
      if (m === "hibrido") return loc.includes("híbrido") || loc.includes("hibrido");
      if (m === "presencial")
        return !loc.includes("remoto") && !loc.includes("remote") && !loc.includes("híbrido");
      return true;
    });
  }

  if (filters.freshness && filters.freshness !== "all") {
    const maxAgeHours =
      filters.freshness === "24h" ? 24 : filters.freshness === "48h" ? 48 : 24 * 7;
    result = result.filter((j: any) => {
      if (!j.publishedAt) return false;
      const ageHours = (Date.now() - new Date(j.publishedAt).getTime()) / (1000 * 60 * 60);
      return ageHours <= maxAgeHours;
    });
  }

  if (filters.roles && filters.roles.length > 0) {
    const roles = filters.roles;
    result = result.filter((j) => roles.some((role) => jobMatchesRole(role, j)));
  }

  if (filters.company) {
    const company = filters.company;
    result = result.filter((j: any) => j.company === company);
  }

  if (filters.country) {
    const wanted = filters.country.toUpperCase();
    result = result.filter((j: any) => j.country == null || j.country === wanted);
  }

  return result;
}

/**
 * Stable-partitions an already-filtered/sorted job list so postings matching
 * the caller's onboarding role preferences surface first, WITHOUT dropping
 * anything else — the onboarding modal (RoleOnboardingModal.tsx) promises
 * "te mostramos primero las vacantes que más te interesan", not "solo tus
 * vacantes". Each partition keeps its incoming relative order (newest-first,
 * from the caller's ORDER BY), so within "matches" and within "the rest" the
 * newest scraped postings still show up first — this only ever reorders
 * across the two groups, never within one.
 *
 * Only meaningful when the caller hasn't already filtered by roles
 * explicitly (see GET /api/jobs) — a manual role filter is a stronger,
 * intentional signal than a soft onboarding preference.
 */
export function sortByPreferredRoles(jobs: Job[], preferredRoles: string[] | null): Job[] {
  if (!preferredRoles || preferredRoles.length === 0) return jobs;
  const matches: Job[] = [];
  const rest: Job[] = [];
  for (const job of jobs) {
    if (preferredRoles.some((role) => jobMatchesRole(role, job))) matches.push(job);
    else rest.push(job);
  }
  return [...matches, ...rest];
}
