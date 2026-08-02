import { Job } from "../sources/types.js";
import { getModalityLabel, CITY_OPTIONS } from "./job-filters.js";
import { DEFAULT_ROLES_200 } from "../queue/scheduler.js";
import { getCountryConfig } from "../countries/index.js";

const SITE_URL = "https://buscotrabajo.co";
// jobs older than this are purged from the DB (see job-repository.ts's
// getJobs() comment) — a real, system-derived upper bound on how long this
// listing can possibly still be active here, used for JobPosting's required
// `validThrough` since we don't have the source's actual application
// deadline. Never invents a fact we don't have; states one we do.
const MAX_LISTING_AGE_DAYS = 30;

export type SeoJob = Job & {
  isLocked?: boolean;
  alsoIn?: string[];
  sources?: string[];
  role_origin?: string;
};

// Mirrors the `& < > " '` set that can break out of an HTML attribute or
// text node. Job titles/companies/locations come from scraped, untrusted
// third-party pages (see AGENTS.md's "treat scraped text as adversarial") —
// this runs on every string before it lands in server-rendered HTML.
export function escapeHtml(input: string): string {
  return String(input ?? "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

// Safe to embed inside <script type="application/ld+json">: escaping "<" as
// its Unicode form means a title/company containing the literal text
// "</script>" can never terminate the script block early — JSON.stringify
// alone does not do this, since "<" is not a JSON-significant character.
export function escapeJsonForScriptTag(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// Strips accents/diacritics and non-alphanumerics so "Ingeniero(a) — Bogotá"
// becomes "ingeniero-a-bogota", not something with raw punctuation or
// mismatched casing across two calls for the same input.
const COMBINING_DIACRITICS = /[\u0300-\u036f]/g;

export function slugify(text: string): string {
  return (
    (text || "")
      .normalize("NFD")
      // Strip combining diacritics left behind by NFD decomposition, e.g.
      // "á" -> "a" + U+0301, "ñ" -> "n" + U+0303 — dropping U+0300-U+036F
      // collapses both back to plain ASCII letters for a clean URL segment.
      .replace(COMBINING_DIACRITICS, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "vacante"
  );
}

// The slug half of the URL is purely decorative/cosmetic for click-through
// readability — matching is always by id (see buildJobPath), so a stale
// slug from a since-edited title never 404s; it just canonicalizes to the
// current one instead of needing a migration-backed slug column at all.
export function buildJobSlug(job: SeoJob): string {
  return slugify(`${job.title} ${job.location || ""}`);
}

// Remote jobs (job.country == null) stay on the plain /empleos/ path — the
// /ve prefix is for Venezuela-specific postings, not for remote ones that
// already show to every country (see schema.sql's jobs.country comment);
// prefixing them would make the same posting resolve at two different
// canonical URLs depending on which country's page linked to it.
export function buildJobPath(job: SeoJob): string {
  const prefix = job.country === "VE" ? "/ve" : "";
  return `${prefix}/empleos/${job.jobId}/${buildJobSlug(job)}`;
}

export function buildJobUrl(job: SeoJob): string {
  return `${SITE_URL}${buildJobPath(job)}`;
}

// The one fixed part of a job's URL that survives its deletion — the slug
// half is title-derived and lost forever once the row is gone (see
// purgeOldJobs()'s comment in scheduler-repository.ts), but every URL this
// app ever generates for a given jobId contains this exact segment, so a
// LIKE '%<segment>%' lookup against indexing_queue's stored URL_DELETED rows
// (Fase 5) can recognize "this id existed and expired" without needing a
// separate tombstone table/column. Deliberately NOT anchored to SITE_URL/
// the start of the string (as it was before buildJobPath started
// conditionally prepending "/ve") — jobId (a UUID) is globally unique
// regardless of country, so matching the segment anywhere in the stored URL
// correctly recognizes a purged job whether it was "/empleos/:id/..." or
// "/ve/empleos/:id/..." without the caller (server.ts's wasJobPurged(id))
// needing to know or pass the job's country.
export function buildJobUrlPrefix(jobId: string): string {
  return `/empleos/${jobId}/`;
}

// A job is only eligible for a public, indexable page once
// `maskLockedFields` has already run — this checks the *result* of that
// (company/location/url present), not `isLocked` directly, so it can never
// drift out of sync with what the API/UI actually decided to show an
// anonymous visitor. See config.ts's PAYWALL_ENABLED: today it's off and
// every job passes; if it's ever re-enabled, this starts excluding <48h
// jobs automatically, with no separate logic to keep in sync.
export function isPubliclyDescribable(job: SeoJob): boolean {
  return Boolean(job.company && job.location && job.url);
}

// Real, variable facts only — never invented prose. Draws on the same
// fields the UI already shows (JobDetailPanel/JobCard), so a crawler never
// sees a claim a real visitor wouldn't also see.
export function buildJobDescription(job: SeoJob): string {
  const parts: string[] = [];
  const fallbackLocation = getCountryConfig(job.country).name;
  parts.push(
    `${job.title} en ${job.company || "una empresa confidencial"}, ${job.location || fallbackLocation}.`
  );

  const modality = getModalityLabel(job.location);
  if (modality) parts.push(`Modalidad: ${modality}.`);

  const otherSources = (job.alsoIn || (job.sources || []).filter((s) => s !== job.source)).filter(
    Boolean
  );
  if (otherSources.length > 0) {
    parts.push(`También publicada en: ${otherSources.join(", ")}.`);
  }

  parts.push(
    `Vacante agregada de ${job.source}. La descripción completa y el formulario de aplicación están en la página de ${job.source} — BuscoTrabajo no aloja el proceso de aplicación.`
  );

  return parts.join(" ");
}

export interface JobMeta {
  title: string;
  description: string;
  canonicalUrl: string;
}

export function buildJobMeta(job: SeoJob): JobMeta {
  const countryName = getCountryConfig(job.country).name;
  const location = job.location || countryName;
  const company = job.company || "una empresa confidencial";
  return {
    title: `${job.title} — ${company} (${location}) | BuscoTrabajo`,
    description: `${job.title} en ${company}, ${location}. Vacante agregada de ${job.source} en BuscoTrabajo — vacantes de empleo en ${countryName}.`,
    canonicalUrl: buildJobUrl(job)
  };
}

// Returns null for locked/incomplete jobs — callers must not render
// JobPosting structured data at all in that case (see
// isPubliclyDescribable), rather than emitting one with null fields.
export function buildJobPosting(job: SeoJob): Record<string, unknown> | null {
  if (!isPubliclyDescribable(job)) return null;

  const publishedAt = job.publishedAt ? new Date(job.publishedAt) : new Date();
  const validThrough = new Date(publishedAt.getTime() + MAX_LISTING_AGE_DAYS * 24 * 60 * 60 * 1000);

  return {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: buildJobDescription(job),
    identifier: {
      "@type": "PropertyValue",
      name: job.source,
      value: job.jobId
    },
    datePosted: publishedAt.toISOString(),
    validThrough: validThrough.toISOString(),
    hiringOrganization: {
      "@type": "Organization",
      name: job.company
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.location,
        // job.country is null for remote postings (schema.sql's convention)
        // — falls back to CO via getCountryConfig's own default, same
        // assumption this hardcoded "CO" already made for every job before
        // the country column existed, not a new invention.
        addressCountry: getCountryConfig(job.country).code
      }
    }
  };
}

// --- Category pages (Fase 4) -------------------------------------------------
//
// Reuse the existing flat `/empleos/<slug>` URL shape from Fase 1
// (`/empleos/:id/:slug?` in App.tsx/server.ts) instead of a new route prefix
// — a jobId is always a UUID (gen_random_uuid(), see docs/SEO-PLAN.md §3b),
// which a city/role slug can never look like, so isUuid() alone tells the
// two apart with no ambiguity, checked on both the server route and the
// client dispatcher.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export type CategoryKind = "ciudad" | "rol";

// Looks a non-UUID `/empleos/` segment up against the same taxonomy the
// dashboard's filters already use (CITY_OPTIONS, DEFAULT_ROLES_200) — no new
// list to maintain, and a slug that matches neither is a real 404, not a
// doorway page for arbitrary text.
export function resolveCategorySlug(slug: string): { kind: CategoryKind; label: string } | null {
  const target = (slug || "").toLowerCase();
  for (const city of CITY_OPTIONS) {
    if (slugify(city) === target) return { kind: "ciudad", label: city };
  }
  for (const role of DEFAULT_ROLES_200) {
    if (slugify(role) === target) return { kind: "rol", label: role };
  }
  return null;
}

export function buildCategoryPath(label: string): string {
  return `/empleos/${slugify(label)}`;
}

export function buildCategoryUrl(label: string): string {
  return `${SITE_URL}${buildCategoryPath(label)}`;
}

// Company page (dashboard navigation, not an SEO-driven fase like the
// category pages above — see the "empresas" feature note in
// docs/COMPANY-REPUTATION-PLAN.md). Same flat single-slug shape; the
// company name (never an id) is what resolveCompanyBySlug() in
// company-reputation-repository.ts matches back against, mirroring
// resolveCategorySlug()'s pattern.
export function buildCompanyPath(companyName: string): string {
  return `/empresas/${slugify(companyName)}`;
}

export function buildCompanyUrl(companyName: string): string {
  return `${SITE_URL}${buildCompanyPath(companyName)}`;
}

// Fallback resolution for /empresas/:slug when the slug isn't one of the
// ~116 companies with curated reputation (resolveCompanyBySlug() in
// company-reputation-repository.ts) — every real company that has ever
// posted a job should still get a working page (just without a
// reputation section), not a dead link. Matches against whatever job list
// the caller already has in memory (never a separate query) — same
// in-memory slug-match pattern as resolveCategorySlug()/resolveCompanyBySlug().
// Slug collisions between two differently-punctuated/cased company names
// are possible (there's no unique company id in this schema) — accepted
// as a rare, low-stakes edge case, same tradeoff every slug-based URL
// scheme here already makes.
export function resolveCompanyNameFromJobs(slug: string, jobs: Job[]): string | null {
  for (const job of jobs) {
    if (job.company && slugify(job.company) === slug) return job.company;
  }
  return null;
}

export interface CategoryMeta {
  title: string;
  // Plain page heading (no " | BuscoTrabajo" suffix, no count) — kept
  // separate from `title` so callers needing an <h1> don't have to parse
  // one back out of the SEO title string.
  heading: string;
  description: string;
  canonicalUrl: string;
}

// totalCount is always the real match count for that city/role — never
// capped to however many rows actually get embedded/rendered on the page
// (see server.ts's 60-item cap), so the description never claims fewer or
// more vacancies than truly exist right now.
export function buildCategoryMeta(
  kind: CategoryKind,
  label: string,
  totalCount: number
): CategoryMeta {
  const countLabel = totalCount === 1 ? "1 vacante" : `${totalCount} vacantes`;
  const heading =
    kind === "ciudad" ? `Vacantes de empleo en ${label}` : `Vacantes de ${label} en Colombia`;
  return {
    title: `${heading} — ${countLabel} | BuscoTrabajo`,
    heading,
    description: `${countLabel} ${kind === "ciudad" ? `en ${label}` : `de ${label} en Colombia`} agregadas de LinkedIn, Computrabajo, Elempleo y otros portales — actualizadas en BuscoTrabajo.`,
    canonicalUrl: buildCategoryUrl(label)
  };
}

// One flat sitemap covers all categories comfortably (9 cities + however
// many roles DEFAULT_ROLES_200 has today — well under the 50k/file limit
// buildJobsSitemapXml's comment already covers), no lastmod: unlike a job
// posting, a category page has no single "last changed" timestamp that
// isn't already implicit in how often the sitemap itself gets re-crawled.
export function buildCategoriesSitemapXml(): string {
  const labels = [...CITY_OPTIONS, ...DEFAULT_ROLES_200];
  const urls = labels.map((label) => xmlUrlEntry(buildCategoryUrl(label))).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// --- Sitemap (Fase 2) -------------------------------------------------------
//
// 50,000 URLs / 50MB is the hard per-file limit every search engine's
// sitemap parser enforces — comfortably above today's corpus (~10k jobs),
// so a single sitemap-jobs.xml is fine for now. If the corpus ever grows
// past that, split by generating N job sitemaps and listing all of them in
// the index below (same shape, just more <sitemap> entries) — don't wait
// until it's actually a problem to add that.

function xmlUrlEntry(loc: string, lastmod?: string): string {
  const lastmodTag = lastmod ? `\n    <lastmod>${escapeHtml(lastmod)}</lastmod>` : "";
  return `  <url>\n    <loc>${escapeHtml(loc)}</loc>${lastmodTag}\n  </url>`;
}

// Callers must pass jobs already sourced from the same deduped view
// /empleos/:id resolves against (getJobs()/getJobsCached(), which
// DISTINCT ONs by title+company+location) — a sitemap built against the
// raw `jobs` table would list ids that route 404s on (rows collapsed by
// that DISTINCT ON), which is a soft-404 generator at sitemap scale. Also
// filters to isPubliclyDescribable for the same cloaking-avoidance reason
// buildJobPosting() does: a locked job has no real page to list yet.
export function buildJobsSitemapXml(jobs: SeoJob[]): string {
  const urls = jobs
    .filter(isPubliclyDescribable)
    .map((job) =>
      xmlUrlEntry(
        buildJobUrl(job),
        job.publishedAt ? new Date(job.publishedAt).toISOString() : undefined
      )
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function buildSitemapIndexXml(sitemapUrls: string[]): string {
  const entries = sitemapUrls
    .map((loc) => `  <sitemap>\n    <loc>${escapeHtml(loc)}</loc>\n  </sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
}
