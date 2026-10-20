/**
 * Official-vacancy tick (docs/adr/0006-direct-employers.md): reads each due
 * employer board from its public ATS API, stores the live Colombian postings
 * in direct_jobs, closes postings missing from 2 complete listings, purges
 * closed rows. Never writes `jobs`. Never imported by the web server.
 *
 *   npx tsx scripts/run-direct-tick.ts --dry-run [--employer slug] [--include-disabled]
 *       Reads the boards listed in the seed file, prints what WOULD be stored.
 *       No database at all.
 *   npx tsx scripts/run-direct-tick.ts [--employer slug] [--limit N] [--force]
 *       Local database only (see src/direct/db-guard.ts); --force ignores the
 *       per-board interval.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { listBoard } from "../src/direct/connectors.js";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import { boundedGet } from "../src/direct/http.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import { parseEmployerSeed } from "../src/direct/seed.js";
import type { SourceReport } from "../src/direct/tick.js";

dotenv.config();

// Boards per tick and minimum hours between two reads of the same board.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const MIN_INTERVAL_HOURS = 6;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function dryRun(employerSlug: string | undefined): Promise<void> {
  const seeds = parseEmployerSeed(
    JSON.parse(await readFile(new URL("../data/direct-employers.seed.json", import.meta.url), "utf8"))
  );
  const includeDisabled = process.argv.includes("--include-disabled");
  let total = 0;
  for (const seed of seeds) {
    if (employerSlug && seed.slug !== employerSlug) continue;
    for (const source of seed.sources) {
      if (!source.enabled && !includeDisabled) continue;
      const listing = await listBoard(source, boundedGet);
      const board = `${source.atsType}:${source.atsRef}${source.enabled ? "" : " (off)"}`;
      if (listing.kind !== "complete") {
        console.log(`  ${seed.slug.padEnd(16)} ${board.padEnd(32)} ${listing.kind}: ${listing.detail}`);
        continue;
      }
      const { postings, stats } = selectColombianPostings(listing.postings);
      total += postings.length;
      console.log(
        `  ${seed.slug.padEnd(16)} ${board.padEnd(32)} tablero ${String(stats.boardTotal).padStart(4)} · ` +
          `Colombia vigentes ${String(stats.kept).padStart(3)} · fuera de Colombia ${stats.notColombia} · >30 días/vencidas ${stats.stale}`
      );
      for (const posting of postings.slice(0, 2)) {
        console.log(
          `      - ${posting.title} | ${posting.city ?? posting.locationRaw} | ${posting.workplace ?? "modalidad no indicada"} | ` +
            `${posting.publishedAt?.slice(0, 10) ?? "fecha no indicada"}`
        );
      }
    }
  }
  console.log(`[direct-tick] --dry-run: ${total} vacantes oficiales vigentes en Colombia. No se escribió nada.`);
}

function printReports(reports: SourceReport[], purged: number): void {
  let inserted = 0;
  let closed = 0;
  for (const report of reports.sort((a, b) => a.employer.localeCompare(b.employer))) {
    inserted += report.saved?.inserted ?? 0;
    closed += report.saved?.closed ?? 0;
    const saved = report.saved
      ? `+${report.saved.inserted} nuevas · ${report.saved.updated} vistas · ${report.saved.markedMissing} ausentes · ${report.saved.closed} cerradas`
      : "";
    console.log(
      `  ${report.employer.padEnd(16)} ${report.board.padEnd(28)} ${report.status.padEnd(9)} ` +
        `${report.stats ? `CO ${report.stats.kept}/${report.stats.boardTotal} · ` : ""}${saved}${report.detail ? ` · ${report.detail}` : ""}`
    );
  }
  const failed = reports.filter((report) => report.status === "error" || report.status === "not_found").length;
  console.log(
    `[direct-tick] OK — ${reports.length} tableros (${failed} con falla), ${inserted} vacantes nuevas, ` +
      `${closed} cerradas, ${purged} purgadas.`
  );
}

async function main() {
  const employerSlug = argValue("--employer");
  if (process.argv.includes("--dry-run")) return dryRun(employerSlug);

  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const limit = Math.min(Math.max(Number(argValue("--limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const { pool } = await import("../src/db/client.js");
  const repository = await import("../src/db/direct-repository.js");
  const { runDirectTick } = await import("../src/direct/tick.js");
  try {
    const sources = await repository.pickDueSources({
      limit,
      minIntervalHours: process.argv.includes("--force") ? 0 : MIN_INTERVAL_HOURS,
      employerSlug
    });
    const reports = await runDirectTick(sources, {
      http: boundedGet,
      saveListing: repository.saveListing,
      recordOutcome: repository.recordSourceOutcome
    });
    const purged = await repository.purgeClosedDirectJobs();
    printReports(reports, purged);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[direct-tick] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
