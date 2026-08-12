/**
 * WorkanaV2 — Global Catalog Daily Ingestion Scraper (POC)
 *
 * Strategy: instead of sending 60+ keyword-specific requests that trigger
 * Cloudflare's WAF, this scraper fetches the FULL daily catalog with a
 * single paginated pass (no keyword filter) and lets the downstream
 * pipeline (saveJobs / dashboard filters) handle classification.
 *
 * Key differences from the original scrapeWorkana:
 *   - Uses `got-scraping` for real browser TLS/JA3 fingerprint mimicking
 *     (same technique that already works for Indeed and Glassdoor).
 *   - Fetches `?publication=24h` with NO keyword → one global pass.
 *   - 2-4s jitter between pages to simulate human browsing.
 *   - Max 10 pages → up to ~200 postings per run.
 *   - Runs as a GLOBAL source (once every 4h), not per-role.
 *
 * This file is 100% self-contained — it does NOT import from index.ts
 * and does NOT modify any existing file. Safe to delete without side effects.
 *
 * Test:  npx tsx src/scrapers/workana-v2-scraper.ts
 */

import { gotScraping } from "got-scraping";
import { fileURLToPath } from "url";
import { extractStructuredFromHtml } from "../utils.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkanaJob {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  dateText: string;
  source: "Workana";
  publishedAt: string;
  // The catalog payload (:results-initials) already carries these per item
  // — confirmed live, 2026-08-11 — so no per-job detail-page fetch is
  // needed, unlike most other HTML-scraped sources.
  description?: string;
  requirements?: string[];
  technologies?: string[];
  employmentType?: string;
  salaryRaw?: string;
}

// ─── HTML entity decoder (subset needed for Workana payloads) ────────────────

function decodeEntities(str: string): string {
  if (!str) return "";
  return str
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&#225;", "á")
    .replaceAll("&#233;", "é")
    .replaceAll("&#237;", "í")
    .replaceAll("&#243;", "ó")
    .replaceAll("&#250;", "ú")
    .replaceAll("&#241;", "ñ")
    .replaceAll("&#193;", "Á")
    .replaceAll("&#201;", "É")
    .replaceAll("&#205;", "Í")
    .replaceAll("&#211;", "Ó")
    .replaceAll("&#218;", "Ú")
    .replaceAll("&#209;", "Ñ");
}

// ─── got-scraping fetch with retry / backoff ────────────────────────────────

/**
 * Fetch a URL with got-scraping (real browser TLS fingerprint).
 * Retries transient errors (429/5xx) with backoff; fails fast on 401/403.
 */
async function gsFetchV2(url: string, attempts = 3): Promise<string> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await gotScraping({
        url,
        timeout: { request: 30_000 },
        retry: { limit: 0 },
        headerGeneratorOptions: {
          browsers: [{ name: "chrome", minVersion: 118 }],
          operatingSystems: ["windows"],
          locales: ["es-CO", "es", "en-US"],
        },
      });

      if (response.statusCode === 200) return response.body;

      if (response.statusCode === 401 || response.statusCode === 403) {
        console.warn(
          `[WorkanaV2] Blocked: HTTP ${response.statusCode} — not retrying.`
        );
        throw new Error(
          `[WorkanaV2] Blocked: HTTP ${response.statusCode} (deny, not a hiccup)`
        );
      }

      if (attempt === attempts) {
        throw new Error(
          `[WorkanaV2] HTTP ${response.statusCode} after ${attempts} attempts`
        );
      }

      // Backoff before retry (only for transient 429/5xx)
      const backoffMs = 2000 * attempt;
      console.log(
        `[WorkanaV2] HTTP ${response.statusCode}, retrying in ${backoffMs / 1000}s (attempt ${attempt}/${attempts})...`
      );
      await sleep(backoffMs);
    } catch (error: any) {
      if (error.message?.includes("Blocked")) throw error;
      if (attempt === attempts) {
        console.error(
          `[WorkanaV2] Fetch error after ${attempts} attempts:`,
          error?.message || error
        );
        throw error;
      }
      await sleep(2000 * attempt);
    }
  }
  throw new Error("[WorkanaV2] Unreachable");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random jitter between pages to mimic human browsing. */
async function pageJitter(minMs = 2000, maxMs = 4000): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  await sleep(delay);
}

/**
 * Parse a relative date string (Spanish/English) into an ISO timestamp.
 * Returns null if the date can't be parsed.
 */
