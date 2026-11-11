/**
 * Intent pages (seo-intent-pages, ADR 0012): /empleos/remoto,
 * /ve/empleos/remoto, /empleos/sin-experiencia, /ve/empleos/sin-experiencia
 * and /empleos/bogota/sin-experiencia.
 *
 * Pure and client-safe: server.ts (raw HTML) and CategoryLanding.tsx
 * (hydrated DOM) build the same filters, guard, answer block and hreflang
 * from these functions.
 */
import { getCountryConfig } from "../countries/index.js";
import { isPlaceholderEmployer } from "./company-key.js";
import type { JobFilterParams } from "./job-filters.js";
import {
  CITY_INTENTS,
  GUARDED_CITY_HUBS,
  INTENT_LABELS,
  SITE_URL,
  assertNever,
  buildCategoryPath,
  escapeHtml,
  intentExistsIn,
  type IntentId,
  type ResolvedCategory
} from "./job-seo.js";

/** Design D2: a page is indexable with at least this many Google-ready jobs. */
export const INTENT_MIN_JOBS = 10;

/**
 * Rollback flag (ADR 0012 §10). Read per request so it can be flipped
 * without a redeploy of code; unset means on.
 */
export function intentPagesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env.INTENT_PAGES_ENABLED || "").trim().toLowerCase();
  return !(value === "false" || value === "0" || value === "off");
}

export function isIntentIndexable(total: number): boolean {
  return total >= INTENT_MIN_JOBS;
}

/** The robots value to inject, or null to keep the shell's default (index). */
export function intentRobots(total: number): string | null {
  return isIntentIndexable(total) ? null : "noindex,follow";
}

/**
 * SQL filters of an intent page: always its own predicate (never filled
 * with another category, SIP-022) and only Google-ready rows, so the
 * query's `total` is the guard's count.
 */
export function intentFilters(category: ResolvedCategory): JobFilterParams {
  const intent = category.intent as IntentId;
  let own: JobFilterParams;
  switch (intent) {
    case "remoto":
      own = { modality: "remoto" };
      break;
    case "sin-experiencia":
      own = { experience: "sin-experiencia" };
      break;
    case "fines-de-semana":
    case "medio-tiempo":
    case "temporada":
      own = { schedule: intent };
      break;
    default:
      return assertNever(intent);
  }
  return {
    ...(category.city ? { cities: [category.city] } : {}),
    ...own,
    country: category.country,
    googleReady: true
  };
}

/** Every intent page of this phase, in a stable order. */
export function listIntentCategories(): ResolvedCategory[] {
  const national: ResolvedCategory[] = [];
  for (const intent of Object.keys(INTENT_LABELS) as IntentId[]) {
    for (const country of ["CO", "VE"]) {
      if (!intentExistsIn(intent, country)) continue;
      national.push({ kind: "intencion", label: INTENT_LABELS[intent], country, intent });
    }
  }
  const cityIntents: ResolvedCategory[] = CITY_INTENTS.map((entry) => ({
    kind: "intencion",
    label: INTENT_LABELS[entry.intent],
    country: entry.country,
    intent: entry.intent,
    city: entry.city
  }));
  return [...national, ...cityIntents];
}

/** The same intent in the other country, for hreflang; null for city × intent. */
export function siblingIntent(category: ResolvedCategory): ResolvedCategory | null {
  if (category.kind !== "intencion" || category.city || !category.intent) return null;
  const country = category.country === "VE" ? "CO" : "VE";
  // SIW-022: an intent that only exists in one country has no sibling.
  if (!intentExistsIn(category.intent, country)) return null;
  return { ...category, country };
}

/**
 * intentPageCache size (SIW-034): every intent page plus headroom. Fewer
 * entries than pages would make the keeper and the pages evict each other,
 * and every reload is a 1–2 s query on Nano (seo-intent-wave2 design D5).
 */
export const INTENT_PAGE_CACHE_ENTRIES = listIntentCategories().length + GUARDED_CITY_HUBS.length + 4;

/**
 * Rollback flag of seo-empleos-coverage (ADR 0014). Read per request; unset
 * means on. Off: /empleos and /ve/empleos answer 404, guarded city hubs 410,
 * and neither is in the sitemap.
 */
export function empleosCoverageEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env.EMPLEOS_COVERAGE_ENABLED || "").trim().toLowerCase();
  return !(value === "false" || value === "0" || value === "off");
}

