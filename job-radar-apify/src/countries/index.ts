// Country as a first-class config dimension (Venezuela expansion — see
// backlog/venezuela-expansion.md). One app, one DB, country as data — NOT
// separate apps/deployments per country. This module is the single place
// that knows which countries exist and what their per-country display data
// (cities, name) is; scraping-side per-source domain/proxy config lives
// next to each adapter instead (see src/sources/computrabajo-ve.ts etc.),
// since that's inherently source-specific, not country-generic.

export interface CountryConfig {
  code: string;
  name: string;
  // Major cities used for the dashboard's city filter and (via job-seo.ts)
  // category landing pages — same role CITY_OPTIONS plays for Colombia in
  // job-filters.ts today, just keyed by country instead of hardcoded to one.
  cities: string[];
}

export const DEFAULT_COUNTRY = "CO";

export const COUNTRIES: Record<string, CountryConfig> = {
  CO: {
    code: "CO",
    name: "Colombia",
    cities: [
      "Bogotá",
      "Medellín",
      "Cali",
      "Barranquilla",
      "Cartagena",
      "Bucaramanga",
      "Pereira",
      "Manizales"
    ]
  },
  VE: {
    code: "VE",
    name: "Venezuela",
    cities: ["Caracas", "Maracaibo", "Valencia", "Barquisimeto", "Maracay", "Ciudad Guayana"]
  }
};

export function getCountryConfig(code: string | undefined | null): CountryConfig {
  const key = (code || DEFAULT_COUNTRY).toUpperCase();
  return COUNTRIES[key] || COUNTRIES[DEFAULT_COUNTRY];
}

export function isKnownCountry(code: string | undefined | null): boolean {
  return Boolean(code && COUNTRIES[code.toUpperCase()]);
}

// Mirrors job-filters.ts's getModalityLabel remote detection
// (loc.includes("remoto") / loc.includes("remote")) and
// scripts/migrate-country.ts's backfill predicate. Deliberately duplicated
// rather than imported from job-filters.ts — that file's matching logic is
// already precision-tuned (see its own comments on past false-positive
// bugs) and pulls in scheduler.js/ai-role-agent.js; this stays a
// zero-dependency leaf so nothing here can accidentally change that file's
// behavior via a shared refactor. All three copies check the same two
// substrings — if one changes, change all three together.
export function isRemoteLocation(location: string | undefined | null): boolean {
  const loc = (location || "").toLowerCase();
  return loc.includes("remoto") || loc.includes("remote");
}
