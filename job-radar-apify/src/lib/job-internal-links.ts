/**
 * Internal links of a job detail page (docs/SEO-JOB-LINK-GRAPH-2026-10-29.md).
 *
 * Until 2026-10-29 the raw HTML of a job page had exactly two links, both to
 * the source. Google crawled ~10k of those dead-end pages and left them
 * unindexed. Every job page now links back to the city hub that lists it and
 * to a rotating handful of other live jobs from that same hub, so hubs and
 * jobs reinforce each other instead of leaking every link out.
 *
 * Pure and client-safe: server.ts (raw HTML) and JobLanding.tsx (hydrated DOM)
 * render the same links from the same functions.
 */
import { getCountryConfig } from "../countries/index.js";
import { jobStaleReason } from "./job-freshness.js";
import { SITE_URL, buildCategoryPath, buildCategoryUrl, buildJobPath, buildJobUrl, cityHubPlaces, escapeHtml, type ResolvedCategory } from "./job-seo.js";

/** City hubs list their first 60 jobs (server.ts). Sharing it keeps one cache entry per city. */
export const CITY_HUB_PAGE_LIMIT = 60;
export const RELATED_JOBS_LIMIT = 6;

export interface RelatedJobLink {
  path: string;
  title: string;
  company: string;
  location: string;
}

export interface JobLinksPayload {
  jobId: string;
  related: RelatedJobLink[];
}

// Same folding as buildJobWhere's city predicate: accents stripped, lowercase,
// then a plain substring test against the location text.
function foldCityText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * The city hub whose SQL filter lists this job, or null. Only cities of the
 * job's own listing market (a remote job without a country has no hub); when
 * the location names several, the one named first wins (deterministic).
 */
export function resolveJobCityHub(job: { location?: string | null; country?: string | null }): ResolvedCategory | null {
  if (!job.country || !job.location) return null;
  const country = job.country.toUpperCase();
  const config = getCountryConfig(country);
  if (config.code !== country) return null;
  const location = foldCityText(job.location);
  let best: { label: string; at: number } | null = null;
  for (const city of config.cities) {
    const at = location.indexOf(foldCityText(city));
    if (at >= 0 && (!best || at < best.at)) best = { label: city, at };
  }
  return best ? { kind: "ciudad", label: best.label, country } : null;
}

/** Filters of the city hub page; server.ts's hub and job routes must both use this. */
export function cityHubFilters(hub: ResolvedCategory): { cities: string[]; country: string } {
  // A hub with location aliases (Ciudad Guayana + Puerto Ordaz, seo-intent-wave2 D6)
  // lists them too; every other hub keeps exactly { cities: [label] }.
  return { cities: cityHubPlaces(hub.label), country: hub.country };
}

// FNV-1a: a stable, cheap spread so each job links a different slice of its hub.
export function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * CX-9 (adsense-readiness F2): the rows of a cached listing page that are
 * still live by the shared freshness rule. Listing queries already filter
 * with liveJobSql(), but a stale-while-revalidate entry can outlive a row's
 * 30-day limit (or its validThrough, when the row carries it) by hours, and
 * a hub must not link a page that already answers 410. Returns a new array;
 * the cached one is never mutated. An archived row that is still young can't
 * be told apart here; the next cache refresh drops it.
 */
export function liveListingJobs<T extends { publishedAt?: string | Date | null; validThrough?: string | Date | null }>(
  jobs: readonly T[],
  now: Date = new Date()
): T[] {
  return jobs.filter((job) => jobStaleReason(job.publishedAt, job.validThrough, now) === null);
}

// Words that say nothing about the role ("Analista de Datos" ~ "Analista de Cartera" by "analista").
const ROLE_STOPWORDS = new Set(["de", "del", "la", "las", "el", "los", "en", "y", "e", "o", "u", "para", "con", "por", "a", "al", "sin", "the", "and", "of", "for"]);

function roleTokens(title: string): Set<string> {
  return new Set(
    foldCityText(title)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1 && !ROLE_STOPWORDS.has(token))
  );
}

/** Jaccard overlap of the role words of two titles, 0..1. */
function roleProximity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Up to `limit` other jobs from the hub's own list, starting at an offset
 * derived from this job's id: siblings share link equity instead of every
 * page pointing at the same newest postings. Only public fields.
 *
 * With the current job's `title` (CX-5, adsense-readiness F2) the same
 * candidates are ranked by role proximity first, so a cook's page and an
 * analyst's page in one city no longer repeat one identical block; ties
 * keep the id-derived rotation. The number of links never changes.
 */
