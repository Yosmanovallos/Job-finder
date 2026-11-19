import { COUNTRIES, getCountryConfig } from "../countries/index.js";
import type { HomeMarketFigures } from "./market-report.js";

// Shape of GET /api/home-stats, shared by server.ts (which builds it) and
// use-home-data.ts (which reads it). No JSX or DB imports: both bundles use
// this file. Every number is a real count from the same filters the
// dashboard applies; a part whose query failed is null (or empty), and the
// homepage hides it instead of showing a stale or invented figure.

export interface HomeJob {
  jobId: string;
  title: string;
  company: string;
  location: string;
  source: string;
  dateText?: string;
  publishedAt?: string;
}

export interface HomeCompany {
  company: string;
  count: number;
  logoUrl: string | null;
}

export interface HomeData {
  totalJobs: number | null;
  last7Days: number | null;
  last24Hours: number | null;
  onSite: number | null;
  remote: number | null;
  totalCompanies: number | null;
  cityCounts: Record<string, number | null>;
  latestJobs: HomeJob[];
  companies: HomeCompany[];
  /** Role figures of the newest frozen market report (adsense-readiness F4); null without one. */
  market?: HomeMarketFigures | null;
}

// Role pages that exist in sitemap-categories.xml (DEFAULT_ROLES_200) —
// labels slugify to exactly those URLs through buildCategoryPath. The home
// links every one of them; the server attaches their report figures.
export const HOME_POPULAR_ROLES = [
  "Asesor comercial",
  "Auxiliar administrativo",
  "Auxiliar de enfermería",
  "Ejecutivo de ventas",
  "Contador público",
  "Desarrollador full stack",
  "Analista de logística",
  "Cuidadora de adultos mayores",
  "Diseñador gráfico",
  "Ingeniero industrial",
  "Community manager",
  "Ingeniero civil"
];

// The "Explora por ciudad" cards. The server only counts these cities, so
// the endpoint can't be asked for arbitrary filters.
const HOME_CITY_COUNT = 6;

export function getHomeCities(country: string): string[] {
  return getCountryConfig(country).cities.slice(0, HOME_CITY_COUNT);
}

export function isHomeCountry(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(COUNTRIES, code);
}
