/**
 * /empleos and /ve/empleos (seo-empleos-coverage, ADR 0014): the national
 * index page. It lists the country's real total, its most recent jobs and
 * links to every hub that exists (city, guarded city, intent, role).
 *
 * Pure and client-safe: server.ts (raw HTML) and EmpleosIndex.tsx (DOM)
 * build the same meta, sections and links from these functions. No number
 * is ever shown that the caller did not pass in.
 */
import { DEFAULT_ROLES_200 } from "../queue/scheduler.js";
import { getCountryConfig, SOURCES_BY_COUNTRY } from "../countries/index.js";
import { CITY_OPTIONS } from "./job-filters.js";
import { intentLinkLabel, isIntentIndexable, listIntentCategories } from "./intent-pages.js";
import {
  SITE_URL,
  buildCategoryPath,
  buildJobPath,
  buildJobUrl,
  escapeHtml,
  listGuardedCityHubs,
  type ResolvedCategory,
  type SeoJob
} from "./job-seo.js";

export type EmpleosIndexCountry = "CO" | "VE";

/** Jobs listed on the page: the dashboard's first page, already cached. */
export const EMPLEOS_INDEX_JOB_LIMIT = 24;

export interface EmpleosIndexLink {
  href: string;
  label: string;
}

export interface EmpleosIndexJob {
  path: string;
  url: string;
  title: string;
  company: string;
  location: string;
}

export interface EmpleosIndexMeta {
  title: string;
  heading: string;
  description: string;
  path: string;
  canonicalUrl: string;
}

export interface EmpleosIndexSections {
  cities: EmpleosIndexLink[];
  intents: EmpleosIndexLink[];
  roles: EmpleosIndexLink[];
  more: EmpleosIndexLink[];
}

/** What the server embeds for the client (window.__SSR_EMPLEOS__). */
export interface EmpleosIndexPayload {
  country: EmpleosIndexCountry;
  /** Null when the count could not be read: no number is shown. */
  total: number | null;
  jobs: EmpleosIndexJob[];
  sections: EmpleosIndexSections;
}

export function empleosIndexPath(country: EmpleosIndexCountry): string {
  return country === "VE" ? "/ve/empleos" : "/empleos";
}

/** "/empleos" → CO, "/ve/empleos" → VE, anything else → null. */
export function empleosIndexCountryForPath(pathname: string): EmpleosIndexCountry | null {
  if (pathname === "/empleos") return "CO";
  if (pathname === "/ve/empleos") return "VE";
  return null;
}

