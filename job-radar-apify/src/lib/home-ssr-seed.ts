import type { HomeData } from "./home-stats.js";

// What server.ts used to render "/" and "/ve" (src/server/home-ssr.tsx),
// handed to the client as window.__SSR_HOME__ so hydrateRoot's first render
// produces exactly the same markup: the same figures (no EMPTY flash), the
// same desktop/phone layout guess, and the same clock for relative dates.
// Any mismatch would make React 19 throw the server HTML away and
// client-render the whole page — the flash and late LCP this replaces.
export interface HomeSsrSeed {
  country: "CO" | "VE";
  data: HomeData;
  desktop: boolean;
  now: string;
}

let seed: HomeSsrSeed | null = null;

export function setHomeSsrSeed(next: HomeSsrSeed | null): void {
  seed = next;
}

export function getHomeSsrSeed(country?: string): HomeSsrSeed | null {
  if (!seed) return null;
  if (country && seed.country !== country) return null;
  return seed;
}

export function homeDataHasFigures(data: HomeData): boolean {
  return data.totalJobs !== null || data.companies.length > 0 || data.latestJobs.length > 0;
}