function parseRelativeDate(dateText: string): string | null {
  const now = new Date();
  const text = dateText.toLowerCase();
  const numMatch = text.match(/(\d+)/);
  const num = numMatch ? parseInt(numMatch[1], 10) : 1;

  let hoursAgo = 0;

  if (
    text.includes("second") ||
    text.includes("segundo") ||
    text.includes("minute") ||
    text.includes("minuto") ||
    text.includes("now") ||
    text.includes("hoy") ||
    text.includes("just")
  ) {
    hoursAgo = 0;
  } else if (text.includes("hour") || text.includes("hora")) {
    hoursAgo = num;
  } else if (
    text.includes("yesterday") ||
    text.includes("ayer") ||
    text.includes("1 day") ||
    text.includes("1 día") ||
    text.includes("1 dia")
  ) {
    hoursAgo = 24;
  } else if (
    text.includes("day") ||
    text.includes("día") ||
    text.includes("dia")
  ) {
    hoursAgo = num * 24;
    // For this POC, accept up to 3 days
    if (num > 3) return null;
  } else if (text.includes("week") || text.includes("semana")) {
    hoursAgo = num * 7 * 24;
    if (num > 1) return null; // Too old for daily catalog
  } else {
    // Unknown format, assume today
    hoursAgo = 0;
  }

  const targetDate = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
  return targetDate.toISOString();
}

// ─── Core Scraper ───────────────────────────────────────────────────────────

/**
 * Scrapes the Workana daily catalog globally (no keyword filter).
 * Paginates `?publication=24h&page=1..maxPages` using got-scraping for
 * TLS fingerprint mimicking to bypass Cloudflare.
 *
 * @param maxPages  Maximum pages to fetch (default: 10, ~20 results/page).
 * @returns Array of WorkanaJob objects from the last 24 hours.
 */
export async function scrapeWorkanaV2(
  maxPages: number = 10
): Promise<WorkanaJob[]> {
  console.log(
    `[WorkanaV2] Starting global catalog fetch (publication=24h, up to ${maxPages} pages)...`
  );
  const jobs: WorkanaJob[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://www.workana.com/jobs?publication=24h&page=${page}`;
    console.log(`[WorkanaV2] Fetching page ${page}...`);

    let html: string;
    try {
      html = await gsFetchV2(url);
    } catch (error: any) {
      if (page === 1) {
        // If page 1 fails, nothing to return — propagate
        console.error(`[WorkanaV2] Page 1 failed — aborting: ${error.message}`);
        throw error;
      }
      // Pages 2+ failing just means no more results
      console.warn(
        `[WorkanaV2] Page ${page} failed, stopping pagination: ${error.message}`
      );
      break;
    }

    // ── Parse the Vue inline payload (:results-initials='...') ──

    const startKey = ":results-initials='";
    const startIdx = html.indexOf(startKey);
    if (startIdx === -1) {
      if (page === 1) {
        console.warn(
          "[WorkanaV2] :results-initials payload not found on page 1 — Workana may have changed its frontend layout."
        );
      }
      break;
    }

    const valueStart = startIdx + startKey.length;
    const endIdx = html.indexOf("'", valueStart);
    if (endIdx === -1) {
      console.warn(`[WorkanaV2] Unterminated :results-initials on page ${page}`);
      break;
    }

    const rawValue = html.substring(valueStart, endIdx);
    const decodedValue = rawValue
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'");

    let parsed: any;
    try {
      parsed = JSON.parse(decodedValue);
    } catch (parseError) {
      console.warn(
        `[WorkanaV2] JSON parse failed on page ${page} — stopping pagination.`
      );
      break;
    }

    const results = parsed.results;
    if (!Array.isArray(results) || results.length === 0) {
      console.log(`[WorkanaV2] No results on page ${page} — done.`);
      break;
    }

    // ── Transform each item into a WorkanaJob ──

    let pageCount = 0;
    for (const item of results) {
      // Title: may be wrapped in an <a> tag with href and title attributes
      const titleMatch = item.title
        ? item.title.match(/title="([^"]+)"/)
        : null;
      const title = titleMatch
        ? titleMatch[1]
        : (item.title || "").replace(/<[^>]+>/g, "").trim();

      if (!title) continue;

      // URL: extract href from the title's <a> tag, or build from slug
      const urlMatch = item.title
        ? item.title.match(/href="([^"]+)"/)
        : null;
      const jobUrl = urlMatch
        ? `https://www.workana.com${urlMatch[1]}`
        : `https://www.workana.com/job/${item.slug}`;

      // Company
      const company = item.authorName || "Confidencial";

      // Location: strip HTML tags from the country field
      const countryText = item.country
        ? item.country.replace(/<[^>]+>/g, "").trim()
        : "No especificado";

      // Date
      const rawDateText = item.publishedDate
        ? item.publishedDate.replace("Publicado: ", "").trim()
        : "Hoy";
      const dateText = decodeEntities(rawDateText);
      const publishedAt = parseRelativeDate(dateText);

      if (!publishedAt) continue; // Too old, skip

      const { description, requirements } = extractStructuredFromHtml(item.description || "");
      const skills: string[] = Array.isArray(item.skills)
        ? item.skills.map((s: any) => s?.anchorText).filter((n: unknown): n is string => typeof n === "string")
        : [];

      jobs.push({
        jobId: item.slug || `workana-${Math.random().toString(36).substring(7)}`,
        title: decodeEntities(title),
        company: decodeEntities(company),
        location: decodeEntities(countryText),
        url: jobUrl,
        dateText,
        source: "Workana",
        publishedAt,
        description: description || undefined,
        requirements: requirements.length > 0 ? requirements : undefined,
        technologies: skills.length > 0 ? skills : undefined,
        // Workana projects are freelance work, not traditional employment —
        // `isHourly` (a real boolean the catalog already provides) is the
        // one real distinction available, not a schema.org employment type.
        employmentType: typeof item.isHourly === "boolean" ? (item.isHourly ? "Por hora" : "Proyecto") : undefined,
        // `budget` is Workana's own free-text range (e.g. "USD 250 - 500",
        // "USD 15 - 45 / hora") — stored as-is, no attempt to parse it into
        // numbers across its several formats.
        salaryRaw: typeof item.budget === "string" && item.budget.trim() ? item.budget.trim() : undefined
      });
      pageCount++;
    }

    console.log(
      `[WorkanaV2] Page ${page}: ${pageCount} jobs extracted (${jobs.length} total so far).`
    );

    // Respect pagination limits from the response
    const totalPages = parsed.pagination?.pages ?? page;
    if (page >= totalPages) {
      console.log(
        `[WorkanaV2] Reached last page (${totalPages}) — done.`
      );
      break;
    }

    // Jitter between pages to mimic human browsing
    if (page < maxPages) {
      await pageJitter();
    }
  }

  console.log(
    `[WorkanaV2] ✅ Scraping complete: ${jobs.length} jobs from Workana's daily catalog.`
  );
  return jobs;
}

