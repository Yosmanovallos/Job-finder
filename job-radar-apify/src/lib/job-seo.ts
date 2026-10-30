import type { Job } from "../sources/types.js";
import { getModalityLabel, roleTitleMatcher, CITY_OPTIONS } from "./job-filters.js";
import { DEFAULT_ROLES_200 } from "../queue/scheduler.js";
import { getCountryConfig, DEFAULT_COUNTRY } from "../countries/index.js";
import { isGoogleReadyNow, resolveGoogleLocation } from "./google-job-readiness.js";
import { countryNameFor } from "./country-codes.js";
import { isPlaceholderEmployer } from "./company-key.js";

export const SITE_URL = "https://buscotrabajo.co";
// Job SEO V2 (docs/JOBPOSTING-GOOGLE-CONTRACT.md): there is deliberately no
// "listing age" constant any more. JobPosting.validThrough used to be
// published_at + 30 days, which is a retention window, not the employer's
// expiration — it put an already-past date on ~14,500 live pages
// (docs/SEARCH-CONSOLE-BASELINE-2026-09.md). Only a source-stated
// expiration is emitted now; expiry is otherwise signaled by 410 + URL_DELETED.

export type SeoJob = Job & {
  reputation?: { source: string; score: number | null; scoreScale: string; reviewCount: number | null; sourceUrl: string }[];
  isLocked?: boolean;
  alsoIn?: string[];
  sources?: string[];
  role_origin?: string;
  /** Stored verdict of the shared Google gate (jobs.seo_ready). */
  seoReady?: boolean;
  isActive?: boolean;
  contentUpdatedAt?: string | Date | null;
  /** Visible location from buildJobLocationLabel (job page payload only). */
  locationLabel?: string;
};