export function pickRelatedJobs(
  jobId: string,
  candidates: Array<{ jobId: string; title: string; company?: string | null; location?: string | null; url?: string | null }>,
  limit = RELATED_JOBS_LIMIT,
  title?: string
): RelatedJobLink[] {
  const eligible = candidates.filter(
    (job) => job.jobId !== jobId && job.title && job.company && job.location && job.url
  );
  if (eligible.length === 0) return [];
  const start = stableHash(jobId) % eligible.length;
  const rotated = eligible.map((_, i) => eligible[(start + i) % eligible.length]);
  let pool = rotated;
  if (title) {
    const own = roleTokens(title);
    pool = rotated
      .map((job, order) => ({ job, order, score: roleProximity(own, roleTokens(job.title)) }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map((entry) => entry.job);
  }
  const picked: RelatedJobLink[] = [];
  for (let i = 0; i < Math.min(limit, pool.length); i++) {
    const job = pool[i];
    picked.push({
      path: buildJobPath({ jobId: job.jobId, title: job.title, location: job.location ?? null }),
      title: job.title,
      company: job.company!,
      location: job.location!
    });
  }
  return picked;
}

export function cityHubHeading(hub: ResolvedCategory): string {
  return `Empleos en ${hub.label}`;
}

/** BreadcrumbList matching the visible trail: Inicio › Empleos en <ciudad> › vacante. */
export function buildJobBreadcrumbList(
  job: { jobId: string; title: string; location?: string | null },
  hub: ResolvedCategory | null
): object {
  const items: Array<{ name: string; item: string }> = [{ name: "Inicio", item: `${SITE_URL}/` }];
  if (hub) items.push({ name: cityHubHeading(hub), item: buildCategoryUrl(hub) });
  items.push({ name: job.title, item: buildJobUrl({ jobId: job.jobId, title: job.title, location: job.location ?? null }) });
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((entry, index) => ({ "@type": "ListItem", position: index + 1, ...entry }))
  };
}

/** Raw-HTML trail placed before the server-rendered job body. Every string escaped. */
export function renderJobBreadcrumbHtml(job: { title: string }, hub: ResolvedCategory | null): string {
  const trail = [
    `<a href="/">Inicio</a>`,
    ...(hub ? [`<a href="${escapeHtml(buildCategoryPath(hub))}">${escapeHtml(cityHubHeading(hub))}</a>`] : []),
    `<span>${escapeHtml(job.title)}</span>`
  ].join(" › ");
  return `<nav aria-label="Ruta" data-job-breadcrumb>${trail}</nav>`;
}

/** Raw-HTML related-jobs section placed after the job body; empty without a hub or links. */
export function renderRelatedJobsHtml(hub: ResolvedCategory | null, related: RelatedJobLink[]): string {
  if (!hub) return "";
  const hubLink = `<p><a href="${escapeHtml(buildCategoryPath(hub))}">Ver todos los empleos en ${escapeHtml(hub.label)}</a></p>`;
  if (related.length === 0) return `<section data-related-jobs>${hubLink}</section>`;
  const items = related
    .map(
      (link) =>
        `<li><a href="${escapeHtml(link.path)}">${escapeHtml(link.title)}</a> — ${escapeHtml(link.company)} · ${escapeHtml(link.location)}</li>`
    )
    .join("");
  return `<section data-related-jobs><h2>Más empleos en ${escapeHtml(hub.label)}</h2><ul>${items}</ul>${hubLink}</section>`;
}

/** Validates window.__SSR_JOB_LINKS__ before React trusts it: this job only, path-only links. */
export function readJobLinks(id: string | undefined, payload: unknown): RelatedJobLink[] {
  if (!id || !payload || typeof payload !== "object") return [];
  const value = payload as Partial<JobLinksPayload>;
  if (value.jobId !== id || !Array.isArray(value.related)) return [];
  return value.related
    .filter(
      (link): link is RelatedJobLink =>
        !!link &&
        typeof link.path === "string" &&
        link.path.startsWith("/empleos/") &&
        [link.title, link.company, link.location].every((field) => typeof field === "string" && field.length > 0)
    )
    .slice(0, RELATED_JOBS_LIMIT);
}
