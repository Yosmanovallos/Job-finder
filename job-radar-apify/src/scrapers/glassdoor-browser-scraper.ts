/**
 * Glassdoor — Browser-Based Global Catalog Scraper (CO + VE)
 *
 * Same query strategy as the abandoned got-scraping GlassdoorV2 attempt
 * (country-wide + 8 cities, no keyword — see git branch
 * feat/glassdoor-v2-global-catalog for that history): that part was never
 * the problem. The problem was that Glassdoor's Cloudflare WAF flat-blocks
 * every datacenter/hosting-provider ASN (confirmed: Azure, and a Leaseweb
 * datacenter proxy, both got instant 403 "Forbidden" with no challenge).
 * This uses `browserFetch()` (Playwright + a residential proxy) instead of
 * a plain HTTP request — see src/engine/browser-fetch.ts for the full
 * empirical trail.
 *
 * `fromAge=1` in the URL plus an `ageInDays > 1` filter enforce "published
 * within the last day" per the explicit requirement.
 *
 * Venezuela location ids discovered the same way as Colombia's (Glassdoor's
 * findPopularLocationAjax.htm lookup, matched to the right department to
 * avoid unrelated same-name places in other countries/departments — e.g.
 * "Valencia" also matches Táchira/Zulia/Sucre/Bolívar entries, only
 * Carabobo is the actual major city).
 *
 * Test:  WEBSHARE_PROXY_URL=... npx tsx src/scrapers/glassdoor-browser-scraper.ts [CO|VE]
 */

import { browserFetch } from "../engine/browser-fetch.js";
import { fileURLToPath } from "url";

export interface GlassdoorJob {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  dateText: string;
  source: "Glassdoor";
  publishedAt: string;
}

export type Country = "CO" | "VE";

interface CountryConfig {
  slug: string;
  countryLocationId: number;
  fallbackLocationName: string;
  cities: { slug: string; locationId: number }[];
}

// City lists match countries/index.ts's per-country `cities` arrays
// (job-filters.ts's CITY_OPTIONS for CO; the VE equivalent).
const COUNTRY_CONFIG: Record<Country, CountryConfig> = {
  CO: {
    slug: "colombia",
    countryLocationId: 54,
    fallbackLocationName: "Colombia",
    cities: [
      { slug: "bogota", locationId: 2821607 },
      { slug: "medellin", locationId: 2809960 },
      { slug: "cali", locationId: 2740110 },
      { slug: "barranquilla", locationId: 2771478 },
      { slug: "cartagena", locationId: 2808022 },
      { slug: "bucaramanga", locationId: 2816222 },
      { slug: "pereira", locationId: 2792968 },
      { slug: "manizales", locationId: 2768339 },
    ],
  },
  VE: {
    slug: "venezuela",
    countryLocationId: 249,
    fallbackLocationName: "Venezuela",
    cities: [
      { slug: "caracas", locationId: 3420636 },
      { slug: "maracaibo", locationId: 3427899 },
      { slug: "valencia", locationId: 3422342 },
      { slug: "barquisimeto", locationId: 3420578 },
      { slug: "maracay", locationId: 3428339 },
      { slug: "ciudad-guayana", locationId: 3421833 },
    ],
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const field = (chunk: string, name: string): string | null => {
  const m = chunk.match(new RegExp(`\\\\"${name}\\\\":\\\\"((?:[^\\\\]|\\\\.)*?)\\\\"`));
  return m ? m[1] : null;
};
const numField = (chunk: string, name: string): number | null => {
  const m = chunk.match(new RegExp(`\\\\"${name}\\\\":(\\d+)`));
  return m ? parseInt(m[1], 10) : null;
};
const unescapeFlight = (s: string): string =>
  s
    .replace(/\\u0026/g, "&")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"');

function parseJobviews(html: string, now: number, fallbackLocationName: string): GlassdoorJob[] {
  const jobs: GlassdoorJob[] = [];
  const chunks = html.split('\\"jobview\\":');
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const ageInDays = numField(chunk, "ageInDays");
    const title = field(chunk, "jobTitleText");
    if (ageInDays === null || ageInDays > 1 || !title) continue;

    const company = field(chunk, "employerNameFromSearch") || "Confidencial";
    const location = field(chunk, "locationName") || fallbackLocationName;
    const listingId = numField(chunk, "listingId");
    let link = field(chunk, "seoJobLink");
    link = link
      ? unescapeFlight(link)
      : listingId
        ? `https://www.glassdoor.com/job-listing/index.htm?jl=${listingId}`
        : "";
    if (!link) continue;

    jobs.push({
      jobId: listingId ? String(listingId) : link,
      title: unescapeFlight(title),
      company: unescapeFlight(company),
      location: unescapeFlight(location),
      url: link,
      dateText: `hace ${ageInDays} día(s)`,
      source: "Glassdoor",
      publishedAt: new Date(now - ageInDays * 24 * 60 * 60 * 1000).toISOString(),
    });
  }
  return jobs;
}

export async function scrapeGlassdoorBrowser(country: Country = "CO"): Promise<GlassdoorJob[]> {
  const config = COUNTRY_CONFIG[country];
  console.log(
    `[GlassdoorBrowser:${country}] Starting multi-query fetch (fromAge=1): country-wide + ${config.cities.length} cities...`
  );
  const jobs: GlassdoorJob[] = [];
  const now = Date.now();

  const countryUrl = `https://www.glassdoor.com/Job/${config.slug}-jobs-SRCH_IL.0,${config.slug.length}_IN${config.countryLocationId}.htm?fromAge=1`;
  try {
    const html = await browserFetch(countryUrl);
    const countryJobs = parseJobviews(html, now, config.fallbackLocationName);
    jobs.push(...countryJobs);
    console.log(`[GlassdoorBrowser:${country}] ${config.fallbackLocationName} (country-wide): ${countryJobs.length} jobs within 1 day.`);
  } catch (error: any) {
    console.error(`[GlassdoorBrowser:${country}] Country-wide query failed: ${error.message}`);
  }

  for (const { slug, locationId } of config.cities) {
    await sleep(1500);
    const url = `https://www.glassdoor.com/Job/${slug}-jobs-SRCH_IL.0,${slug.length}_IC${locationId}.htm?fromAge=1`;
    try {
      const html = await browserFetch(url);
      const cityJobs = parseJobviews(html, now, config.fallbackLocationName);
      jobs.push(...cityJobs);
      console.log(`[GlassdoorBrowser:${country}] ${slug}: ${cityJobs.length} jobs within 1 day (${jobs.length} total so far).`);
    } catch (error: any) {
      console.warn(`[GlassdoorBrowser:${country}] ${slug} failed, skipping: ${error.message}`);
    }
  }

  console.log(`[GlassdoorBrowser:${country}] ✅ Fetch complete: ${jobs.length} jobs (published within 1 day) before dedup.`);
  return jobs;
}

async function main() {
  const country = (process.argv[2] as Country) || "CO";
  const { closeBrowser } = await import("../engine/browser-fetch.js");
  try {
    const jobs = await scrapeGlassdoorBrowser(country);
    console.log(`\nRESULTS: ${jobs.length} jobs found (before dedup)\n`);
    for (const job of jobs.slice(0, 10)) {
      console.log(`  📌 ${job.title} — 🏢 ${job.company} — 📍 ${job.location}`);
    }
    const uniqueUrls = new Set(jobs.map((j) => j.url));
    console.log(`\nTotal: ${jobs.length}, unique URLs: ${uniqueUrls.size}`);
  } finally {
    await closeBrowser();
  }
}

const isDirectEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectEntrypoint) {
  main().catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  });
}