export interface SitemapJobInput {
  jobId: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string | null;
  publishedAt?: string | Date;
}

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
export function buildJobSlug(job: Pick<SitemapJobInput, "title" | "location">): string {
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
export function buildJobPath(job: Pick<SitemapJobInput, "jobId" | "title" | "location">): string {
  return `/empleos/${job.jobId}/${buildJobSlug(job)}`;
}

export function buildJobUrl(job: Pick<SitemapJobInput, "jobId" | "title" | "location">): string {
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
export function isPubliclyDescribable(
  job: Pick<SitemapJobInput, "company" | "location" | "url">
): boolean {
  return Boolean(job.company && job.location && job.url);
}

// --- One content model, two outputs (Job SEO V2) -----------------------------
//
// renderJobDescriptionHtml() is the ONLY producer of the job description HTML.
// The same string is placed in the visible server-rendered body and in
// JobPosting.description, so structured data can never say something the
// page doesn't. Inputs are the normalized, tag-free storage fields; every
// string is escaped and the only tags ever emitted are <p>, <ul>, <li> — no
// source HTML is ever echoed, so there is nothing for a hostile source to inject.

export function renderJobDescriptionHtml(job: Pick<Job, "description" | "requirements">): string {
  const paragraphs = (job.description || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`);
  const items = (job.requirements || [])
    .map((item) => (item || "").trim())
    .filter(Boolean)
    .map((item) => `<li>${escapeHtml(item)}</li>`);
  return [...paragraphs, ...(items.length > 0 ? [`<ul>${items.join("")}</ul>`] : [])].join("");
}

/** True when this job may appear in Google's corpus: user-visible AND the shared gate passed. */
export function isGoogleEligiblePage(job: SeoJob): boolean {
  return isPubliclyDescribable(job) && isGoogleReadyNow(job);
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatPublishedDate(value: string | Date | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Bogota"
  });
}

function remoteLabel(job: SeoJob): string | null {
  if (job.remoteType === "fully_remote") return "Remoto (100%)";
  if (job.remoteType === "hybrid") return "Híbrido";
  return getModalityLabel(job.location);
}

/**
 * Server-rendered body of a job page. Readable without login or JavaScript,
 * with the original source link in the raw HTML (never only after hydration).
 * Rendered for every user-visible job, Google-ready or not — readiness only
 * decides robots/JobPosting, never what a visitor can read or where they apply.
 */
/**
 * The visible location of a job page. Rule E parity: a department added to
 * JobPosting from the DIVIPOLA table (ADR 0009) is shown too, from the same
 * resolved location — in the SSR body and, via the payload, after hydration.
 */
export function buildJobLocationLabel(job: SeoJob): string {
  if (!job.location) return getCountryConfig(job.country).name;
  const { location: resolved } = resolveGoogleLocation(job);
  if (resolved?.kind !== "physical" || !resolved.region || job.location.includes(resolved.region)) return job.location;
  // The department goes right after the city, before any country the source
  // wrote: "Medellín, Colombia" -> "Medellín, Antioquia, Colombia".
  // "Bogotá" + "Bogotá, D.C." reads as just "Bogotá, D.C.".
  const { locality, region } = resolved;
  const at = job.location.indexOf(locality);
  if (at < 0) return `${job.location}, ${region}`;
  const replacement = region.startsWith(locality) ? region : `${locality}, ${region}`;
  return job.location.slice(0, at) + replacement + job.location.slice(at + locality.length);
}

export function buildJobPageBody(job: SeoJob): string {
  const facts: string[] = [];
  if (job.company) facts.push(`<li>Empresa: ${escapeHtml(job.company)}</li>`);
  facts.push(`<li>Ubicación: ${escapeHtml(buildJobLocationLabel(job))}</li>`);
  const modality = remoteLabel(job);
  if (modality) facts.push(`<li>Modalidad: ${escapeHtml(modality)}</li>`);
  const eligible = (job.remoteType === "fully_remote" ? job.applicantCountries || [] : [])
    .map((code) => countryNameFor(code) || code)
    .filter(Boolean);
  if (eligible.length > 0)
    facts.push(`<li>Candidatos desde: ${escapeHtml(eligible.join(", "))}</li>`);
  const published = formatPublishedDate(job.publishedAt);
  if (published) facts.push(`<li>Publicada: ${escapeHtml(published)}</li>`);
  if (job.employmentType) facts.push(`<li>Tipo de empleo: ${escapeHtml(job.employmentType)}</li>`);
  if (job.salary) facts.push(`<li>Salario: ${escapeHtml(String(job.salary))}</li>`);
  facts.push(`<li>Fuente: ${escapeHtml(job.source)}</li>`);

  const description = renderJobDescriptionHtml(job);
  const descriptionBlock = description
    ? `<section data-job-description><h2>Descripción de la vacante</h2>${description}</section>`
    : `<p>La fuente original no publicó una descripción que podamos mostrar. Consulta el detalle completo en ${escapeHtml(job.source)}.</p>`;
  // Only a real http(s) URL becomes a link — never javascript:/data: etc.,
  // even if something upstream let one through.
  const apply = safeHttpUrl(job.url)
    ? `<p><a data-apply-link href="${escapeHtml(safeHttpUrl(job.url)!)}" target="_blank" rel="nofollow noopener noreferrer">Ver la oferta original y aplicar en ${escapeHtml(job.source)}</a></p>`
    : "";

  return `<article><h1>${escapeHtml(job.title)}</h1>\n<ul>${facts.join("")}</ul>\n${apply}\n${descriptionBlock}\n${apply}</article>`;
}

/** Public fields only. Never serialize an entire repository/session object. */
export function buildJobPagePayload(job: SeoJob): { job: SeoJob } {
  return { job: {
    jobId: job.jobId, title: job.title, company: job.company,
    location: job.location, locationLabel: buildJobLocationLabel(job),
    url: job.url, dateText: job.dateText, source: job.source,
    publishedAt: job.publishedAt, country: job.country,
    description: job.description, requirements: job.requirements,
    technologies: job.technologies, employmentType: job.employmentType,
    salary: job.salary, salaryMin: job.salaryMin, salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency, salaryRaw: job.salaryRaw,
    applicantCount: job.applicantCount, remoteType: job.remoteType,
    applicantCountries: job.applicantCountries, validThrough: job.validThrough,
    isLocked: job.isLocked, sources: job.sources, alsoIn: job.alsoIn,
    reputation: job.reputation?.map(({ source, score, scoreScale, reviewCount, sourceUrl }) => ({
      source, score, scoreScale, reviewCount, sourceUrl
    }))
  } };
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
    // An official vacancy comes from the company's own careers portal (ADR
    // 0006 §10), not from a job board: said as such, never as "agregada de".
    description:
      job.source === "Portal oficial"
        ? `${job.title} en ${company}, ${location}. Vacante del portal oficial de empleo de ${company}, en BuscoTrabajo — vacantes de empleo en ${countryName}.`
        : `${job.title} en ${company}, ${location}. Vacante agregada de ${job.source} en BuscoTrabajo — vacantes de empleo en ${countryName}.`,
    canonicalUrl: buildJobUrl(job)
  };
}

// Reverse of job-posting-jsonld.ts's SCHEMA_EMPLOYMENT_TYPE_LABELS (Spanish
// display label -> schema.org's own enum token). Labels with no schema.org
// equivalent (Workana "Proyecto"/"Por hora") map to nothing and are omitted —
// never guessed, never inferred from the title.
const EMPLOYMENT_TYPE_LABEL_TO_SCHEMA: Record<string, string> = {
  "Tiempo completo": "FULL_TIME",
  "Medio tiempo": "PART_TIME",
  Contrato: "CONTRACTOR",
  Temporal: "TEMPORARY",
  Prácticas: "INTERN",
  Voluntariado: "VOLUNTEER",
  "Por día": "PER_DIEM"
};

/**
 * Exactly one JobPosting for one Google-ready job page, or null. Every field
 * is a source-stated fact that the visible body (buildJobPageBody) also shows:
 *  - title verbatim from the source; description = renderJobDescriptionHtml();
 *  - TELECOMMUTE only with source evidence of 100% remote AND source-stated
 *    eligible countries (Google requires one); otherwise a physical address
 *    split from the source's location text — never a guessed country;
 *  - validThrough only when the source published an expiration;
 *  - no baseSalary (Google: "only employers can provide baseSalary"), no
 *    directApply (applications happen at the source), no identifier (we don't
 *    hold the employer's own id), no skills/qualifications split from lists.
 */
export function buildJobPosting(job: SeoJob): Record<string, unknown> | null {
  if (!isGoogleEligiblePage(job)) return null;
  const { location } = resolveGoogleLocation(job);
  if (!location || !job.publishedAt || !job.company) return null;

  const posting: Record<string, unknown> = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: renderJobDescriptionHtml(job),
    datePosted: new Date(job.publishedAt).toISOString(),
    hiringOrganization: {
      "@type": "Organization",
      name: job.company
    }
  };

  const employmentTypeToken = job.employmentType
    ? EMPLOYMENT_TYPE_LABEL_TO_SCHEMA[job.employmentType]
    : undefined;
  if (employmentTypeToken) posting.employmentType = employmentTypeToken;

  if (job.validThrough) posting.validThrough = new Date(job.validThrough).toISOString();

  if (location.kind === "remote") {
    posting.jobLocationType = "TELECOMMUTE";
    posting.applicantLocationRequirements = location.countries.map((code) => ({
      "@type": "Country",
      name: countryNameFor(code) || code
    }));
  } else {
    const address: Record<string, string> = {
      "@type": "PostalAddress",
      addressLocality: location.locality,
      addressCountry: location.country
    };
    if (location.region) address.addressRegion = location.region;
    posting.jobLocation = { "@type": "Place", address };
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
export function buildCategoryPath(category: {
  kind: CategoryKind;
  label: string;
  country: string;
}): string {
  const prefix = category.kind === "rol" && category.country === "VE" ? "/ve" : "";
  return `${prefix}/empleos/${slugify(category.label)}`;
}

export function buildCategoryUrl(category: {
  kind: CategoryKind;
  label: string;
  country: string;
}): string {
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
export function resolveCompanyNameFromJobs(
  slug: string,
  jobs: Array<Pick<Job, "company">>
): string | null {
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
  // "Empleos en <empresa>" is the query shape autocomplete shows people
  // actually type ("empleos bancolombia", 2026-10-25); the count stays out
  // of the title (it changes daily) and lives in the description.
  return {
    title: `Empleos en ${companyName} | BuscoTrabajo`,
    heading: companyName,
    description: `Empleos en ${companyName}: ${countLabel} en ${countryName}. Compara sus ofertas y su reputación, y postúlate en el portal original.`,
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

export interface CategoryInsights {
  /** Number of real jobs included in the rendered sample (currently capped at 60). */
  visibleCount: number;
  /** Counts below always describe the rendered sample, never the uncapped total. */
  companyCount: number;
  topCompanies: string[];
  sources: string[];
  modalities: Array<{ label: string; count: number }>;
  freshLast7Days: number;
  /**
   * True when every row of a capped sample is under 7 days old: the sample is
   * the newest rows, so the real 7-day count is at least freshLast7Days but
   * may be higher. Render it as "60+", never as an exact 60.
   */
  freshLast7DaysIsLowerBound: boolean;
  /** freshLast7Days as display text ("12" or "60+"). */
  freshLast7DaysLabel: string;
  /**
   * Every live job is at most MAX_JOB_AGE_DAYS (30) old (liveJobSql), so the
   * uncapped total IS the number of active jobs published in the last 30 days.
   */
  activeLast30Days: number;
  /** Top employers of the sample with their real counts (placeholders excluded). */
  companyRanking: Array<{ label: string; count: number }>;
  /**
   * City hubs only: catalog roles (DEFAULT_ROLES_200) matched by at least two
   * sample titles, with the same matcher the role page's SQL uses, linked to
   * that role's page in the city's country.
   */
  topRoles: Array<{ label: string; count: number; href: string }>;
  /**
   * Range of the salaries the sources published as numbers with a currency,
   * in the most common currency only; null below SALARY_RANGE_MIN_JOBS.
   * Free-text salaries are never parsed.
   */
  salaryRange: { currency: string; min: number; max: number; jobCount: number } | null;
  latestPublishedLabel: string | null;
  intro: string;
}

const SALARY_RANGE_MIN_JOBS = 3;
const TOP_ROLES_LIMIT = 5;

export interface CategoryInternalLink {
  href: string;
  label: string;
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
  // City wording mirrors the query variants Search Console actually shows
  // for these pages ("empleos <ciudad>", "trabajo en <ciudad>", "ofertas de
  // empleo en <ciudad>" — docs/seo-baseline/2026-10-24-measurement-baseline.md).
  // "Remoto" lives in CITY_OPTIONS as a modality bucket, not a place
  // ("trabajos remotos" is its own query in Search Console).
  const heading = isRemoteBucket(category)
    ? `Trabajos remotos en ${countryName}: empleos y ofertas de empleo`
    : kind === "ciudad"
      ? `Empleos en ${label}: trabajo y ofertas de empleo`
      : `Trabajo de ${label} en ${countryName}`;
  const target = isRemoteBucket(category)
    ? `trabajo remoto en ${countryName}`
    : kind === "ciudad"
      ? `trabajo en ${label}`
      : `${label} en ${countryName}`;
  return {
    // Keep the query wording stable even when the live count changes. The
    // exact count remains in the description and visible body, where it is
    // useful without forcing Google to relearn a new title every scrape.
    title: `${heading} | BuscoTrabajo`,
    heading,
    // City descriptions open with the "busco trabajo en <ciudad>" intent and
    // keep "vacantes y ofertas de empleo" next to the live count; they stay
    // under ~160 characters for the longest city name.
    description:
      kind === "ciudad" && !isRemoteBucket(category)
        ? `¿Buscas trabajo en ${label}? ${totalCount === 1 ? "1 vacante activa" : `${countLabel} y ofertas de empleo activas`}. Compara las empresas y cargos que más contratan y aplica en la fuente original.`
        : `Encuentra ${countLabel} de ${target}. Compara ofertas de empleo actuales y visita la fuente original para aplicar.`,
    canonicalUrl: buildCategoryUrl(category)
  };
}

function incrementCount(
  map: Map<string, { label: string; count: number }>,
  rawLabel: string
): void {
  const label = rawLabel.trim();
  if (!label) return;
  const key = label.toLocaleLowerCase("es");
  const current = map.get(key);
  if (current) current.count += 1;
  else map.set(key, { label, count: 1 });
}

function ranked(
  map: Map<string, { label: string; count: number }>,
  limit: number
): Array<{ label: string; count: number }> {
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"))
    .slice(0, limit)
    .map((entry) => ({ ...entry }));
}

function rankedLabels(map: Map<string, { label: string; count: number }>, limit: number): string[] {
  return ranked(map, limit).map((entry) => entry.label);
}

function positiveNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Same rules as buildSalaryLabel(): a number only counts with a published
// currency, and 0 is the "not specified" sentinel, never a real bound.
function buildSalaryRange(jobs: SeoJob[]): CategoryInsights["salaryRange"] {
  const byCurrency = new Map<string, { min: number; max: number; jobCount: number }>();
  for (const job of jobs) {
    const currency = typeof job.salaryCurrency === "string" ? job.salaryCurrency.trim().toUpperCase() : "";
    if (!currency) continue;
    const min = positiveNumber(job.salaryMin);
    const max = positiveNumber(job.salaryMax);
    const low = min ?? max;
    const high = max ?? min;
    if (low === null || high === null) continue;
    const current = byCurrency.get(currency);
    if (current) {
      current.min = Math.min(current.min, low, high);
      current.max = Math.max(current.max, low, high);
      current.jobCount += 1;
    } else {
      byCurrency.set(currency, { min: Math.min(low, high), max: Math.max(low, high), jobCount: 1 });
    }
  }
  const [best] = [...byCurrency.entries()].sort(
    ([a, x], [b, y]) => y.jobCount - x.jobCount || a.localeCompare(b)
  );
  if (!best || best[1].jobCount < SALARY_RANGE_MIN_JOBS) return null;
  return { currency: best[0], ...best[1] };
}

/** "COP 1.500.000" — the range's own currency code, never a converted value. */
export function formatSalaryAmount(currency: string, amount: number): string {
  return `${currency} ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(amount)}`;
}

// One match plan per catalog role, built on first use and shared by every
// hub render, so a 60-row page costs 200 x 60 regex tests and nothing more.
let roleMatchers: Array<{ role: string; matches: (title: string | null | undefined) => boolean }> | null = null;

function buildTopRoles(category: ResolvedCategory, jobs: SeoJob[]): CategoryInsights["topRoles"] {
  if (category.kind !== "ciudad" || jobs.length === 0) return [];
  roleMatchers ??= DEFAULT_ROLES_200.map((role) => ({ role, matches: roleTitleMatcher(role) }));
  const counts: Array<{ label: string; count: number }> = [];
  for (const { role, matches } of roleMatchers) {
    let count = 0;
    for (const job of jobs) if (matches(job.title)) count += 1;
    if (count >= 2) counts.push({ label: role, count });
  }
  return counts
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"))
    .slice(0, TOP_ROLES_LIMIT)
    .map((entry) => ({
      ...entry,
      href: buildCategoryPath({ kind: "rol", label: entry.label, country: category.country })
    }));
}

/**
 * Builds useful category-page facts exclusively from the jobs actually
 * rendered on that page. This intentionally does not extrapolate the 60-row
 * sample to the uncapped total: labels in the UI say "muestra visible" so a
 * visitor and crawler can tell exactly what each number represents.
 */
export function buildCategoryInsights(
  category: ResolvedCategory,
  totalCount: number,
  jobs: SeoJob[],
  asOf: Date = new Date()
): CategoryInsights {
  const companies = new Map<string, { label: string; count: number }>();
  const sources = new Map<string, { label: string; count: number }>();
  const modalityCounts = new Map<string, number>();
  const asOfMs = Number.isFinite(asOf.getTime()) ? asOf.getTime() : Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  let freshLast7Days = 0;
  let latestPublishedMs: number | null = null;

  for (const job of jobs) {
    // An undisclosed employer is not one more company in the sample.
    if (job.company && !isPlaceholderEmployer(job.company)) incrementCount(companies, job.company);
    const jobSources =
      Array.isArray(job.sources) && job.sources.length > 0 ? job.sources : [job.source];
    for (const source of jobSources) if (source) incrementCount(sources, source);

    const modality =
      job.remoteType === "fully_remote"
        ? "Remoto"
        : job.remoteType === "hybrid"
          ? "Híbrido"
          : job.remoteType === "onsite"
            ? "Presencial"
            : getModalityLabel(job.location) || "Sin especificar";
    modalityCounts.set(modality, (modalityCounts.get(modality) || 0) + 1);

    if (job.publishedAt) {
      const publishedMs = new Date(job.publishedAt).getTime();
      if (Number.isFinite(publishedMs) && publishedMs <= asOfMs) {
        if (asOfMs - publishedMs <= sevenDaysMs) freshLast7Days += 1;
        latestPublishedMs =
          latestPublishedMs === null ? publishedMs : Math.max(latestPublishedMs, publishedMs);
      }
    }
  }

  const visibleCount = jobs.length;
  const countLabel = totalCount === 1 ? "1 vacante activa" : `${totalCount} vacantes activas`;
  const target = isRemoteBucket(category)
    ? `trabajo remoto en ${getCountryConfig(category.country).name}`
    : category.kind === "ciudad"
      ? `trabajo en ${category.label}`
      : `${category.label} en ${getCountryConfig(category.country).name}`;
  const sampleLabel =
    visibleCount < totalCount
      ? `las ${visibleCount} ofertas más recientes que aparecen en esta página`
      : visibleCount === 1
        ? "la oferta visible en esta página"
        : `las ${visibleCount} ofertas visibles en esta página`;
  const intro =
    visibleCount > 0
      ? `Encuentra ${countLabel} de ${target}. Compara ${sampleLabel}; las cifras de empresas, fuentes, modalidades y frescura se calculan únicamente con esas ofertas.`
      : `Todavía no hay vacantes activas de ${target}. Vuelve pronto o explora todas las ofertas disponibles.`;

  const modalityOrder = ["Remoto", "Híbrido", "Presencial", "Sin especificar"];
  const modalities = [...modalityCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => modalityOrder.indexOf(a.label) - modalityOrder.indexOf(b.label));
  const latestPublishedLabel =
    latestPublishedMs === null
      ? null
      : new Date(latestPublishedMs).toLocaleDateString("es-CO", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "America/Bogota"
        });

  // The sample is the newest rows (published_at DESC, no preferred roles on
  // hub pages), so an all-fresh capped sample only proves a lower bound.
  const freshLast7DaysIsLowerBound =
    visibleCount > 0 && visibleCount < totalCount && freshLast7Days === visibleCount;

  return {
    visibleCount,
    companyCount: companies.size,
    topCompanies: rankedLabels(companies, 5),
    sources: rankedLabels(sources, 8),
    modalities,
    freshLast7Days,
    freshLast7DaysIsLowerBound,
    freshLast7DaysLabel: freshLast7DaysIsLowerBound ? `${freshLast7Days}+` : String(freshLast7Days),
    activeLast30Days: totalCount,
    companyRanking: ranked(companies, 5),
    topRoles: buildTopRoles(category, jobs),
    salaryRange: buildSalaryRange(jobs),
    latestPublishedLabel,
    intro
  };
}

export interface CategoryStatsCopy {
  heading: string;
  summary: string;
  basis: string;
  companiesHeading: string;
  companies: string[];
  rolesHeading: string;
  roles: Array<{ href: string; label: string }>;
  salary: string | null;
}

/**
 * Text of the "cifras" section, shared by SSR and the hydrated page so both
 * render the same words. Null when the page has no jobs to describe.
 */
export function buildCategoryStatsCopy(
  category: ResolvedCategory,
  insights: CategoryInsights
): CategoryStatsCopy | null {
  if (insights.visibleCount === 0) return null;
  const countryName = getCountryConfig(category.country).name;
  const place = isRemoteBucket(category)
    ? `Trabajos remotos en ${countryName}`
    : category.kind === "ciudad"
      ? `Trabajos en ${category.label}`
      : `${category.label} en ${countryName}`;
  const active = insights.activeLast30Days;
  const fresh = insights.freshLast7DaysIsLowerBound
    ? `al menos ${insights.freshLast7Days}`
    : String(insights.freshLast7Days);
  const visible = insights.visibleCount;
  const salary = insights.salaryRange
    ? `Salario publicado por la fuente en ${insights.salaryRange.jobCount} de ${visible === 1 ? "la oferta" : `las ${visible} ofertas`} de la muestra: ${
        insights.salaryRange.min === insights.salaryRange.max
          ? formatSalaryAmount(insights.salaryRange.currency, insights.salaryRange.min)
          : `entre ${formatSalaryAmount(insights.salaryRange.currency, insights.salaryRange.min)} y ${formatSalaryAmount(insights.salaryRange.currency, insights.salaryRange.max)}`
      }.`
    : null;
  return {
    heading: `${place}: cifras de las ofertas activas`,
    summary: `${active === 1 ? "1 vacante activa publicada" : `${active} vacantes activas publicadas`} en los últimos 30 días; ${fresh} ${insights.freshLast7Days === 1 && !insights.freshLast7DaysIsLowerBound ? "es de" : "son de"} los últimos 7 días.`,
    basis:
      visible < active
        ? `Empresas, cargos y salarios se calculan con las ${visible} ofertas más recientes de esta página.`
        : "Empresas, cargos y salarios se calculan con todas las ofertas de esta página.",
    companiesHeading: "Empresas que más contratan",
    companies: insights.companyRanking.map(
      (item) => `${item.label}: ${item.count === 1 ? "1 oferta" : `${item.count} ofertas`}`
    ),
    rolesHeading: category.kind === "ciudad" && !isRemoteBucket(category)
      ? `Cargos más pedidos en ${category.label}`
      : "Cargos más pedidos",
    roles: insights.topRoles.map((role) => ({
      href: role.href,
      label: `${role.label} (${role.count})`
    })),
    salary
  };
}

/** Stable, crawlable links shared by SSR and the hydrated category page. */
export function buildCategoryInternalLinks(category: ResolvedCategory): CategoryInternalLink[] {
  const prefix = category.country === "VE" ? "/ve" : "";
  const countryName = getCountryConfig(category.country).name;
  return [
    { href: `${prefix}/dashboard`, label: `Todas las vacantes en ${countryName}` },
    { href: `${prefix}/empresas`, label: `Empresas con vacantes en ${countryName}` },
    { href: prefix || "/", label: `Inicio de BuscoTrabajo ${countryName}` }
  ];
}

function isRemoteBucket(category: ResolvedCategory): boolean {
  return category.kind === "ciudad" && category.label === "Remoto";
}

/**
 * City hub cross-links: every other city page of the same country, from the
 * same static taxonomy resolveCategorySlug()/sitemap-categories.xml use, so
 * each link resolves to a real category page. Role pages get none.
 */
export function buildRelatedCityLinks(category: ResolvedCategory): CategoryInternalLink[] {
  if (category.kind !== "ciudad") return [];
  const self = slugify(category.label);
  // Same lists resolveCategorySlug() matches against, so every href is a
  // real city page. "Remoto" is a modality bucket, not another city.
  const cities =
    category.country === "VE"
      ? getCountryConfig("VE").cities
      : CITY_OPTIONS.filter((city) => city !== "Remoto");
  return cities
    .filter((city) => slugify(city) !== self)
    .map((city) => ({
      href: buildCategoryPath({ kind: "ciudad", label: city, country: category.country }),
      label: `Empleos en ${city}`
    }));
}

/** Section headings shared by SSR and the hydrated category page. */
export function buildCategorySectionHeadings(category: ResolvedCategory): {
  jobs: string;
  relatedCities: string;
} {
  const countryName = getCountryConfig(category.country).name;
  if (isRemoteBucket(category)) {
    return {
      jobs: `Vacantes remotas recientes en ${countryName}`,
      relatedCities: `Empleos por ciudad en ${countryName}`
    };
  }
  return {
    jobs:
      category.kind === "ciudad"
        ? `Vacantes recientes en ${category.label}`
        : `Vacantes recientes de ${category.label}`,
    relatedCities: `Empleos en otras ciudades de ${countryName}`
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

export const JOBS_SITEMAP_HEADER =
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
export const JOBS_SITEMAP_FOOTER = "\n</urlset>\n";

/**
 * Callers pass rows already filtered by the shared Google gate (the sitemap
 * SQL applies seoReadySql). <lastmod> is the real content-change time, and is
 * OMITTED when unknown (legacy rows) — never the regeneration time, never a
 * stand-in like published_at.
 */
export function buildJobSitemapEntry(
  job: SitemapJobInput & { contentUpdatedAt?: string | Date | null }
): string | null {
  if (!isPubliclyDescribable(job)) return null;
  return xmlUrlEntry(
    buildJobUrl(job),
    job.contentUpdatedAt ? new Date(job.contentUpdatedAt).toISOString() : undefined
  );
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
    .filter((job) => isGoogleReadyNow(job))
    .map(buildJobSitemapEntry)
    .filter((entry): entry is string => entry !== null)
    .join("\n");
  return `${JOBS_SITEMAP_HEADER}${urls}${JOBS_SITEMAP_FOOTER}`;
}

export function buildSitemapIndexXml(sitemapUrls: string[]): string {
  const entries = sitemapUrls
    .map((loc) => `  <sitemap>\n    <loc>${escapeHtml(loc)}</loc>\n  </sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
}