function formatCount(total: number): string {
  // Plain grouping with dots, as the rest of the site writes numbers; no
  // Intl object per request.
  return String(Math.trunc(total)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function buildEmpleosIndexMeta(country: EmpleosIndexCountry, total: number | null): EmpleosIndexMeta {
  const countryName = getCountryConfig(country).name;
  const path = empleosIndexPath(country);
  const counted = total !== null && total > 0;
  return {
    title: `Empleos en ${countryName}: ofertas de trabajo hoy | BuscoTrabajo`,
    heading: `Empleos en ${countryName}`,
    description: counted
      ? `Empleos en ${countryName}: ${formatCount(total)} ofertas de trabajo activas hoy. Busca vacantes por ciudad, cargo o modalidad, compara empresas y aplica en la fuente original.`
      : `Empleos en ${countryName}: ofertas de trabajo activas hoy. Busca vacantes por ciudad, cargo o modalidad, compara empresas y aplica en la fuente original.`,
    path,
    canonicalUrl: `${SITE_URL}${path}`
  };
}

/** The intro sentence under the H1. Only real, passed-in numbers. */
export function buildEmpleosIndexIntro(country: EmpleosIndexCountry, total: number | null): string {
  const countryName = getCountryConfig(country).name;
  const sources = SOURCES_BY_COUNTRY[country] ?? [];
  const sourcesText = sources.length > 0 ? ` Reunimos las vacantes de ${sources.join(", ")}, sin duplicados.` : "";
  const lead =
    total !== null && total > 0
      ? `Hoy hay ${formatCount(total)} ofertas de empleo activas en ${countryName}.`
      : `Ofertas de empleo activas en ${countryName}.`;
  return `${lead}${sourcesText} Cada vacante enlaza a su fuente original para aplicar.`;
}

/**
 * Links of the page. `knownTotal` is the last known count of a guarded city
 * hub or an intent page: undefined (not known yet) or below the guard means
 * no link, never a guess (SEC-013).
 */
export function buildEmpleosIndexSections(
  country: EmpleosIndexCountry,
  knownTotal: (category: ResolvedCategory) => number | undefined
): EmpleosIndexSections {
  const countryName = getCountryConfig(country).name;
  const prefix = country === "VE" ? "/ve" : "";
  const standardCities =
    country === "VE" ? getCountryConfig("VE").cities : CITY_OPTIONS.filter((city) => city !== "Remoto");
  const passesGuard = (category: ResolvedCategory): boolean => {
    const total = knownTotal(category);
    return total !== undefined && isIntentIndexable(total);
  };
  const cities: EmpleosIndexLink[] = [
    ...standardCities.map((city) => ({
      href: buildCategoryPath({ kind: "ciudad", label: city, country }),
      label: `Empleos en ${city}`
    })),
    ...listGuardedCityHubs()
      .filter((hub) => hub.country === country && passesGuard(hub))
      .map((hub) => ({ href: buildCategoryPath(hub), label: `Empleos en ${hub.label}` }))
  ];
  const intents: EmpleosIndexLink[] = listIntentCategories()
    .filter((intent) => intent.country === country && passesGuard(intent))
    .map((intent) => ({ href: buildCategoryPath(intent), label: intentLinkLabel(intent) }));
  const roles: EmpleosIndexLink[] = DEFAULT_ROLES_200.map((role) => ({
    href: buildCategoryPath({ kind: "rol", label: role, country }),
    label: `Trabajo de ${role}`
  }));
  const more: EmpleosIndexLink[] = [
    { href: `${prefix}/dashboard`, label: `Buscar en todas las vacantes de ${countryName}` },
    { href: `${prefix}/empresas`, label: `Empresas que contratan en ${countryName}` },
    { href: prefix || "/", label: `Inicio de BuscoTrabajo ${countryName}` }
  ];
  return { cities, intents, roles, more };
}

export function toEmpleosIndexJob(job: SeoJob, country: EmpleosIndexCountry): EmpleosIndexJob {
  return {
    path: buildJobPath(job),
    url: buildJobUrl(job),
    title: job.title,
    company: job.company || "Confidencial",
    location: job.location || getCountryConfig(job.country || country).name
  };
}

export const EMPLEOS_INDEX_HEADINGS = {
  jobs: "Vacantes recientes",
  cities: "Empleos por ciudad",
  intents: "Empleos por modalidad y jornada",
  roles: "Empleos por cargo",
  more: "Más formas de buscar"
} as const;

function renderLinkSection(name: string, heading: string, links: EmpleosIndexLink[]): string {
  if (links.length === 0) return "";
  return `<section data-empleos-${name} aria-label="${escapeHtml(heading)}"><h2>${escapeHtml(heading)}</h2><ul>${links
    .map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`)
    .join("")}</ul></section>`;
}

/** The raw-HTML body the server puts inside #app. */
export function renderEmpleosIndexHtml(payload: EmpleosIndexPayload): string {
  const meta = buildEmpleosIndexMeta(payload.country, payload.total);
  const jobs =
    payload.jobs.length > 0
      ? `<section data-empleos-jobs aria-label="${EMPLEOS_INDEX_HEADINGS.jobs}"><h2>${EMPLEOS_INDEX_HEADINGS.jobs}</h2><ul>${payload.jobs
          .map(
            (job) =>
              `<li><a href="${escapeHtml(job.path)}">${escapeHtml(job.title)}</a> — ${escapeHtml(job.company)} · ${escapeHtml(job.location)}</li>`
          )
          .join("")}</ul></section>`
      : "";
  return [
    `<h1>${escapeHtml(meta.heading)}</h1>`,
    `<p data-empleos-intro>${escapeHtml(buildEmpleosIndexIntro(payload.country, payload.total))}</p>`,
    jobs,
    renderLinkSection("cities", EMPLEOS_INDEX_HEADINGS.cities, payload.sections.cities),
    renderLinkSection("intents", EMPLEOS_INDEX_HEADINGS.intents, payload.sections.intents),
    renderLinkSection("roles", EMPLEOS_INDEX_HEADINGS.roles, payload.sections.roles),
    renderLinkSection("more", EMPLEOS_INDEX_HEADINGS.more, payload.sections.more)
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildEmpleosIndexBreadcrumbList(country: EmpleosIndexCountry): object {
  const meta = buildEmpleosIndexMeta(country, null);
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: country === "VE" ? `${SITE_URL}/ve` : `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: meta.heading, item: meta.canonicalUrl }
    ]
  };
}

/** ItemList of exactly the jobs linked on the page; null with no jobs. */
export function buildEmpleosIndexItemList(payload: EmpleosIndexPayload): object | null {
  if (payload.jobs.length === 0) return null;
  const meta = buildEmpleosIndexMeta(payload.country, payload.total);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: meta.heading,
    numberOfItems: payload.jobs.length,
    itemListElement: payload.jobs.map((job, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: job.url,
      name: job.title
    }))
  };
}

/** Reciprocal hreflang of the two index pages (SEC-021). */
export function buildEmpleosIndexHreflangTags(): string {
  return (
    `    <link rel="alternate" hreflang="es-CO" href="${SITE_URL}/empleos" />\n` +
    `    <link rel="alternate" hreflang="es-VE" href="${SITE_URL}/ve/empleos" />\n` +
    `    <link rel="alternate" hreflang="x-default" href="${SITE_URL}/empleos" />`
  );
}

export function isEmpleosIndexPayload(value: unknown): value is EmpleosIndexPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<EmpleosIndexPayload>;
  return (
    (payload.country === "CO" || payload.country === "VE") &&
    (payload.total === null || typeof payload.total === "number") &&
    Array.isArray(payload.jobs) &&
    Boolean(payload.sections) &&
    Array.isArray(payload.sections?.cities) &&
    Array.isArray(payload.sections?.intents) &&
    Array.isArray(payload.sections?.roles) &&
    Array.isArray(payload.sections?.more)
  );
}
