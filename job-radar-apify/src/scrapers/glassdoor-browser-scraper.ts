/**
 * Glassdoor — Browser-Based Global Catalog Scraper
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
 * Test:  WEBSHARE_PROXY_URL=... npx tsx src/scrapers/glassdoor-browser-scraper.ts
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

const GLASSDOOR_COLOMBIA_ID = 54;

// Same 8 cities as job-filters.ts's CITY_OPTIONS — see the abandoned
// got-scraping attempt's comment for how these ids were discovered
// (Glassdoor's findPopularLocationAjax.htm lookup endpoint).
const GLASSDOOR_CITIES: { slug: string; locationId: number }[] = [
  { slug: "bogota", locationId: 2821607 },
  { slug: "medellin", locationId: 2809960 },
  { slug: "cali", locationId: 2740110 },
  { slug: "barranquilla", locationId: 2771478 },
  { slug: "cartagena", locationId: 2808022 },
  { slug: "bucaramanga", locationId: 2816222 },
  { slug: "pereira", locationId: 2792968 },
  { slug: "manizales", locationId: 2768339 },
];

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

function parseJobviews(html: string, now: number): GlassdoorJob[] {
  const jobs: GlassdoorJob[] = [];
  const chunks = html.split('\\"jobview\\":');
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const ageInDays = numField(chunk, "ageInDays");
    const title = field(chunk, "jobTitleText");
    if (ageInDays === null || ageInDays > 1 || !title) continue;

    const company = field(chunk, "employerNameFromSearch") || "Confidencial";
    const location = field(chunk, "locationName") || "Colombia";
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

export async function scrapeGlassdoorBrowser(): Promise<GlassdoorJob[]> {
  console.log(
    `[GlassdoorBrowser] Starting multi-query fetch (fromAge=1): country-wide + ${GLASSDOOR_CITIES.length} cities...`
  );
  const jobs: GlassdoorJob[] = [];
  const now = Date.now();

  const countryUrl = `https://www.glassdoor.com/Job/colombia-jobs-SRCH_IL.0,8_IN${GLASSDOOR_COLOMBIA_ID}.htm?fromAge=1`;
  try {
    const html = await browserFetch(countryUrl);
    const countryJobs = parseJobviews(html, now);
    jobs.push(...countryJobs);
    console.log(`[GlassdoorBrowser] Colombia (country-wide): ${countryJobs.length} jobs within 1 day.`);
  } catch (error: any) {
    console.error(`[GlassdoorBrowser] Country-wide query failed: ${error.message}`);
  }

  for (const { slug, locationId } of GLASSDOOR_CITIES) {
    await sleep(1500);
    const url = `https://www.glassdoor.com/Job/${slug}-jobs-SRCH_IL.0,${slug.length}_IC${locationId}.htm?fromAge=1`;
    try {
      const html = await browserFetch(url);
      const cityJobs = parseJobviews(html, now);
      jobs.push(...cityJobs);
      console.log(`[GlassdoorBrowser] ${slug}: ${cityJobs.length} jobs within 1 day (${jobs.length} total so far).`);
    } catch (error: any) {
      console.warn(`[GlassdoorBrowser] ${slug} failed, skipping: ${error.message}`);
    }
  }

  console.log(`[GlassdoorBrowser] ✅ Fetch complete: ${jobs.length} jobs (published within 1 day) before dedup.`);
  return jobs;
}

async function main() {
  const { closeBrowser } = await import("../engine/browser-fetch.js");
  try {
    const jobs = await scrapeGlassdoorBrowser();
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
