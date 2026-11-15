// Own data (openspec/changes/adsense-readiness F4): the monthly labour-market
// report and the computed comparisons on hubs and on the home page.
//
// Every figure here is computed from the live, deduplicated corpus with the
// same filters the dashboard and the hubs apply (applyJobFilters, the role
// matcher, classifyModality). Nothing is typed by hand: the copy is a
// template over the numbers, and a figure without enough coverage is
// rendered as «sin datos suficientes». No LLM is involved.
//
// Pure module (no DB, no fs): src/db/job-repository.ts loads the rows and
// caches the snapshot; server.ts renders it. Shared by server and client.

import type { PublicContent } from "./agent-readiness.js";
import { applyJobFilters, CITY_OPTIONS, roleTitleMatcher } from "./job-filters.js";
import { classifyModality, type JobModality } from "./job-modality.js";
import { companyKey, isPlaceholderEmployer } from "./company-key.js";
import { buildCategoryPath, type ResolvedCategory } from "./job-seo.js";
import { cityHubFilters } from "./job-internal-links.js";
import { getCountryConfig } from "../countries/index.js";
import { DEFAULT_ROLES_200 } from "../queue/scheduler.js";
import type { Job } from "../sources/types.js";

export const MARKET_REPORT_INDEX_PATH = "/informes";
export const MARKET_REPORT_PATH = "/informes/empleo-colombia";
const EDITION_PATH = /^\/informes\/empleo-colombia-(\d{4})-(\d{2})$/;

/** Minimum vacancies with a published salary (in one currency) before any salary figure is shown. */
export const MARKET_MIN_SALARY_JOBS = 30;
/** Same as the hub inventory guard (MIN_LISTING_JOBS_FOR_ADS / intentRobots). */
export const MIN_INDEXABLE_HUB_JOBS = 10;
const OFFICIAL_SOURCE = "Portal oficial";
const TOP_ROLES = 15;
const TOP_COMPANIES = 10;
const TOP_SOURCES = 8;
const DAY_MS = 86_400_000;

