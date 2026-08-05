import { Job } from "../sources/types.js";
import { getModalityLabel, CITY_OPTIONS } from "./job-filters.js";
import { DEFAULT_ROLES_200 } from "../queue/scheduler.js";
import { getCountryConfig, DEFAULT_COUNTRY } from "../countries/index.js";

export const SITE_URL = "https://buscotrabajo.co";
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

// Deliberately country-agnostic — every job page lives at /empleos/:id
// regardless of country, id-addressed and globally unique. An earlier
// version of this prefixed Venezuela jobs with /ve/empleos/..., but
// server.ts's SSR route matching, the sitemap, and the Google Indexing API
// queue (saveJobs -> enqueueIndexingNotifications) all only ever knew about
// /empleos/ — that would have submitted /ve/empleos/ URLs to Google with no
// server route actually serving them. /ve stays scoped to the dashboard
// listing (App.tsx's /ve/dashboard, Dashboard.tsx's own prefix check),
// which never touches the sitemap/indexing pipeline.
export function buildJobPath(job: SeoJob): string {
  return `/empleos/${job.jobId}/${buildJobSlug(job)}`;
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
export interface JobDescriptionContext {
  // Count of other active jobs at the same company, computed by the caller
  // from the same getJobsCached() list already loaded for this request (no
  // new query — see server.ts). Real, per-company, varies naturally across
  // the corpus instead of every page sharing one template — the enrichment
  // docs/SEO-PLAN.md §5.2/§9.3 flagged as the durable fix for thin/near-
  // duplicate JobPosting descriptions at this scale. Omitted (not 0) for
  // callers without that context (e.g. isolated unit tests) — 0 would
  // falsely claim "no other jobs here" for a company we simply didn't check.
  companyActiveCount?: number;
}

export function buildJobDescription(job: SeoJob, context: JobDescriptionContext = {}): string {
  const parts: string[] = [];
  const fallbackLocation = getCountryConfig(job.country).name;
  parts.push(
    `${job.title} en ${job.company || "una empresa confidencial"}, ${job.location || fallbackLocation}.`
  );

  const modality = getModalityLabel(job.location);
  if (modality) parts.push(`Modalidad: ${modality}.`);

  // Same real timestamp already used for JobPosting's datePosted below —
  // stated here as visible text too, not just buried in JSON-LD. A real
  // publish date in the visible content is a documented recency/freshness
  // signal for both traditional E-E-A-T and AI-citation eligibility
  // (SEO-IMPROVEMENT-PLAN.md §1.12) — never a fabricated "last updated"
  // claim, just this job's own already-known `publishedAt`.
  if (job.publishedAt) {
    const publishedLabel = new Date(job.publishedAt).toLocaleDateString("es-CO", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
    parts.push(`Publicado el ${publishedLabel}.`);
  }

  // "- 1" excludes this job itself from its own count.
  const otherAtCompany = (context.companyActiveCount ?? 0) - 1;
  if (job.company && otherAtCompany > 0) {
    parts.push(
      `${job.company} tiene ${otherAtCompany} vacante${otherAtCompany === 1 ? "" : "s"} más activa${otherAtCompany === 1 ? "" : "s"} en BuscoTrabajo.`
    );
  }

  const otherSources = (job.alsoIn || (job.sources || []).filter((s) => s !== job.source)).filter(
    Boolean
  );
  if (otherSources.length > 0) {
    parts.push(`También publicada en: ${otherSources.join(", ")}.`);
  }

  // Factual (where to apply), not self-deprecating — states the same real
  // fact as before (BuscoTrabajo aggregates, doesn't host applications)
  // without the "we add no value" framing that content_quality.py (claude-seo)
  // and Google's scaled-content-abuse policy both read as a low-value-
  // aggregator signal. See docs/SEO-PLAN.md §9.3.
  parts.push(`Vacante agregada de ${job.source}. Aplica directamente en la página de ${job.source}.`);

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

// A `location` that's ONLY the remote marker ("Remoto"/"Remote", no city
// attached) has nothing real to put in jobLocation.address.addressLocality
// — schema.org's PostalAddress expects an actual place name, and Google's
// JobPosting rich-result guidance (developers.google.com/search/docs/
// appearance/structured-data/job-posting#job-location) says to use
// jobLocationType: "TELECOMMUTE" instead for exactly this case. A location
// that ALSO names a real city ("Remoto - Bogotá", "Híbrido - Medellín")
// keeps the normal jobLocation branch below — that IS real, useful place
// info, not a placeholder, so it's left alone.
const BARE_REMOTE_RE = /^(remoto|remote)$/i;

function isBareRemoteLocation(location: string | undefined | null): boolean {
  return BARE_REMOTE_RE.test((location || "").trim());
}

// Returns null for locked/incomplete jobs — callers must not render
// JobPosting structured data at all in that case (see
// isPubliclyDescribable), rather than emitting one with null fields.
export function buildJobPosting(
  job: SeoJob,
  context: JobDescriptionContext = {}
): Record<string, unknown> | null {
  if (!isPubliclyDescribable(job)) return null;

  const publishedAt = job.publishedAt ? new Date(job.publishedAt) : new Date();
  const validThrough = new Date(publishedAt.getTime() + MAX_LISTING_AGE_DAYS * 24 * 60 * 60 * 1000);

  const posting: Record<string, unknown> = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: buildJobDescription(job, context),
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
    }
  };

  if (isBareRemoteLocation(job.location)) {
    posting.jobLocationType = "TELECOMMUTE";
    // job.country is null for remote postings (schema.sql's convention) —
    // falls back to CO via getCountryConfig's own default, same assumption
    // every other caller of getCountryConfig(job.country) already makes,
    // not a new invention.
    posting.applicantLocationRequirements = {
      "@type": "Country",
      name: getCountryConfig(job.country).name
    };
  } else {
    posting.jobLocation = {
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
    };
  }

  return posting;
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

export interface ResolvedCategory {
  kind: CategoryKind;
  label: string;
  // For "ciudad": inherent to the matched city, independent of which prefix
  // the request came in on — "Caracas" is Venezuela and "Bogotá" is
  // Colombia no matter what URL you typed, city names between the two
  // countries never collide (see countries/index.ts), so there's exactly
  // one canonical URL per city and no /ve-prefixed alias for it (see
  // buildCategoryPath below). For "rol": roles are shared vocabulary with
  // no geography of their own — this just echoes back requestCountry, i.e.
  // which of the two co-existing pages (/empleos/<rol> vs
  // /ve/empleos/<rol>) was actually asked for, so a page never silently
  // mixes both countries' listings under one URL the way it did before
  // this field existed.
  country: string;
}

// Role slugs removed from DEFAULT_ROLES_200 in a taxonomy swap (see
// SEO-IMPROVEMENT-PLAN.md §1.10) — these URLs were already in
// sitemap-categories.xml and crawled by Google before the swap, so once
// resolveCategorySlug() stops recognizing them they must not silently fall
// through to a generic "never existed" 404. Mirrors the same 410 treatment
// wasJobPurged() already gives a retired job URL: a real, deliberate
// "no longer here" signal, not the same code path as a slug that never
// existed. Append to this, never remove an entry, when a future swap
// retires more role slugs.
export const RETIRED_ROLE_SLUGS: ReadonlySet<string> = new Set(
  ["Data Analyst", "Data Engineer", "RPA Developer"].map(slugify)
);

// Looks a non-UUID `/empleos/` segment up against the same taxonomy the
// dashboard's filters already use (CITY_OPTIONS + Venezuela's own city list,
// DEFAULT_ROLES_200) — no new list to maintain beyond what countries/
// index.ts already has, and a slug that matches neither is a real 404, not
// a doorway page for arbitrary text.
export function resolveCategorySlug(
  slug: string,
  requestCountry: string = DEFAULT_COUNTRY
): ResolvedCategory | null {
  const target = (slug || "").toLowerCase();
  for (const city of CITY_OPTIONS) {
    if (slugify(city) === target) return { kind: "ciudad", label: city, country: "CO" };
  }
  for (const city of getCountryConfig("VE").cities) {
    if (slugify(city) === target) return { kind: "ciudad", label: city, country: "VE" };
  }
  for (const role of DEFAULT_ROLES_200) {
    if (slugify(role) === target) return { kind: "rol", label: role, country: requestCountry };
  }
  return null;
}

// City pages never get a /ve prefix (see ResolvedCategory's comment) — only
// role pages do, since two countries' role pages would otherwise be
// indistinguishable URLs serving different (and previously silently mixed)
// data.
export function buildCategoryPath(category: { kind: CategoryKind; label: string; country: string }): string {
  const prefix = category.kind === "rol" && category.country === "VE" ? "/ve" : "";
  return `${prefix}/empleos/${slugify(category.label)}`;
}

export function buildCategoryUrl(category: { kind: CategoryKind; label: string; country: string }): string {
  return `${SITE_URL}${buildCategoryPath(category)}`;
}

// Company page (dashboard navigation, not an SEO-driven fase like the
// category pages above — see the "empresas" feature note in
// docs/COMPANY-REPUTATION-PLAN.md). Same flat single-slug shape; the
// company name (never an id) is what resolveCompanyBySlug() in
// company-reputation-repository.ts matches back against, mirroring
// resolveCategorySlug()'s pattern.
//
// `country` (optional, defaults to no prefix = Colombia) picks /ve/empresas
// vs /empresas — unlike buildJobPath, this one DOES vary by country: the
// company *directory/listing* is meant to stay fully separated per country
// (server.ts's /api/companies/search and /api/companies/:slug now filter by
// country too), so its URLs need to be distinguishable the same way
// /dashboard vs /ve/dashboard are. Callers (JobCard/JobDetailPanel) pass the
// dashboard context's country, not job.country, so a remote job shown on
// /ve/dashboard still links to /ve/empresas/... — see those components' own
// comments.
export function buildCompanyPath(companyName: string, country?: string | null): string {
  const prefix = country === "VE" ? "/ve" : "";
  return `${prefix}/empresas/${slugify(companyName)}`;
}

export function buildCompanyUrl(companyName: string, country?: string | null): string {
  return `${SITE_URL}${buildCompanyPath(companyName, country)}`;
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

export interface CompanyMeta {
  title: string;
  heading: string;
  description: string;
  canonicalUrl: string;
}

// totalCount is always the real, already-country/job-corpus-filtered match
// count — same "never claim more/fewer than truly exist right now" rule as
// buildCategoryMeta above.
export function buildCompanyMeta(
  companyName: string,
  totalCount: number,
  country?: string | null
): CompanyMeta {
  const countryName = getCountryConfig(country || DEFAULT_COUNTRY).name;
  const countLabel = totalCount === 1 ? "1 vacante activa" : `${totalCount} vacantes activas`;
  return {
    title: `${companyName} | BuscoTrabajo`,
    heading: companyName,
    description: `${companyName}: ${countLabel} en BuscoTrabajo — reputación y reseñas reales en ${countryName}.`,
    canonicalUrl: buildCompanyUrl(companyName, country)
  };
}

// Minimal shape (not the full ReputationEntry from
// company-reputation-repository.ts, a server/DB-only module this
// client-shared file never imports from) — only the field this actually
// needs: a real, verifiable profile URL for that source's page on this
// company, safe to cite as `sameAs`.
export interface CompanyReputationSourceRef {
  sourceUrl: string;
}

// Organization schema for a company page — deliberately NOT
// AggregateRating: Merco/GPTW/Computrabajo each score on their own
// `scoreScale` (see ReputationEntry), so averaging them into one number
// would state a fact that doesn't exist. `sameAs` only cites real,
// already-fetched source URLs — never invented.
export function buildCompanyOrganizationSchema(
  companyName: string,
  meta: CompanyMeta,
  reputation: CompanyReputationSourceRef[]
): object {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: companyName,
    url: meta.canonicalUrl
  };
  const sameAs = reputation.map((r) => r.sourceUrl).filter(Boolean);
  if (sameAs.length > 0) schema.sameAs = sameAs;
  return schema;
}

// ItemList for the /empresas directory hub, same pattern as
// buildCategoryItemList — each entry a real company already rendered in
// the page's visible list, nothing added beyond what's on the page.
export function buildCompaniesItemList(
  heading: string,
  companies: { company: string }[],
  country?: string | null
): object {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: heading,
    itemListElement: companies.map((c, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: c.company,
      url: buildCompanyUrl(c.company, country)
    }))
  };
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
export function buildCategoryMeta(category: ResolvedCategory, totalCount: number): CategoryMeta {
  const { kind, label, country } = category;
  const countLabel = totalCount === 1 ? "1 vacante" : `${totalCount} vacantes`;
  // City headings stay country-neutral text ("Vacantes de empleo en
  // Caracas") — the city name alone already says which country, no need to
  // spell it out twice. Role headings DO need the country spelled out
  // ("... en Venezuela") since the same role label now backs two different
  // pages (see ResolvedCategory's comment) — this is also what stops a
  // Venezuela role page claiming "en Colombia" while actually listing
  // Venezuela jobs, a real mismatch that existed before this country field.
  const countryName = getCountryConfig(country).name;
  const heading =
    kind === "ciudad" ? `Vacantes de empleo en ${label}` : `Vacantes de ${label} en ${countryName}`;
  // Elempleo/Magneto/Workana have no Venezuela adapter yet (see
  // SourcesAndProblem.tsx's SOURCES_BY_COUNTRY) — naming them here for a
  // Venezuela role page would overclaim sources that never actually
  // contributed to it.
  const sourcesPhrase =
    country === "VE" ? "LinkedIn, Computrabajo y otros portales" : "LinkedIn, Computrabajo, Elempleo y otros portales";
  return {
    title: `${heading} — ${countLabel} | BuscoTrabajo`,
    heading,
    description: `${countLabel} ${kind === "ciudad" ? `en ${label}` : `de ${label} en ${countryName}`} agregadas de ${sourcesPhrase} — actualizadas en BuscoTrabajo.`,
    canonicalUrl: buildCategoryUrl(category)
  };
}

// BreadcrumbList for a category page (SEO Fase 6 — seo-technical/§1.7 flagged
// category pages as carrying no listing schema of their own, only the
// generic Organization+WebSite from the static shell). Only two real levels
// exist to link — there is no bare `/empleos` hub page, so inventing a
// middle breadcrumb node pointing at a URL that doesn't resolve would be
// exactly the kind of fabricated navigation AGENTS.md #5 rules out.
export function buildCategoryBreadcrumbList(meta: CategoryMeta): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: meta.heading, item: meta.canonicalUrl }
    ]
  };
}

