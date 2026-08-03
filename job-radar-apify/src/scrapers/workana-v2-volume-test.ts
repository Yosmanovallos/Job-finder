/**
 * WorkanaV2 — Volume Discovery Test
 *
 * Fetches ALL available pages for different publication windows
 * to determine the real daily volume Workana offers.
 *
 * Test:  npx tsx src/scrapers/workana-v2-volume-test.ts
 */

import { gotScraping } from "got-scraping";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pageJitter(): Promise<void> {
  await sleep(2000 + Math.random() * 2000);
}

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
        throw new Error(`Blocked: HTTP ${response.statusCode}`);
      }
      if (attempt === attempts) {
        throw new Error(`HTTP ${response.statusCode} after ${attempts} attempts`);
      }
      await sleep(2000 * attempt);
    } catch (error: any) {
      if (error.message?.includes("Blocked")) throw error;
      if (attempt === attempts) throw error;
      await sleep(2000 * attempt);
    }
  }
  throw new Error("Unreachable");
}

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  resultsOnPage: number;
}

async function fetchPageInfo(publication: string, page: number): Promise<{ jobs: number; pagination: PaginationInfo | null; locations: string[] }> {
  const url = `https://www.workana.com/jobs?publication=${publication}&page=${page}`;
  const html = await gsFetchV2(url);

  const startKey = ":results-initials='";
  const startIdx = html.indexOf(startKey);
  if (startIdx === -1) return { jobs: 0, pagination: null, locations: [] };

  const valueStart = startIdx + startKey.length;
  const endIdx = html.indexOf("'", valueStart);
  const rawValue = html.substring(valueStart, endIdx);
  const decoded = rawValue.replaceAll("&quot;", '"').replaceAll("&#39;", "'");

  try {
    const parsed = JSON.parse(decoded);
    const results = parsed.results;
    const jobCount = Array.isArray(results) ? results.length : 0;
    const totalPages = parsed.pagination?.pages ?? 1;

    const locations: string[] = [];
    if (Array.isArray(results)) {
      for (const item of results) {
        const loc = item.country ? item.country.replace(/<[^>]+>/g, "").trim() : "N/A";
        locations.push(loc);
      }
    }

    return {
      jobs: jobCount,
      pagination: { currentPage: page, totalPages, resultsOnPage: jobCount },
      locations
    };
  } catch {
    return { jobs: 0, pagination: null, locations: [] };
  }
}

async function testPublicationWindow(label: string, publication: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Testing: publication=${publication} (${label})`);
  console.log(`${"═".repeat(60)}`);

  // First page to get total
  const firstPage = await fetchPageInfo(publication, 1);
  if (!firstPage.pagination) {
    console.log("  ❌ No data found on page 1");
    return;
  }

  const totalPages = firstPage.pagination.totalPages;
  console.log(`  📊 Page 1: ${firstPage.jobs} jobs | Total pages available: ${totalPages}`);

  let totalJobs = firstPage.jobs;
  const allLocations = [...firstPage.locations];

  // Fetch ALL remaining pages
  for (let page = 2; page <= totalPages; page++) {
    await pageJitter();
    try {
      const pageInfo = await fetchPageInfo(publication, page);
      totalJobs += pageInfo.jobs;
      allLocations.push(...pageInfo.locations);
      console.log(`  📊 Page ${page}/${totalPages}: ${pageInfo.jobs} jobs (${totalJobs} total)`);

      if (pageInfo.jobs === 0) {
        console.log(`  ⏹️  Empty page at ${page} — stopping.`);
        break;
      }
    } catch (err: any) {
      console.log(`  ⚠️  Page ${page} failed: ${err.message} — stopping.`);
      break;
    }
  }

  // Location breakdown
  const locationCounts: Record<string, number> = {};
  for (const loc of allLocations) {
    locationCounts[loc] = (locationCounts[loc] || 0) + 1;
  }
  const sortedLocations = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1]);

  console.log(`\n  ✅ TOTAL: ${totalJobs} jobs across ${totalPages} pages`);
  console.log(`\n  📍 Location breakdown:`);
  for (const [loc, count] of sortedLocations) {
    const pct = ((count / totalJobs) * 100).toFixed(1);
    console.log(`     ${loc}: ${count} (${pct}%)`);
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  WorkanaV2 — Volume Discovery Test                      ║");
  console.log("║  Determines real daily volume per publication window     ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // Test different time windows
  await testPublicationWindow("Últimas 24 horas", "24h");
  await pageJitter();
  await testPublicationWindow("Últimas 48 horas", "48h");
  await pageJitter();
  await testPublicationWindow("Última semana", "1w");

  console.log("\n" + "═".repeat(60));
  console.log("  DONE — Volume discovery complete.");
  console.log("═".repeat(60));
}

main();