/** One canonical live vacancy, only the columns the report reads. */
export interface MarketRow {
  title: string;
  company: string | null;
  location: string | null;
  source: string;
  sources: string[];
  remoteType: string | null;
  publishedAt: string;
  country: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

export interface MarketCount {
  label: string;
  count: number;
  path: string;
}

export interface MarketSnapshot {
  version: 1;
  country: "CO" | "VE";
  /** ISO time the rows were read. */
  cutoff: string;
  /** YYYY-MM of the cutoff in Bogotá time. */
  period: string;
  total: number;
  last7Days: number;
  /** Every city hub of the country, biggest first. */
  cities: MarketCount[];
  /** Vacancies whose location matches none of the city hubs. */
  withoutCity: number;
  /** Every tracked role with at least one vacancy, biggest first. A role absent here has 0. */
  roles: MarketCount[];
  /** Vacancies whose title matches none of the tracked roles. */
  withoutRole: number;
  modalities: Record<JobModality, number>;
  /** Vacancies whose primary or merged source is the employer's own careers site. */
  official: number;
  sources: Array<{ label: string; count: number }>;
  companies: Array<{ label: string; count: number }>;
  companyCount: number;
  /** Vacancies with any published salary, in any currency. */
  salaryJobs: number;
  /** Null below MARKET_MIN_SALARY_JOBS in the main currency. */
  salary: { currency: string; jobs: number; p25: number; median: number; p75: number } | null;
}

export interface MarketComparison {
  previousPeriod: string;
  previousCutoff: string;
  totalDelta: number;
  totalPct: number | null;
  officialShareDelta: number;
  remoteShareDelta: number;
  cities: Array<{ label: string; delta: number; current: number; previous: number }>;
}

const MODALITIES: JobModality[] = ["presencial", "hibrido", "remoto", "freelance", "unknown"];
const MODALITY_WORDS: Record<JobModality, string> = {
  presencial: "presenciales",
  hibrido: "híbridas",
  remoto: "remotas",
  freelance: "proyectos freelance",
  unknown: "sin modalidad declarada"
};

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

function toJob(row: MarketRow, index: number): Job {
  return {
    jobId: String(index),
    title: row.title,
    company: row.company ?? "Confidencial",
    location: row.location ?? "",
    url: "",
    dateText: "",
    source: row.source,
    sources: row.sources,
    country: row.country,
    remoteType: (row.remoteType ?? undefined) as Job["remoteType"],
    publishedAt: row.publishedAt
  } as Job;
}

function bogotaPeriod(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const value = sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
  return Math.round(value);
}

function positive(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function marketCityLabels(country: "CO" | "VE"): string[] {
  return country === "CO" ? [...CITY_OPTIONS] : [...getCountryConfig("VE").cities];
}

/**
 * Aggregates the canonical rows of one country. Yields to the event loop
 * between cities and roles, so a 40k-row snapshot never blocks requests for
 * long (the role pass is 200 matchers over the distinct titles).
 */
export async function buildMarketSnapshot(
  rows: readonly MarketRow[],
  options: { country: "CO" | "VE"; cutoff: Date }
): Promise<MarketSnapshot> {
  const { country, cutoff } = options;
  const jobs = rows.map(toJob);
  const cutoffMs = cutoff.getTime();

  const cities: MarketCount[] = [];
  const placed = new Set<number>();
  const indexOf = new Map<Job, number>(jobs.map((job, index) => [job, index]));
  for (const label of marketCityLabels(country)) {
    const category: ResolvedCategory = { kind: "ciudad", label, country };
    const matched = applyJobFilters(jobs, cityHubFilters(category));
    for (const job of matched) placed.add(indexOf.get(job)!);
    cities.push({ label, count: matched.length, path: buildCategoryPath(category) });
    await yieldToEventLoop();
  }
  cities.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"));

  // Roles: the hubs' own matcher over distinct titles, weighted by count.
  const titleCounts = new Map<string, number>();
  for (const row of rows) titleCounts.set(row.title, (titleCounts.get(row.title) || 0) + 1);
  const titles = [...titleCounts.entries()];
  const matchedTitle = new Set<string>();
  const roles: MarketCount[] = [];
  for (const label of DEFAULT_ROLES_200) {
    const matches = roleTitleMatcher(label);
    let count = 0;
    for (const [title, weight] of titles) {
      if (matches(title)) {
        count += weight;
        matchedTitle.add(title);
      }
    }
    if (count > 0) roles.push({ label, count, path: buildCategoryPath({ kind: "rol", label, country }) });
    await yieldToEventLoop();
  }
  roles.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"));
  let withoutRole = 0;
  for (const [title, weight] of titles) if (!matchedTitle.has(title)) withoutRole += weight;

  const modalities = Object.fromEntries(MODALITIES.map((modality) => [modality, 0])) as Record<JobModality, number>;
  const sources = new Map<string, number>();
  const companies = new Map<string, { names: Map<string, number>; count: number }>();
  const salaryByCurrency = new Map<string, number[]>();
  let official = 0;
  let last7Days = 0;
  let salaryJobs = 0;
  for (const row of rows) {
    modalities[classifyModality({ source: row.source, remoteType: row.remoteType, title: row.title, location: row.location })] += 1;
    if (row.source === OFFICIAL_SOURCE || row.sources.includes(OFFICIAL_SOURCE)) official += 1;
    if (row.source) sources.set(row.source, (sources.get(row.source) || 0) + 1);
    if (row.company && !isPlaceholderEmployer(row.company)) {
      const key = companyKey(row.company);
      const entry = companies.get(key) ?? { names: new Map<string, number>(), count: 0 };
      entry.count += 1;
      entry.names.set(row.company.trim(), (entry.names.get(row.company.trim()) || 0) + 1);
      companies.set(key, entry);
    }
    const age = cutoffMs - Date.parse(row.publishedAt);
    if (Number.isFinite(age) && age >= 0 && age <= 7 * DAY_MS) last7Days += 1;
    const currency = row.salaryCurrency?.trim().toUpperCase();
    const low = positive(row.salaryMin) ?? positive(row.salaryMax);
    const high = positive(row.salaryMax) ?? positive(row.salaryMin);
    if (currency && low !== null && high !== null) {
      salaryJobs += 1;
      const values = salaryByCurrency.get(currency) ?? [];
      values.push((low + high) / 2);
      salaryByCurrency.set(currency, values);
    }
  }

  const [mainCurrency] = [...salaryByCurrency.entries()].sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b));
  let salary: MarketSnapshot["salary"] = null;
  if (mainCurrency && mainCurrency[1].length >= MARKET_MIN_SALARY_JOBS) {
    const sorted = [...mainCurrency[1]].sort((a, b) => a - b);
    salary = {
      currency: mainCurrency[0],
      jobs: sorted.length,
      p25: quantile(sorted, 0.25),
      median: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75)
    };
  }

  const displayName = (names: Map<string, number>) =>
    [...names.entries()].sort(([a, x], [b, y]) => y - x || a.length - b.length || a.localeCompare(b))[0]![0];

  return {
    version: 1,
    country,
    cutoff: cutoff.toISOString(),
    period: bogotaPeriod(cutoff),
    total: rows.length,
    last7Days,
    cities,
    withoutCity: rows.length - placed.size,
    roles,
    withoutRole,
    modalities,
    official,
    sources: [...sources.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, TOP_SOURCES),
    companies: [...companies.values()]
      .map((entry) => ({ label: displayName(entry.names), count: entry.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"))
      .slice(0, TOP_COMPANIES),
    companyCount: companies.size,
    salaryJobs,
    salary
  };
}

/** Shape check for a frozen edition read from disk (data/market-reports). */
export function isMarketSnapshot(value: unknown): value is MarketSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const isCount = (item: unknown) =>
    !!item && typeof item === "object" && typeof (item as MarketCount).label === "string" && Number.isInteger((item as MarketCount).count);
  return (
    v.version === 1 &&
    (v.country === "CO" || v.country === "VE") &&
    typeof v.cutoff === "string" && Number.isFinite(Date.parse(v.cutoff)) &&
    typeof v.period === "string" && /^\d{4}-\d{2}$/.test(v.period) &&
    Number.isInteger(v.total) && Number.isInteger(v.last7Days) && Number.isInteger(v.official) &&
    Number.isInteger(v.withoutCity) && Number.isInteger(v.withoutRole) &&
    Number.isInteger(v.companyCount) && Number.isInteger(v.salaryJobs) &&
    Array.isArray(v.cities) && v.cities.every(isCount) &&
    Array.isArray(v.roles) && v.roles.every(isCount) &&
    Array.isArray(v.companies) && v.companies.every(isCount) &&
    Array.isArray(v.sources) && v.sources.every(isCount) &&
    !!v.modalities && typeof v.modalities === "object" &&
    MODALITIES.every((modality) => Number.isInteger((v.modalities as Record<string, unknown>)[modality])) &&
    (v.salary === null || (typeof v.salary === "object" && Number.isFinite((v.salary as { median: number }).median)))
  );
}

const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

export function compareMarketSnapshots(current: MarketSnapshot, previous: MarketSnapshot | null): MarketComparison | null {
  if (!previous || previous.country !== current.country) return null;
  if (previous.period >= current.period) return null;
  const previousCities = new Map(previous.cities.map((city) => [city.label, city.count]));
  return {
    previousPeriod: previous.period,
    previousCutoff: previous.cutoff,
    totalDelta: current.total - previous.total,
    totalPct: previous.total > 0 ? ((current.total - previous.total) / previous.total) * 100 : null,
    officialShareDelta: share(current.official, current.total) - share(previous.official, previous.total),
    remoteShareDelta: share(current.modalities.remoto, current.total) - share(previous.modalities.remoto, previous.total),
    cities: current.cities
      .filter((city) => previousCities.has(city.label) && (city.count > 0 || previousCities.get(city.label)! > 0))
      .slice(0, 8)
      .map((city) => ({
        label: city.label,
        current: city.count,
        previous: previousCities.get(city.label)!,
        delta: city.count - previousCities.get(city.label)!
      }))
  };
}

// ---- formatting --------------------------------------------------------

const integer = (value: number) => value.toLocaleString("es-CO");
const percent = (value: number) => `${(Math.round(value * 10) / 10).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`;
const pct = (part: number, whole: number) => percent(share(part, whole));
const signed = (value: number) => (value > 0 ? `+${integer(value)}` : value < 0 ? `−${integer(-value)}` : "0");
const signedPoints = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  const text = Math.abs(rounded).toLocaleString("es-CO", { maximumFractionDigits: 1 });
  return rounded > 0 ? `+${text} puntos` : rounded < 0 ? `−${text} puntos` : "sin cambio";
};
const vacancies = (count: number) => (count === 1 ? "1 vacante" : `${integer(count)} vacantes`);