/**
 * The intent pages that pass the guard, for sitemap-categories.xml
 * (SIW-033): the keeper's known totals first; only the pages without one are
 * loaded, one at a time (the pool has 5 connections). Any failed load
 * rejects, so the caller answers 503 rather than a sitemap missing URLs.
 */
export async function collectIndexableIntents(
  categories: ResolvedCategory[],
  knownTotal: (category: ResolvedCategory) => number | undefined,
  loadTotal: (category: ResolvedCategory) => Promise<number>
): Promise<ResolvedCategory[]> {
  const indexable: ResolvedCategory[] = [];
  for (const category of categories) {
    const total = knownTotal(category) ?? (await loadTotal(category));
    if (isIntentIndexable(total)) indexable.push(category);
  }
  return indexable;
}

/**
 * Design D5 / SIP-040/041: reciprocal es-CO/es-VE (+ x-default = CO) only
 * when both national pages are indexable; city × intent pages never.
 */
export function buildIntentHreflangTags(
  category: ResolvedCategory,
  totals: { CO: number; VE: number }
): string {
  if (category.kind !== "intencion" || category.city || !siblingIntent(category)) return "";
  if (!isIntentIndexable(totals.CO) || !isIntentIndexable(totals.VE)) return "";
  const co = `${SITE_URL}${buildCategoryPath({ ...category, country: "CO" })}`;
  const ve = `${SITE_URL}${buildCategoryPath({ ...category, country: "VE" })}`;
  return (
    `    <link rel="alternate" hreflang="es-CO" href="${co}" />\n` +
    `    <link rel="alternate" hreflang="es-VE" href="${ve}" />\n` +
    `    <link rel="alternate" hreflang="x-default" href="${co}" />`
  );
}

// ---- Answer block (design D4, AEO) -----------------------------------------

export interface IntentAnswer {
  heading: string;
  items: Array<{ question: string; answer: string }>;
}

interface AnswerJob {
  company?: string | null;
  location?: string | null;
}

const TOP_LIMIT = 5;
const MIN_COMPANY_JOBS = 2;

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Folded once per process, never per row (lesson of PR #117).
const foldedCities = new Map<string, Array<{ label: string; folded: string }>>();
function citiesOf(country: string): Array<{ label: string; folded: string }> {
  let list = foldedCities.get(country);
  if (!list) {
    list = getCountryConfig(country).cities.map((label) => ({ label, folded: fold(label) }));
    foldedCities.set(country, list);
  }
  return list;
}

function top(counts: Map<string, number>, min: number): Array<[string, number]> {
  return [...counts.entries()]
    .filter(([, count]) => count >= min)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, TOP_LIMIT);
}

const listOf = (entries: Array<[string, number]>) => entries.map(([label, count]) => `${label} (${count})`).join(", ");

/**
 * Facts of the page itself, from `total` and the rows already loaded for
 * it (never another query, never Intl). Null with no jobs. No salary
 * figures (SIP-032).
 */
export function buildIntentAnswer(
  category: ResolvedCategory,
  total: number,
  jobs: AnswerJob[]
): IntentAnswer | null {
  if (category.kind !== "intencion" || total <= 0 || jobs.length === 0) return null;
  const place = category.city || getCountryConfig(category.country).name;
  const cities = new Map<string, number>();
  const companies = new Map<string, number>();
  const cityList = category.city ? null : citiesOf(category.country);
  for (const job of jobs) {
    if (job.company && !isPlaceholderEmployer(job.company)) {
      const name = job.company.trim();
      if (name) companies.set(name, (companies.get(name) || 0) + 1);
    }
    if (cityList && job.location) {
      const location = fold(job.location);
      let best: { label: string; at: number } | null = null;
      for (const city of cityList) {
        const at = location.indexOf(city.folded);
        if (at >= 0 && (!best || at < best.at)) best = { label: city.label, at };
      }
      if (best) cities.set(best.label, (cities.get(best.label) || 0) + 1);
    }
  }
  const sample = jobs.length < total ? `Entre las ${jobs.length} más recientes: ` : "";
  const countText = total === 1 ? "1 vacante activa" : `${total} vacantes activas`;
  const items: IntentAnswer["items"] = [{ question: "¿Cuántas vacantes hay?", answer: countAnswer(category, countText, place) }];
  const topCities = top(cities, 1);
  if (topCities.length > 0) items.push({ question: "¿En qué ciudades?", answer: `${sample}${listOf(topCities)}.` });
  const topCompanies = top(companies, MIN_COMPANY_JOBS);
  if (topCompanies.length > 0) items.push({ question: "¿Qué empresas publican?", answer: `${sample}${listOf(topCompanies)}.` });
  return { heading: "Respuestas rápidas", items };
}

