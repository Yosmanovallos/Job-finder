/**
 * Browser-based scrape tick — Glassdoor + Indeed, Colombia AND Venezuela,
 * via Playwright + a residential proxy (see src/engine/browser-fetch.ts for
 * why this exists as a completely separate path from
 * scripts/run-scrape-tick.ts).
 *
 * Deliberately its own script/workflow, not folded into the fast 15-min
 * tick: a headless browser is much heavier per request (real Chromium
 * process, several seconds/page) than the got-scraping/fetch-based
 * adapters, and would risk that tick's 3-minute global-catalog budget and
 * 27-minute workflow ceiling. Runs on its own cron
 * (.github/workflows/scrape-browser-tick.yml, every 2 days) and writes to
 * the exact same `jobs` table via the same saveJobs() dedupe pipeline — a
 * job found here and later re-found by the fast tick (or vice versa)
 * merges via the existing url_hash/content_fingerprint logic, same as any
 * two sources always have.
 *
 * CO and VE run as four separate fetches (not one combined query per
 * source) — each scraper function is parameterized by country and queries
 * that country's own city set, so a job's country is known directly from
 * which query found it, not inferred from location text. This mirrors why
 * the fast tick keeps CO/VE as separate ticks (scrape-jobs.yml /
 * scrape-jobs-ve.yml) rather than one merged run.
 *
 * Stateless like run-scrape-tick.ts: no in-process retry across runs, no
 * per-source due-check (the 2-day cron cadence IS the due-check) — if a
 * run fails partway, whatever it already saved is safe (saveJobs saves
 * per-source, not batched at the end), and the next scheduled run just
 * tries again.
 */
import fs from "fs";
import dotenv from "dotenv";
import { scrapeGlassdoorBrowser, type Country } from "../src/scrapers/glassdoor-browser-scraper.js";
import { scrapeIndeedBrowser } from "../src/scrapers/indeed-browser-scraper.js";
import { closeBrowser } from "../src/engine/browser-fetch.js";
import { deduplicateJobs } from "../src/sources/types.js";
import { saveJobs } from "../src/db/job-repository.js";
import { pool } from "../src/db/client.js";

dotenv.config();

interface SourceResult {
  label: string;
  fetched: number;
  savedCount: number;
  duplicateCount: number;
  error?: string;
}

async function runSource(
  label: string,
  country: Country,
  fetcher: () => Promise<any[]>
): Promise<SourceResult> {
  try {
    const raw = await fetcher();
    const jobs = deduplicateJobs(raw);
    for (const job of jobs) {
      // Both sources are genuinely country-scoped per query (each URL
      // filters to a specific city or country, unlike Workana's global
      // freelance catalog) — the country the query itself targeted is the
      // correct stamp directly, no isRemoteLocation() guessing needed. A
      // job whose own location text says "remoto" would still be a real
      // CO/VE-market remote posting (surfaced by that country's search),
      // not a leak the way Workana's cross-country catalog was.
      job.country = country;
    }
    const fetched = jobs.length;
    if (fetched === 0) {
      return { label, fetched: 0, savedCount: 0, duplicateCount: 0 };
    }
    const { savedCount, duplicateCount } = await saveJobs(jobs, "General");
    return { label, fetched, savedCount, duplicateCount };
  } catch (err: any) {
    console.error(`❌ [BrowserTick] ${label} failed:`, err?.message || err);
    return { label, fetched: 0, savedCount: 0, duplicateCount: 0, error: err?.message || String(err) };
  }
}

function writeSummary(results: SourceResult[]) {
  const lines: string[] = [];
  lines.push(`## 🌐 Browser scrape tick — ${new Date().toISOString()}`);
  lines.push("");
  lines.push("| Fuente | Vacantes obtenidas | Nuevas | Duplicadas | Errores |");
  lines.push("|---|---|---|---|---|");
  for (const r of results) {
    const flag = r.fetched === 0 ? " ⚠️ posible bloqueo/caída (0 resultados)" : "";
    lines.push(`| ${r.label} | ${r.fetched} | ${r.savedCount} | ${r.duplicateCount} | ${r.error ? "1" + flag : "0" + flag} |`);
  }
  const summary = lines.join("\n");
  console.log("\n" + summary + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  }
  for (const r of results) {
    if (r.fetched === 0) {
      console.log(`::warning title=Fuente posiblemente bloqueada::${r.label} devolvió 0 vacantes en este tick${r.error ? ` (${r.error})` : ""}.`);
    }
  }
}

async function main() {
  console.log(`🌐 [BrowserTick] Starting — Glassdoor + Indeed (CO + VE) via Playwright + residential proxy`);

  const results: SourceResult[] = [];
  results.push(await runSource("Glassdoor-CO", "CO", () => scrapeGlassdoorBrowser("CO")));
  results.push(await runSource("Glassdoor-VE", "VE", () => scrapeGlassdoorBrowser("VE")));
  results.push(await runSource("Indeed-CO", "CO", () => scrapeIndeedBrowser("CO")));
  results.push(await runSource("Indeed-VE", "VE", () => scrapeIndeedBrowser("VE")));

  writeSummary(results);

  await closeBrowser();
  await pool.end();
}

main().catch(async (err) => {
  console.error("❌ [BrowserTick] Unexpected error:", err?.message || err);
  await closeBrowser();
  await pool.end();
  process.exit(1);
});
