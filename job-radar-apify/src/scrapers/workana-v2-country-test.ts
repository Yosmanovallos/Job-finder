/**
 * WorkanaV2 — Country Volume Test (CO & VE)
 *
 * Tests volume specifically for Colombia and Venezuela using Workana's
 * country filter: ?country=CO or ?country=VE
 *
 * Test:  npx tsx src/scrapers/workana-v2-country-test.ts
 */

import { gotScraping } from "got-scraping";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      if (attempt === attempts) throw new Error(`HTTP ${response.statusCode}`);
      await sleep(2000 * attempt);
    } catch (error: any) {
      if (error.message?.includes("Blocked")) throw error;
      if (attempt === attempts) throw error;
      await sleep(2000 * attempt);
    }
  }
  throw new Error("Unreachable");
}

interface PageResult {
  jobCount: number;
  totalPages: number;
  categories: Record<string, number>;
}

async function fetchPage(country: string, publication: string, page: number): Promise<PageResult> {
  // Workana uses country codes in the URL path AND a query param
  const url = `https://www.workana.com/jobs?country=${country}&publication=${publication}&page=${page}`;
  const html = await gsFetchV2(url);

  const startKey = ":results-initials='";
  const startIdx = html.indexOf(startKey);
  if (startIdx === -1) return { jobCount: 0, totalPages: 0, categories: {} };

  const valueStart = startIdx + startKey.length;
  const endIdx = html.indexOf("'", valueStart);
  const rawValue = html.substring(valueStart, endIdx);
  const decoded = rawValue.replaceAll("&quot;", '"').replaceAll("&#39;", "'");

  try {
    const parsed = JSON.parse(decoded);
    const results = parsed.results;
    const totalPages = parsed.pagination?.pages ?? 0;
    const jobCount = Array.isArray(results) ? results.length : 0;

    const categories: Record<string, number> = {};
    if (Array.isArray(results)) {
      for (const item of results) {
        // Extract category from the item if available
        const cat = item.category
          ? item.category.replace(/<[^>]+>/g, "").trim()
          : "Sin categoría";
        categories[cat] = (categories[cat] || 0) + 1;
      }
    }

    return { jobCount, totalPages, categories };
  } catch {
    return { jobCount: 0, totalPages: 0, categories: {} };
  }
}

async function testCountry(countryCode: string, countryName: string, publication: string, maxPagesToSample: number) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${countryName} (${countryCode}) — publication=${publication}`);
  console.log(`${"═".repeat(60)}`);

  const first = await fetchPage(countryCode, publication, 1);
  if (first.jobCount === 0) {
    console.log(`  ❌ No results found`);
    return { totalPages: 0, estimatedJobs: 0 };
  }

  console.log(`  📊 Page 1: ${first.jobCount} jobs | Total pages: ${first.totalPages}`);
  const estimatedTotal = first.totalPages * first.jobCount;
  console.log(`  📊 Estimated total: ~${estimatedTotal} jobs (${first.totalPages} pages × ~${first.jobCount}/page)`);

  // Sample a few more pages to confirm consistency
  let totalSampled = first.jobCount;
  const allCategories = { ...first.categories };

  for (let page = 2; page <= Math.min(maxPagesToSample, first.totalPages); page++) {
    await sleep(2500 + Math.random() * 1500);
    try {
      const result = await fetchPage(countryCode, publication, page);
      totalSampled += result.jobCount;
      for (const [cat, count] of Object.entries(result.categories)) {
        allCategories[cat] = (allCategories[cat] || 0) + count;
      }
      console.log(`  📊 Page ${page}/${first.totalPages}: ${result.jobCount} jobs (${totalSampled} sampled so far)`);
    } catch (err: any) {
      console.log(`  ⚠️  Page ${page} failed: ${err.message}`);
      break;
    }
  }

  // Category breakdown if available
  const catEntries = Object.entries(allCategories).sort((a, b) => b[1] - a[1]);
  if (catEntries.length > 0 && catEntries[0][0] !== "Sin categoría") {
    console.log(`\n  📂 Categories (from sampled pages):`);
    for (const [cat, count] of catEntries.slice(0, 10)) {
      console.log(`     ${cat}: ${count}`);
    }
  }

  return { totalPages: first.totalPages, estimatedJobs: estimatedTotal };
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  WorkanaV2 — Country Volume Test (CO & VE)              ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const results: Record<string, Record<string, { totalPages: number; estimatedJobs: number }>> = {};

  // Test both countries with 24h and 48h windows
  for (const [code, name] of [["CO", "Colombia"], ["VE", "Venezuela"]]) {
    results[code] = {};
    for (const pub of ["24h", "48h"]) {
      const r = await testCountry(code, name, pub, 5);
      results[code][pub] = r;
      await sleep(3000);
    }
  }

  // Also test "Remoto" which Workana offers as a filter
  // Try with the remote filter
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Remoto (remote) — publication=24h`);
  console.log(`${"═".repeat(60)}`);

  try {
    const url = `https://www.workana.com/jobs?country=undefined&publication=24h&remote=true&page=1`;
    const html = await gsFetchV2(url);
    const startKey = ":results-initials='";
    const startIdx = html.indexOf(startKey);
    if (startIdx !== -1) {
      const valueStart = startIdx + startKey.length;
      const endIdx = html.indexOf("'", valueStart);
      const rawValue = html.substring(valueStart, endIdx);
      const decoded = rawValue.replaceAll("&quot;", '"').replaceAll("&#39;", "'");
      const parsed = JSON.parse(decoded);
      const totalPages = parsed.pagination?.pages ?? 0;
      const jobCount = Array.isArray(parsed.results) ? parsed.results.length : 0;
      console.log(`  📊 Remote jobs: ${jobCount} on page 1 | Total pages: ${totalPages} | Est: ~${totalPages * jobCount}`);
    } else {
      console.log("  ⚠️  No results-initials found for remote filter");
    }
  } catch (err: any) {
    console.log(`  ⚠️  Remote filter test failed: ${err.message}`);
  }

  // Summary table
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  SUMMARY`);
  console.log(`${"═".repeat(60)}`);
  console.log(`\n  | País | Ventana | Páginas | Est. Vacantes |`);
  console.log(`  |------|---------|---------|---------------|`);
  for (const [code, windows] of Object.entries(results)) {
    for (const [pub, data] of Object.entries(windows)) {
      console.log(`  | ${code} | ${pub} | ${data.totalPages} | ~${data.estimatedJobs} |`);
    }
  }
  console.log();
}

main().catch((err) => {
  console.error(`\n❌ FAILED: ${err.message}`);
  process.exit(1);
});