// ItemList for a category page's own listing of job links — each entry is
// a plain ListItem pointing at a job detail page that carries its own full
// JobPosting markup; this does not duplicate/replace that (Google's
// guidance against markup for job-listing *previews* is about repeating
// JobPosting fields per row, not about a plain ItemList of links). Every
// field here (title, url) is the same real job data already rendered in
// the page's visible <nav>/<ul> — nothing invented, nothing beyond what
// `page` (the same capped slice server.ts renders) already contains.
export function buildCategoryItemList(meta: CategoryMeta, jobs: SeoJob[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: meta.heading,
    itemListElement: jobs.map((job, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: job.title,
      url: buildJobUrl(job)
    }))
  };
}

// One flat sitemap covers all categories comfortably (CO+VE cities + two
// countries' worth of DEFAULT_ROLES_200 — well under the 50k/file limit
// buildJobsSitemapXml's comment already covers), no lastmod: unlike a job
// posting, a category page has no single "last changed" timestamp that
// isn't already implicit in how often the sitemap itself gets re-crawled.
// Role labels appear twice (once per country, at their two distinct URLs —
// see ResolvedCategory's comment); city labels appear once each, since a
// city page never has a /ve-prefixed alias.
export function buildCategoriesSitemapXml(): string {
  const veCities = getCountryConfig("VE").cities;
  const categories: ResolvedCategory[] = [
    ...CITY_OPTIONS.map((label) => ({ kind: "ciudad" as const, label, country: "CO" })),
    ...veCities.map((label) => ({ kind: "ciudad" as const, label, country: "VE" })),
    ...DEFAULT_ROLES_200.map((label) => ({ kind: "rol" as const, label, country: "CO" })),
    ...DEFAULT_ROLES_200.map((label) => ({ kind: "rol" as const, label, country: "VE" }))
  ];
  const urls = categories.map((category) => xmlUrlEntry(buildCategoryUrl(category))).join("\n");
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
