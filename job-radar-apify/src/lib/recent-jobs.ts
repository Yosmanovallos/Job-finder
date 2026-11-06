/**
 * SEO Fase B (docs/seo-baseline/2026-11-06-checkpoint-y-plan-registros.md):
 * index new Google-ready jobs faster.
 *
 * One read-only snapshot of the recent, Google-ready, canonical jobs (the
 * rows sitemap-jobs.xml lists, restricted to a published_at window) feeds:
 *   - /sitemap-jobs-recent.xml (every URL is also in sitemap-jobs.xml, same <lastmod>)
 *   - the «Nuevas hoy» block of city/role hubs (server HTML and hydrated React)
 *   - the IndexNow submission script
 *
 * Pure and client-safe: server.ts and CategoryLanding.tsx render the same
 * links from the same function.
 */
import { buildJobPath, type ResolvedCategory } from "./job-seo.js";
import { roleTitleMatcher } from "./job-filters.js";

/** Window of /sitemap-jobs-recent.xml (task: last 48–72 h). */
export const RECENT_SITEMAP_WINDOW_HOURS = 72;
/** At most this many links in a hub's «Nuevas hoy» block. */
export const NEW_TODAY_LIMIT = 10;

/** A row of the shared snapshot: public fields only. */
export interface RecentReadyJob {
  jobId: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string | null;
  country: string | null;
  publishedAt: string | Date;
  isLocked: boolean;
  /** Real content-change time; NULL for legacy rows (then <lastmod> is omitted). */
  contentUpdatedAt: string | Date | null;
}

export interface NewTodayLink {
  path: string;
  title: string;
  company: string;
  location: string;
}

export interface NewTodayBlock {
  heading: string;
  links: NewTodayLink[];
}

/** "Hoy" is the calendar day of the hub's own country, never the server's. */
export function hubTimeZone(country: string): string {
  return country.toUpperCase() === "VE" ? "America/Caracas" : "America/Bogota";
}

/** YYYY-MM-DD of `date` in `timeZone`. */
export function calendarDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

// Same folding as buildJobWhere's city predicate (LOWER + accents stripped,
// then a plain substring test) and job-internal-links.ts.
function foldCityText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * In-memory twin of the hub's SQL filter (server.ts: cityHubFilters for a
 * city, `{ roles: [label], country }` for a role): the location contains the
 * city, or the title matches the role with the same word plan as
 * rolePredicate(); `country IS NULL OR country = hub.country`.
 */
export function hubMatcher(hub: ResolvedCategory): (job: Pick<RecentReadyJob, "title" | "location" | "country">) => boolean {
  const country = hub.country.toUpperCase();
  const inCountry = (job: Pick<RecentReadyJob, "country">) => !job.country || job.country.toUpperCase() === country;
  if (hub.kind === "ciudad") {
    const city = foldCityText(hub.label);
    return (job) => inCountry(job) && foldCityText(job.location || "").includes(city);
  }
  const matchesRole = roleTitleMatcher(hub.label);
  return (job) => inCountry(job) && matchesRole(job.title);
}

export function newTodayHeading(hub: ResolvedCategory): string {
  return hub.kind === "ciudad" ? `Nuevas hoy en ${hub.label}` : `Vacantes de ${hub.label} nuevas hoy`;
}

/**
 * The hub's «Nuevas hoy» block: Google-ready jobs of this hub published on
 * today's calendar day (hub country's time zone), newest first, at most
 * NEW_TODAY_LIMIT. Null when none qualify — the block is omitted, never
 * padded with older jobs.
 */
export function buildNewTodayBlock(
  hub: ResolvedCategory,
  recent: readonly RecentReadyJob[] | undefined,
  now: Date = new Date()
): NewTodayBlock | null {
  if (!recent || recent.length === 0) return null;
  const timeZone = hubTimeZone(hub.country);
  const today = calendarDay(now, timeZone);
  const matches = hubMatcher(hub);
  const links = recent
    .filter((job) => job.company && job.location && job.url && !job.isLocked)
    .filter((job) => {
      const published = new Date(job.publishedAt);
      return Number.isFinite(published.getTime()) && published.getTime() <= now.getTime() && calendarDay(published, timeZone) === today;
    })
    .filter(matches)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime() || (a.jobId < b.jobId ? 1 : -1))
    .slice(0, NEW_TODAY_LIMIT)
    .map((job) => ({
      path: buildJobPath(job),
      title: job.title,
      company: job.company as string,
      location: job.location as string
    }));
  return links.length > 0 ? { heading: newTodayHeading(hub), links } : null;
}
