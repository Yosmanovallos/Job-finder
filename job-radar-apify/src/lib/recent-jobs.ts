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
import { assertNever, buildJobPath, cityHubPlaces, type IntentId, type ResolvedCategory } from "./job-seo.js";
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

// One formatter per time zone, reused for the life of the process. Building
// an Intl.DateTimeFormat is expensive and allocates native ICU memory that GC
// frees late. One per job per hub request (~2k per request) cost ~0.2 s of
// TTFB and pushed the Render instance past its memory limit (2026-11-06).
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** YYYY-MM-DD of `date` in `timeZone`. */
export function calendarDay(date: Date, timeZone: string): string {
  return dayFormatter(timeZone).format(date);
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
export function hubMatcher(
  hub: ResolvedCategory
): (job: Pick<RecentReadyJob, "title" | "location" | "country">) => boolean {
  const country = hub.country.toUpperCase();
  const inCountry = (job: Pick<RecentReadyJob, "country">) =>
    !job.country || job.country.toUpperCase() === country;
  // An intent page passes its own rows, already filtered by its SQL
  // (modality / experience / city / Google-ready), so only the country
  // rule applies here (ADR 0012).
  if (hub.kind === "intencion") return (job) => inCountry(job);
  if (hub.kind === "ciudad") {
    // Same places as cityHubFilters (aliases included, seo-intent-wave2 D6).
    const places = cityHubPlaces(hub.label).map(foldCityText);
    return (job) => {
      if (!inCountry(job)) return false;
      const location = foldCityText(job.location || "");
      return places.some((place) => location.includes(place));
    };
  }
  const matchesRole = roleTitleMatcher(hub.label);
  return (job) => inCountry(job) && matchesRole(job.title);
}

export function newTodayHeading(hub: ResolvedCategory): string {
  if (hub.kind === "intencion") {
    // /empleos/remoto (CO) keeps the heading it had as the "Remoto" city
    // bucket (ADR 0012 §5).
    const intent = hub.intent as IntentId;
    switch (intent) {
      case "remoto":
        return hub.country === "CO" && !hub.city ? "Nuevas hoy en Remoto" : "Vacantes remotas nuevas hoy";
      case "sin-experiencia":
        return hub.city ? `Vacantes sin experiencia nuevas hoy en ${hub.city}` : "Vacantes sin experiencia nuevas hoy";
      case "fines-de-semana":
        return "Vacantes de fines de semana nuevas hoy";
      case "medio-tiempo":
        return "Vacantes de medio tiempo nuevas hoy";
      case "temporada":
        return "Vacantes por temporada nuevas hoy";
      default:
        return assertNever(intent);
    }
  }
  return hub.kind === "ciudad"
    ? `Nuevas hoy en ${hub.label}`
    : `Vacantes de ${hub.label} nuevas hoy`;
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
    // The hub filter first (cheap string test), so only this hub's jobs are
    // date-formatted.
    .filter(matches)
    .filter((job) => {
      const published = new Date(job.publishedAt);
      return (
        Number.isFinite(published.getTime()) &&
        published.getTime() <= now.getTime() &&
        calendarDay(published, timeZone) === today
      );
    })
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime() ||
        (a.jobId < b.jobId ? 1 : -1)
    )
    .slice(0, NEW_TODAY_LIMIT)
    .map((job) => ({
      path: buildJobPath(job),
      title: job.title,
      company: job.company as string,
      location: job.location as string
    }));
  return links.length > 0 ? { heading: newTodayHeading(hub), links } : null;
}
