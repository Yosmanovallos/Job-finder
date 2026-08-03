/**
 * Indeed — Browser-Based Global Catalog Scraper
 *
 * Unlike Glassdoor, this uses Indeed's normal dynamic search endpoint
 * (`co.indeed.com/jobs?l=<city>&fromage=1`, NO keyword) directly — no need
 * for the SEO-landing-page workaround explored earlier, because the real
 * blocker was never the endpoint shape, it was the request never reaching
 * past Cloudflare (see src/engine/browser-fetch.ts for the full trail:
 * datacenter IP -> flat 403, residential IP + plain HTTP -> JS challenge,
 * residential IP + real browser -> 200 with real data, confirmed directly
 * against this exact endpoint).
 *
 * Coverage comes from querying by city (same list as Glassdoor's, matching
 * job-filters.ts's CITY_OPTIONS) plus a country-wide catch-all — robots.txt
 * (see docs/source-catalog/indeed.md) disallows `/*&start=` (pagination),
 * so this does not paginate; city diversification is the substitute,
 * same approach as Glassdoor.
 *
 * `fromage=1` in the URL plus an `ageInDays > 1` filter (computed from
 * `pubDate`, epoch ms) enforce "published within the last day" per the
 * explicit requirement — not the 2-day window src/index.ts's
 * scrapeIndeedLocal uses.
 *
 * Parsing logic (marker string, extractBalancedObject) duplicated from
 * src/index.ts's scrapeIndeedLocal rather than imported — that function is
 * module-private, and every other V2/browser scraper in this codebase is
 * self-contained by the same convention (safe to delete without touching
 * index.ts).
 *
 * Test:  WEBSHARE_PROXY_URL=... npx tsx src/scrapers/indeed-browser-scraper.ts
 */

import { browserFetch } from "../engine/browser-fetch.js";
import { fileURLToPath } from "url";

export interface IndeedJob {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  dateText: string;
  source: "Indeed";
  publishedAt: string;
}

// Same cities as glassdoor-browser-scraper.ts / job-filters.ts's
// CITY_OPTIONS — Indeed's `l=` param takes a plain place name, no id
// lookup needed (simpler than Glassdoor's locationId).
const CITIES = [
  "Bogotá",
  "Medellín",
  "Cali",
  "Barranquilla",
  "Cartagena",
  "Bucaramanga",
  "Pereira",
  "Manizales",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function htmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extracts a balanced `{...}` object starting at `fromIdx` (first `{`). */
function extractBalancedObject(html: string, fromIdx: number): string | null {
  let depth = 0;
  let started = false;
  for (let i = fromIdx; i < html.length; i++) {
    const c = html[i];
    if (c === "{") {
      depth++;
      started = true;
    } else if (c === "}") {
      depth--;
      if (started && depth === 0) return html.slice(fromIdx, i + 1);
    }
  }
  return null;
}

function parseJobcards(html: string, now: number): IndeedJob[] {
  const jobs: IndeedJob[] = [];
  const marker = 'window.mosaic.providerData["mosaic-provider-jobcards"]=';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return jobs;

  const jsonStr = extractBalancedObject(html, markerIdx + marker.length);
  if (!jsonStr) return jobs;

  let data: any;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    return jobs;
  }
  const results = data?.metaData?.mosaicProviderJobCardsModel?.results;
  if (!Array.isArray(results)) return jobs;

  for (const r of results) {
    if (!r.jobkey || !r.title || !r.pubDate) continue;
    const ageInDays = (now - r.pubDate) / (1000 * 60 * 60 * 24);
    if (ageInDays > 1) continue;

    const location = r.remoteLocation ? "Remoto" : r.formattedLocation || "Colombia";
    jobs.push({
      jobId: r.jobkey,
      title: htmlEntities(r.title),
      company: htmlEntities(r.company || "Confidencial"),
      location: htmlEntities(location),
      url: `https://co.indeed.com/viewjob?jk=${r.jobkey}`,
      dateText: r.formattedRelativeTime || "Reciente",
      source: "Indeed",
      publishedAt: new Date(r.pubDate).toISOString(),
    });
  }
  return jobs;
}

export async function scrapeIndeedBrowser(): Promise<IndeedJob[]> {
  console.log(`[IndeedBrowser] Starting multi-query fetch (fromage=1): country-wide + ${CITIES.length} cities...`);
  const jobs: IndeedJob[] = [];
  const now = Date.now();

  const countryUrl = `https://co.indeed.com/jobs?l=Colombia&fromage=1`;
  try {
    const html = await browserFetch(countryUrl);
    const countryJobs = parseJobcards(html, now);
    jobs.push(...countryJobs);
    console.log(`[IndeedBrowser] Colombia (country-wide): ${countryJobs.length} jobs within 1 day.`);
  } catch (error: any) {
    console.error(`[IndeedBrowser] Country-wide query failed: ${error.message}`);
  }

  for (const city of CITIES) {
    await sleep(1500);
    const url = `https://co.indeed.com/jobs?l=${encodeURIComponent(city)}&fromage=1`;
    try {
      const html = await browserFetch(url);
      const cityJobs = parseJobcards(html, now);
      jobs.push(...cityJobs);
      console.log(`[IndeedBrowser] ${city}: ${cityJobs.length} jobs within 1 day (${jobs.length} total so far).`);
    } catch (error: any) {
      console.warn(`[IndeedBrowser] ${city} failed, skipping: ${error.message}`);
    }
  }

  console.log(`[IndeedBrowser] ✅ Fetch complete: ${jobs.length} jobs (published within 1 day) before dedup.`);
  return jobs;
}

async function main() {
  const { closeBrowser } = await import("../engine/browser-fetch.js");
  try {
    const jobs = await scrapeIndeedBrowser();
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