// ─── Standalone test entrypoint ─────────────────────────────────────────────

async function main() {
  console.log("=".repeat(70));
  console.log("  WorkanaV2 POC — Global Catalog Daily Ingestion Test");
  console.log("=".repeat(70));
  console.log();

  try {
    const jobs = await scrapeWorkanaV2(3); // Only 3 pages for the test

    console.log();
    console.log("=".repeat(70));
    console.log(`  RESULTS: ${jobs.length} jobs found`);
    console.log("=".repeat(70));

    if (jobs.length === 0) {
      console.log(
        "\n⚠️  No jobs returned. Possible causes:\n" +
          "   - Cloudflare still blocking (check for 403 above)\n" +
          "   - Workana changed its frontend layout (:results-initials missing)\n" +
          "   - No recent publications in the last 24h (unlikely)\n"
      );
      return;
    }

    // Print a sample (first 10)
    const sample = jobs.slice(0, 10);
    console.log(`\nFirst ${sample.length} jobs:\n`);
    for (const job of sample) {
      console.log(`  📌 ${job.title}`);
      console.log(`     🏢 ${job.company} | 📍 ${job.location}`);
      console.log(`     🔗 ${job.url}`);
      console.log(`     📅 ${job.dateText} → ${job.publishedAt}`);
      console.log();
    }

    // Stats
    const companies = new Set(jobs.map((j) => j.company));
    const locations = new Set(jobs.map((j) => j.location));
    console.log("─".repeat(40));
    console.log(`  Total jobs:       ${jobs.length}`);
    console.log(`  Unique companies: ${companies.size}`);
    console.log(`  Unique locations: ${locations.size}`);
    console.log("─".repeat(40));
  } catch (error: any) {
    console.error(`\n❌ FAILED: ${error.message}`);
    if (error.message.includes("Blocked")) {
      console.error(
        "\n   got-scraping was also blocked by Cloudflare.\n" +
          "   Next step: try session cookie authentication.\n"
      );
    }
    process.exit(1);
  }
}

const isDirectEntrypoint =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectEntrypoint) {
  main();
}
