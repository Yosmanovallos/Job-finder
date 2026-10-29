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
import { SITE_URL, buildCategoryPath, buildCategoryUrl, buildJobPath, buildJobUrl, escapeHtml, type ResolvedCategory } from "./job-seo.js";

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
  return { cities: [hub.label], country: hub.country };
}

// FNV-1a: a stable, cheap spread so each job links a different slice of its hub.
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Up to `limit` other jobs from the hub's own list, starting at an offset
 * derived from this job's id: siblings share link equity instead of every
 * page pointing at the same newest postings. Only public fields.
 */
export function pickRelatedJobs(
  jobId: string,
  candidates: Array<{ jobId: string; title: string; company?: string | null; location?: string | null; url?: string | null }>,
  limit = RELATED_JOBS_LIMIT
): RelatedJobLink[] {
  const pool = candidates.filter(
    (job) => job.jobId !== jobId && job.title && job.company && job.location && job.url
  );
  if (pool.length === 0) return [];
  const start = stableHash(jobId) % pool.length;
  const picked: RelatedJobLink[] = [];
  for (let i = 0; i < Math.min(limit, pool.length); i++) {
    const job = pool[(start + i) % pool.length];
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