function countAnswer(category: ResolvedCategory, countText: string, place: string): string {
  const intent = category.intent as IntentId;
  switch (intent) {
    case "remoto":
      return `${countText} de trabajo remoto en ${place}.`;
    case "sin-experiencia":
      return `${countText} en ${place} cuyo aviso dice que no piden experiencia.`;
    case "fines-de-semana":
      return `${countText} en ${place} cuyo título dice que son de fines de semana.`;
    case "medio-tiempo":
      return `${countText} en ${place} cuyo título dice que son de medio tiempo.`;
    case "temporada":
      return `${countText} en ${place} cuyo título dice que son por temporada.`;
    default:
      return assertNever(intent);
  }
}

/** Inner HTML of the answer block; React renders the same string (SIP-031). */
export function renderIntentAnswerHtml(answer: IntentAnswer): string {
  const items = answer.items
    .map((item) => `<div><dt>${escapeHtml(item.question)}</dt><dd>${escapeHtml(item.answer)}</dd></div>`)
    .join("");
  return `<h2>${escapeHtml(answer.heading)}</h2><dl>${items}</dl>`;
}

export function isIntentAnswer(value: unknown): value is IntentAnswer {
  const answer = value as IntentAnswer | undefined;
  return Boolean(
    answer &&
      typeof answer.heading === "string" &&
      Array.isArray(answer.items) &&
      answer.items.every((item) => typeof item?.question === "string" && typeof item?.answer === "string")
  );
}

// ---- Links from city hubs (design D2) ----------------------------------------

export interface IntentLink {
  href: string;
  label: string;
}

export const INTENT_LINKS_HEADING = "Búsquedas populares";

/** Intent pages a city hub may link: its country's national ones, then its own city × intent. */
export function hubIntentCandidates(hub: ResolvedCategory): ResolvedCategory[] {
  if (hub.kind !== "ciudad") return [];
  return listIntentCategories().filter(
    (intent) => intent.country === hub.country && (!intent.city || intent.city === hub.label)
  );
}

export function intentLinkLabel(category: ResolvedCategory): string {
  const place = category.city || getCountryConfig(category.country).name;
  const intent = category.intent as IntentId;
  switch (intent) {
    case "remoto":
      return `Trabajo remoto en ${place}`;
    case "sin-experiencia":
      return `Trabajo sin experiencia en ${place}`;
    case "fines-de-semana":
      return `Trabajo los fines de semana en ${place}`;
    case "medio-tiempo":
      return `Trabajo de medio tiempo en ${place}`;
    case "temporada":
      return `Trabajo por temporada en ${place}`;
    default:
      return assertNever(intent);
  }
}

/**
 * Links to the candidates whose known total passes the guard. `totalOf`
 * returns undefined when the count isn't known yet (cold cache): no link,
 * never a guess (SIP-021).
 */
export function buildHubIntentLinks(
  hub: ResolvedCategory,
  totalOf: (intent: ResolvedCategory) => number | undefined
): IntentLink[] {
  const links: IntentLink[] = [];
  for (const intent of hubIntentCandidates(hub)) {
    const total = totalOf(intent);
    if (total !== undefined && isIntentIndexable(total)) {
      links.push({ href: buildCategoryPath(intent), label: intentLinkLabel(intent) });
    }
  }
  return links;
}

export function renderHubIntentLinksHtml(links: IntentLink[]): string {
  if (links.length === 0) return "";
  return `<nav data-intent-links aria-label="${escapeHtml(INTENT_LINKS_HEADING)}"><h2>${escapeHtml(INTENT_LINKS_HEADING)}</h2><ul>${links
    .map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`)
    .join("")}</ul></nav>`;
}

/** Whitelisted paths of /api/intent-page (the client fallback); null otherwise. */
export function intentCategoryForPath(pathname: string): ResolvedCategory | null {
  return listIntentCategories().find((category) => buildCategoryPath(category) === pathname) ?? null;
}
