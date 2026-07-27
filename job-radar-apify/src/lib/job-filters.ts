import { Job } from "../sources/types.js";
import { DEFAULT_ROLES_200 } from "../queue/scheduler.js";
import { TRANSLATION_MAP } from "../ai-role-agent.js";

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

export interface JobFilterParams {
  search?: string;
  sources?: string[];
  cities?: string[];
  modality?: string;
  freshness?: string;
  roles?: string[];
}

const normalizeText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

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
  const search = rawSearch?.toLowerCase();
  if (search && rawSearch) {
    // Plain substring match (title/company/location) PLUS the same
    // synonym-aware role matching the role checkboxes use (jobMatchesRole)
    // — otherwise typing "QA" in the search box misses "Quality Assurance"/
    // "Ingeniero de Calidad" postings that the checkbox filter for "QA
    // Engineer" already finds, which is exactly the inconsistency between
    // the two filters that must not exist: the search box is the primary
    // way people use this app, so it needs at least the same recall as the
    // checkbox filter, not less.
    result = result.filter(
      (j: any) =>
        (j.title && j.title.toLowerCase().includes(search)) ||
        (j.company && j.company.toLowerCase().includes(search)) ||
        (j.location && j.location.toLowerCase().includes(search)) ||
        jobMatchesRole(rawSearch, j)
    );
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

  return result;
}
