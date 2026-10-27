/**
 * ATS board inventory, phase I1 (openspec/changes/ats-inventory-co-2026-11,
 * ADR 0006 §13): board references found from the ATS side — Common Crawl,
 * ATS links in live job-board rows and site-probe evidence — independent of
 * job-board company names. Nothing is probed or enabled (phase I2).
 *
 * DRY RUN by default: reads only, prints counts by source, ATS and initial
 * status, and how many rows would be new. It works before the table exists.
 * `--execute` writes ats_board_inventory only (idempotent insert).
 *
 *   npx tsx scripts/direct-ats-inventory.ts [--sources commoncrawl,job_link,site_probe]
 *       [--cc-max-pages 3] [--job-link-limit 50000] [--deadline-min 15] [--execute] [--allow-remote-db]
 */
import dotenv from "dotenv";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import { CC_PATTERNS, cdxUrls, httpCdxGet, latestCrawls } from "../src/direct/discovery/cc-index.js";
import {
  collectInventory,
  INVENTORY_SOURCES,
  inventoryKey,
  summarizeInventory,
  type InventorySighting,
  type InventorySource,
  type SourceState
} from "../src/direct/discovery/inventory.js";

dotenv.config();

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function boundedInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(argValue(name) ?? fallback);
  return Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;
}

function selectedSources(): InventorySource[] {
  const raw = argValue("--sources");
  if (!raw) return [...INVENTORY_SOURCES];
  const picked = raw.split(",").map((value) => value.trim());
  const unknown = picked.filter((value) => !(INVENTORY_SOURCES as readonly string[]).includes(value));
  if (unknown.length) throw new Error(`fuente desconocida: ${unknown.join(", ")}`);
  return picked as InventorySource[];
}

/** Common Crawl URLs for every pattern; "no_data" when no pattern got an answer from the index. */
async function commonCrawl(deadline: number, maxPages: number): Promise<{ urls: string[]; state: SourceState }> {
  const get = httpCdxGet(deadline);
  const crawls = await latestCrawls(get);
  if (crawls.length === 0) {
    console.log("[ats-inventory] commoncrawl: el índice no respondió (collinfo) — sin datos, no es \"cero tableros\".");
    return { urls: [], state: "no_data" };
  }
  const urls: string[] = [];
  let answered = 0;
  for (const { atsType, pattern } of CC_PATTERNS) {
    if (Date.now() > deadline) {
      console.log(`[ats-inventory] commoncrawl: plazo cumplido antes de ${pattern} — sin datos para ese patrón.`);
      continue;
    }
    let found: string[] | null = null;
    let used = "";
    for (const crawl of crawls) {
      found = await cdxUrls(get, crawl, pattern, { deadline, maxPages, pauseMs: 2_000 });
      if (found) {
        used = crawl;
        break;
      }
    }
    if (!found) {
      console.log(`[ats-inventory] commoncrawl ${atsType} (${pattern}): sin datos en ${crawls.join(", ")}.`);
      continue;
    }
    answered++;
    urls.push(...found);
    console.log(`[ats-inventory] commoncrawl ${atsType} (${pattern}): ${found.length} URLs en ${used}.`);
  }
  return { urls, state: answered > 0 ? "ok" : "no_data" };
}

function printCounts(title: string, counts: Record<string, number | null>): void {
  console.log(title);
  for (const [key, value] of Object.entries(counts).sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1))) {
    console.log(`  ${key.padEnd(18)} ${value === null ? "sin datos" : value}`);
  }
}

async function main() {
  const execute = process.argv.includes("--execute");
  const sources = selectedSources();
  const deadline = Date.now() + boundedInt("--deadline-min", 15, 1, 17) * 60_000;
  const ccMaxPages = boundedInt("--cc-max-pages", 3, 1, 50);
  const jobLinkLimit = boundedInt("--job-link-limit", 50_000, 1, 200_000);
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const repo = await import("../src/db/direct-inventory-repository.js");
  const { pool } = await import("../src/db/client.js");

  try {
    const sightings: InventorySighting[] = [];
    const state = Object.fromEntries(INVENTORY_SOURCES.map((source) => [source, "skipped"])) as Record<InventorySource, SourceState>;

    if (sources.includes("job_link")) {
      const urls = await repo.jobLinkUrls(jobLinkLimit);
      sightings.push(...urls.map((url) => ({ url, source: "job_link" as const })));
      state.job_link = "ok";
      console.log(`[ats-inventory] job_link: ${urls.length} URLs de ATS en vacantes vigentes${urls.length >= jobLinkLimit ? " (tope alcanzado)" : ""}.`);
    }
    if (sources.includes("site_probe")) {
      const refs = await repo.siteProbeRefs();
      sightings.push(...refs.map((ref) => ({ ...ref, source: "site_probe" as const })));
      state.site_probe = "ok";
      console.log(`[ats-inventory] site_probe: ${refs.length} tableros enlazados desde sitios de empresas.`);
    }
    if (sources.includes("commoncrawl")) {
      const cc = await commonCrawl(deadline, ccMaxPages);
      sightings.push(...cc.urls.map((url) => ({ url, source: "commoncrawl" as const })));
      state.commoncrawl = cc.state;
    }

    const rows = collectInventory(sightings);
    const owned = await repo.ownedBoardKeys();
    const summary = summarizeInventory(rows, owned, state);
    console.log(`\n[ats-inventory] ${summary.total} tableros distintos.`);
    printCounts("Por fuente (un tablero cuenta en cada fuente que lo nombró):", summary.bySource);
    printCounts("Por ATS:", summary.byAts);
    printCounts("Por estado inicial:", summary.byStatus);

    if (!(await repo.inventoryTableExists())) {
      if (execute) throw new Error("ats_board_inventory no existe: aplica antes la migración (modo migrate).");
      console.log(`\n[ats-inventory] --dry-run: la tabla aún no existe; se insertarían ${rows.length} filas. Nada se escribió.`);
      return;
    }
    const existing = await repo.existingInventoryKeys();
    const fresh = rows.filter((row) => !existing.has(inventoryKey(row.atsType, row.atsRef))).length;
    if (!execute) {
      console.log(`\n[ats-inventory] --dry-run: ${fresh} filas nuevas, ${rows.length - fresh} ya registradas. Nada se escribió.`);
      return;
    }
    const written = await repo.insertInventory(rows, owned);
    console.log(`\n[ats-inventory] Escrito: ${written.inserted} filas nuevas · ${written.sourcesAdded} con una procedencia nueva.`);
    console.log("[ats-inventory] Ningún tablero se habilitó: el sondeo y la habilitación son la fase I2.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[ats-inventory] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