export function formatMarketDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" });
}

function formatMarketDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Bogota"
  });
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function marketPeriodLabel(period: string): string {
  const [year, month] = period.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} de ${year}`;
}

function money(currency: string, value: number): string {
  return currency === "COP" ? `${integer(value)} pesos` : `${integer(value)} ${currency}`;
}

export function marketEditionPath(period: string): string {
  return `${MARKET_REPORT_PATH}-${period}`;
}

// ---- report page ------------------------------------------------------

export interface MarketReportEdition {
  pathname: string;
  /** True for a frozen month (data/market-reports), false for the live edition. */
  frozen: boolean;
  /** Frozen editions available, newest first (YYYY-MM). */
  editions?: string[];
}

export function buildMarketReportContent(
  snapshot: MarketSnapshot,
  previous: MarketSnapshot | null,
  edition: MarketReportEdition
): PublicContent {
  const countryName = getCountryConfig(snapshot.country).name;
  const month = marketPeriodLabel(snapshot.period);
  const cutoffDate = formatMarketDate(snapshot.cutoff);
  const total = snapshot.total;
  const placedCities = snapshot.cities.filter((city) => city.count > 0);
  const [firstCity, secondCity, thirdCity] = placedCities;
  const topRoles = snapshot.roles.slice(0, TOP_ROLES);
  const comparison = compareMarketSnapshots(snapshot, previous);
  const known = total - snapshot.modalities.unknown;

  const cityParagraphs = firstCity
    ? [
        `${firstCity.label} concentra ${vacancies(firstCity.count)}, el ${pct(firstCity.count, total)} del total del país en este corte.` +
          (secondCity ? ` Le sigue ${secondCity.label} con ${vacancies(secondCity.count)} (${pct(secondCity.count, total)})` : "") +
          (thirdCity ? ` y ${thirdCity.label} con ${vacancies(thirdCity.count)} (${pct(thirdCity.count, total)}).` : secondCity ? "." : ""),
        `${vacancies(snapshot.withoutCity)} (${pct(snapshot.withoutCity, total)}) no mencionan ninguna de las ${snapshot.cities.length} ciudades que seguimos: son de otros municipios, de todo el país o no dicen dónde.`
      ]
    : ["Sin datos suficientes: ninguna vacante del corte menciona una de las ciudades que seguimos."];

  const roleParagraphs = topRoles.length > 0
    ? [
        `El cargo con más vacantes es ${topRoles[0]!.label} (${vacancies(topRoles[0]!.count)}, ${pct(topRoles[0]!.count, total)} del total).` +
          (topRoles[1] ? ` Después vienen ${topRoles.slice(1, 4).map((role) => `${role.label} (${integer(role.count)})`).join(", ")}.` : ""),
        `Una vacante puede contar en más de un cargo si su título encaja en varios, y ${vacancies(snapshot.withoutRole)} (${pct(snapshot.withoutRole, total)}) no encajan en ninguno de los ${DEFAULT_ROLES_200.length} cargos que seguimos.`
      ]
    : ["Sin datos suficientes: ningún título del corte coincide con los cargos que seguimos."];

  const modalityParagraphs = [
    `${MODALITIES.filter((modality) => modality !== "unknown" && snapshot.modalities[modality] > 0)
      .map((modality) => `${vacancies(snapshot.modalities[modality])} ${MODALITY_WORDS[modality]} (${pct(snapshot.modalities[modality], total)})`)
      .join(", ") || "Ninguna vacante declara modalidad"}.`,
    `${vacancies(snapshot.modalities.unknown)} (${pct(snapshot.modalities.unknown, total)}) no dicen si son presenciales, híbridas o remotas; entre las ${integer(known)} que sí lo dicen, el ${pct(snapshot.modalities.remoto, known)} son remotas.`
  ];

  const sourceParagraphs = [
    `${vacancies(snapshot.official)} (${pct(snapshot.official, total)}) vienen del portal de empleo del propio empleador, la fuente más directa: la publica la empresa para que se difunda. El resto proviene de portales de empleo de terceros, siempre con enlace a la publicación original.`,
    `Fuente principal de cada vacante: ${snapshot.sources.map((source) => `${source.label} ${integer(source.count)} (${pct(source.count, total)})`).join(", ")}.`
  ];

  const companyParagraphs = snapshot.companies.length > 0
    ? [
        `${integer(snapshot.companyCount)} empresas identificadas publican vacantes activas. Las que más publican: ${snapshot.companies
          .map((company) => `${company.label} (${integer(company.count)})`)
          .join(", ")}.`,
        `Las diez primeras suman ${vacancies(snapshot.companies.reduce((sum, company) => sum + company.count, 0))}, el ${pct(snapshot.companies.reduce((sum, company) => sum + company.count, 0), total)} del total. Las ofertas de empleador confidencial no cuentan como empresa.`
      ]
    : ["Sin datos suficientes: ninguna vacante del corte nombra a su empleador."];

  const salaryParagraphs = [
    `${vacancies(snapshot.salaryJobs)} de ${integer(total)} (${pct(snapshot.salaryJobs, total)}) publican un salario.`,
    snapshot.salary
      ? `Entre las ${integer(snapshot.salary.jobs)} que lo publican en ${snapshot.salary.currency === "COP" ? "pesos colombianos" : snapshot.salary.currency}, el valor central (mediana del punto medio de cada rango) es ${money(snapshot.salary.currency, snapshot.salary.median)}; la mitad de esas ofertas está entre ${money(snapshot.salary.currency, snapshot.salary.p25)} y ${money(snapshot.salary.currency, snapshot.salary.p75)}. Es el valor tal como lo publica la fuente: no siempre dice si es mensual ni si incluye prestaciones.`
      : `Sin datos suficientes para dar un salario típico: hacen falta al menos ${MARKET_MIN_SALARY_JOBS} vacantes con salario publicado en una misma moneda.`
  ];

  const variationParagraphs = comparison
    ? [
        `Frente al corte del ${formatMarketDate(comparison.previousCutoff)} (${marketPeriodLabel(comparison.previousPeriod)}), las vacantes activas pasaron de ${integer(total - comparison.totalDelta)} a ${integer(total)}: ${signed(comparison.totalDelta)}${comparison.totalPct === null ? "" : ` (${comparison.totalPct >= 0 ? "+" : "−"}${percent(Math.abs(comparison.totalPct))})`}.`,
        `La cuota del portal oficial del empleador cambió ${signedPoints(comparison.officialShareDelta)} y la de vacantes remotas ${signedPoints(comparison.remoteShareDelta)}.`,
        ...(comparison.cities.length > 0
          ? [`Por ciudad: ${comparison.cities.map((city) => `${city.label} ${signed(city.delta)} (de ${integer(city.previous)} a ${integer(city.current)})`).join(", ")}.`]
          : [])
      ]
    : [
        "Variación respecto al mes anterior: sin datos suficientes. La comparación necesita la edición congelada del mes anterior, y todavía no existe; aparecerá aquí desde la siguiente edición."
      ];

  const editionLinks = [
    { label: "Todos los informes", href: MARKET_REPORT_INDEX_PATH },
    ...(edition.frozen ? [{ label: "Edición en curso", href: MARKET_REPORT_PATH }] : []),
    ...(edition.editions ?? [])
      .filter((period) => marketEditionPath(period) !== edition.pathname)
      .slice(0, 6)
      .map((period) => ({ label: `Edición de ${marketPeriodLabel(period)}`, href: marketEditionPath(period) }))
  ];

  return {
    pathname: edition.pathname,
    title: `Mercado laboral en ${countryName}, ${month}: vacantes por ciudad y cargo | BuscoTrabajo`,
    description: `${vacancies(total)} activas en ${countryName} al ${cutoffDate}: reparto por ciudad, cargo, modalidad y fuente, salarios publicados y metodología. Datos propios de BuscoTrabajo.`,
    heading: `Mercado laboral en ${countryName}: informe de ${month}`,
    introduction: [
      `Fecha de corte: ${formatMarketDateTime(snapshot.cutoff)} (hora de Colombia). En ese momento había ${vacancies(total)} activas y sin duplicados en ${countryName}, de ${integer(snapshot.companyCount)} empresas identificadas; ${vacancies(snapshot.last7Days)} (${pct(snapshot.last7Days, total)}) se publicaron en los 7 días anteriores.`,
      edition.frozen
        ? `Esta es la edición congelada de ${month}: sus cifras no cambian.`
        : `Esta es la edición en curso de ${month}: se recalcula como mucho cada pocas horas con el corpus vivo, y al cerrar el mes se congela en su propia dirección.`,
      "Ningún portal individual puede dar estas cifras: salen de cruzar y deduplicar las vacantes de todos los portales que reúne BuscoTrabajo."
    ],
    sections: [
      {
        heading: `Vacantes por ciudad`,
        paragraphs: cityParagraphs,
        links: placedCities.slice(0, 12).map((city) => ({ label: `${city.label}: ${vacancies(city.count)} (${pct(city.count, total)})`, href: city.path }))
      },
      {
        heading: "Cargos con más vacantes",
        paragraphs: roleParagraphs,
        links: topRoles.map((role) => ({ label: `${role.label}: ${vacancies(role.count)}`, href: role.path }))
      },
      { heading: "Modalidad de trabajo", paragraphs: modalityParagraphs },
      { heading: "De dónde vienen las vacantes", paragraphs: sourceParagraphs },
      { heading: "Empresas que más publican", paragraphs: companyParagraphs },
      { heading: "Salarios publicados", paragraphs: salaryParagraphs },
      { heading: "Variación respecto al mes anterior", paragraphs: variationParagraphs },
      {
        heading: "Metodología",
        paragraphs: [
          `Se cuentan las vacantes activas en el momento del corte: publicadas en los últimos 30 días, sin plazo vencido y sin cierre confirmado por la fuente. Cada vacante cuenta una sola vez aunque aparezca en varios portales (misma URL normalizada o mismo cargo, empresa y ubicación). Las vacantes remotas sin país se cuentan en ${countryName}, igual que en el buscador.`,
          "La ciudad sale del texto de ubicación, con el mismo filtro que usan las páginas de cada ciudad; el cargo, de las palabras del título, con el mismo criterio que las páginas de cada cargo; la modalidad, de lo que declara la fuente o, si no lo declara, del título y la ubicación. Una vacante es del portal oficial cuando su fuente principal o una de sus fuentes fusionadas es el portal de empleo del propio empleador.",
          "Todo se calcula por código, sin redacción manual de cifras ni modelos de lenguaje. La explicación completa de cómo se obtienen, deduplican y retiran las vacantes está en la página de metodología."
        ],
        links: [{ label: "Metodología de BuscoTrabajo", href: "/metodologia" }]
      },
      {
        heading: "Límites de estos datos",
        paragraphs: [
          "Es una foto de las vacantes publicadas en internet en los portales que reunimos, no una estadística oficial de empleo ni de desempleo: para eso están el DANE y el Servicio Público de Empleo. Muchas contrataciones no pasan por un portal.",
          "Mide el inventario vivo en la fecha de corte, no cuántas vacantes se publicaron en todo el mes: una oferta que se cerró antes del corte no aparece.",
          `El salario y la modalidad dependen de lo que publique cada fuente; el ${pct(snapshot.salaryJobs, total)} publica salario y el ${pct(snapshot.modalities.unknown, total)} no declara modalidad. Cuando una cifra no tiene cobertura suficiente se indica «sin datos suficientes» en lugar de estimarla.`
        ]
      },
      { heading: "Otras ediciones", paragraphs: ["Cada mes cerrado conserva su edición con su propia dirección para comparar en el tiempo."], links: editionLinks }
    ]
  };
}

export function buildMarketReportIndexContent(live: MarketSnapshot | null, editions: string[]): PublicContent {
  const links = [
    ...(live ? [{ label: `Edición en curso: ${marketPeriodLabel(live.period)} (${vacancies(live.total)} al ${formatMarketDate(live.cutoff)})`, href: MARKET_REPORT_PATH }] : [{ label: "Edición en curso", href: MARKET_REPORT_PATH }]),
    ...editions.map((period) => ({ label: `Edición de ${marketPeriodLabel(period)}`, href: marketEditionPath(period) }))
  ];
  return {
    pathname: MARKET_REPORT_INDEX_PATH,
    title: "Informes del mercado laboral en Colombia | BuscoTrabajo",
    description: "Informes mensuales con datos propios de BuscoTrabajo: vacantes activas por ciudad, cargo, modalidad y fuente, con fecha de corte, metodología y límites.",
    heading: "Informes del mercado laboral",
    introduction: [
      "Cada mes publicamos un informe con las vacantes activas en Colombia que reúne BuscoTrabajo: cuántas hay por ciudad y por cargo, qué parte es remota, cuántas vienen del portal oficial del empleador, qué empresas publican más y qué salarios se publican.",
      "Las cifras se calculan por código con el corpus deduplicado, llevan su fecha de corte y dicen qué no miden. Cuando una cifra no tiene cobertura suficiente, el informe lo dice en vez de estimarla."
    ],
    sections: [
      { heading: "Ediciones", paragraphs: [editions.length > 0 ? `${editions.length === 1 ? "Hay 1 edición cerrada" : `Hay ${editions.length} ediciones cerradas`} además de la edición en curso.` : "La edición en curso es la primera; cada mes cerrado conservará la suya."], links },
      { heading: "Cómo se calculan", paragraphs: ["Con las mismas reglas de deduplicación, vigencia y filtros que el buscador y las páginas de ciudad y cargo. El detalle está en la sección de metodología de cada informe y en la página de metodología del sitio."], links: [{ label: "Metodología de BuscoTrabajo", href: "/metodologia" }] }
    ]
  };
}

// ---- hubs -------------------------------------------------------------

/** Robots of a plain city/role hub: below the inventory guard it stays out of the index. */
export function staticHubRobots(total: number): string | null {
  return total < MIN_INDEXABLE_HUB_JOBS ? "noindex,follow" : null;
}

/**
 * The snapshot's count for a static city/role hub (sitemap guard). Undefined
 * when there is no snapshot for that country or the hub isn't one it counts,
 * so an unknown hub keeps today's behaviour (listed).
 */
export function knownStaticHubTotal(snapshot: MarketSnapshot | undefined, category: ResolvedCategory): number | undefined {
  if (!snapshot || snapshot.country !== category.country) return undefined;
  if (category.kind === "ciudad") return snapshot.cities.find((city) => city.label === category.label)?.count;
  if (category.kind === "rol") {
    if (!DEFAULT_ROLES_200.includes(category.label)) return undefined;
    return snapshot.roles.find((role) => role.label === category.label)?.count ?? 0;
  }
  return undefined;
}

type HubJob = Pick<Job, "title" | "company" | "location" | "source"> & { sources?: string[]; remoteType?: string | null };

/**
 * One paragraph comparing a hub with the country, from the hub's own total
 * and rows and the last national snapshot. Null without a snapshot of the
 * hub's country (never a guess).
 */
export function buildHubComparison(input: {
  category: ResolvedCategory;
  total: number;
  jobs: readonly HubJob[];
  national: MarketSnapshot | undefined;
}): string | null {
  const { category, total, jobs, national } = input;
  if (!national || national.country !== category.country || national.total <= 0 || total <= 0) return null;
  const countryName = getCountryConfig(category.country).name;
  const subject =
    category.kind === "ciudad"
      ? category.label === "Remoto" ? "Remoto (sin ciudad fija)" : category.label
      : category.kind === "rol"
        ? `El cargo ${category.label}`
        : category.label;
  const sentences: string[] = [];
  sentences.push(
    `${subject} suma ${vacancies(total)} activas, el equivalente al ${pct(Math.min(total, national.total), national.total)} de las ${integer(national.total)} vacantes de ${countryName} en nuestro último corte (${formatMarketDate(national.cutoff)}).`
  );
  const ranking = category.kind === "ciudad" ? national.cities : category.kind === "rol" ? national.roles : [];
  const rank = ranking.findIndex((entry) => entry.label === category.label);
  if (rank >= 0) {
    const of = ranking.filter((entry) => entry.count > 0).length;
    sentences.push(
      category.kind === "ciudad"
        ? `Ocupa el puesto ${rank + 1} entre las ${of} ciudades con vacantes que seguimos.`
        : `Es el número ${rank + 1} entre los ${of} cargos con vacantes que seguimos.`
    );
  }
  if (jobs.length > 0) {
    const sample = jobs.length;
    const remote = jobs.filter((job) => classifyModality({ source: job.source, remoteType: job.remoteType, title: job.title, location: job.location }) === "remoto").length;
    const official = jobs.filter((job) => job.source === OFFICIAL_SOURCE || (job.sources ?? []).includes(OFFICIAL_SOURCE)).length;
    const scope = sample < total ? `en las ${integer(sample)} más recientes` : `en ${sample === 1 ? "la vacante" : `las ${integer(sample)} vacantes`} de esta página`;
    sentences.push(
      `${scope.charAt(0).toUpperCase()}${scope.slice(1)}, el ${pct(remote, sample)} es remoto (${pct(national.modalities.remoto, national.total)} en todo el país) y el ${pct(official, sample)} viene del portal oficial del empleador (${pct(national.official, national.total)} en el país).`
    );
    const companies = new Map<string, { label: string; count: number }>();
    for (const job of jobs) {
      if (!job.company || isPlaceholderEmployer(job.company)) continue;
      const key = companyKey(job.company);
      const entry = companies.get(key) ?? { label: job.company.trim(), count: 0 };
      entry.count += 1;
      companies.set(key, entry);
    }
    const top = [...companies.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"))[0];
    if (top && top.count > 1) {
      sentences.push(`${top.label} es la empresa con más ofertas en esa muestra: ${integer(top.count)} de ${integer(sample)} (${pct(top.count, sample)}).`);
    } else if (companies.size > 1) {
      sentences.push(`Ninguna empresa repite en esa muestra: ${integer(companies.size)} empresas distintas.`);
    }
  }
  return sentences.join(" ");
}

// ---- home -------------------------------------------------------------

/** Context sentence of the home's city cards, from the figures they already show. */
export function buildHomeCityContext(
  cityCounts: Record<string, number | null>,
  totalJobs: number | null,
  countryName: string
): string | null {
  if (!totalJobs || totalJobs <= 0) return null;
  const known = Object.entries(cityCounts)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .sort((a, b) => b[1] - a[1]);
  const [first, second, third] = known;
  if (!first) return null;
  let text = `${first[0]} concentra el ${pct(first[1], totalJobs)} de las ${integer(totalJobs)} vacantes activas en ${countryName}`;
  if (second) text += third ? `; le siguen ${second[0]} (${pct(second[1], totalJobs)}) y ${third[0]} (${pct(third[1], totalJobs)})` : `; le sigue ${second[0]} (${pct(second[1], totalJobs)})`;
  return `${text}. Cada ciudad tiene su página con las empresas que más contratan, los cargos más pedidos y los salarios publicados.`;
}

/** Share label for a city card ("12,4 % del país"), or null. */
export function homeShareLabel(count: number | null | undefined, totalJobs: number | null): string | null {
  if (typeof count !== "number" || !totalJobs || totalJobs <= 0) return null;
  return `${pct(count, totalJobs)} del país`;
}

// ---- routes -----------------------------------------------------------

export type MarketReportRoute = { kind: "index" } | { kind: "live" } | { kind: "edition"; period: string };

export function parseMarketReportPath(pathname: string): MarketReportRoute | null {
  if (pathname === MARKET_REPORT_INDEX_PATH) return { kind: "index" };
  if (pathname === MARKET_REPORT_PATH) return { kind: "live" };
  const match = EDITION_PATH.exec(pathname);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { kind: "edition", period: `${match[1]}-${match[2]}` };
}

export function marketReportsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env.REPORTS_ENABLED || "").trim().toLowerCase();
  return !(value === "false" || value === "0" || value === "off");
}

/** sitemap-pages.xml entries of the reports (none with the switch off). */
export function marketReportSitemapEntries(enabled: boolean, editions: string[]): string[] {
  if (!enabled) return [];
  return [MARKET_REPORT_INDEX_PATH, MARKET_REPORT_PATH, ...editions.map(marketEditionPath)];
}
