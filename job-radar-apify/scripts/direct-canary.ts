/**
 * Live canary for one board (docs/adr/0006-direct-employers.md §5): reads it
 * through the real connector and prints what the tick WOULD store. No
 * database at all — nothing is written anywhere.
 *
 *   npx tsx scripts/direct-canary.ts <ats_type> <ats_ref> [--detail-budget 5] [--show 5]
 */
import { listBoard } from "../src/direct/connectors.js";
import { boundedGet } from "../src/direct/http.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import { DIRECT_ATS_TYPES, type DirectAtsType } from "../src/direct/types.js";

function argValue(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

async function main() {
  const [atsType, atsRef] = process.argv.slice(2).filter((arg, index, all) => !arg.startsWith("--") && !all[index - 1]?.startsWith("--"));
  if (!(DIRECT_ATS_TYPES as readonly string[]).includes(atsType) || !atsRef) {
    throw new Error(`Uso: direct-canary.ts <${DIRECT_ATS_TYPES.join("|")}> <ats_ref>`);
  }
  const started = Date.now();
  let requests = 0;
  const http: typeof boundedGet = (url, init) => {
    requests++;
    return boundedGet(url, init);
  };
  const listing = await listBoard({ atsType: atsType as DirectAtsType, atsRef }, http, { detailBudget: argValue("--detail-budget", 5) });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (listing.kind !== "complete") {
    console.log(`[canary] ${atsType}:${atsRef} → ${listing.kind}: ${listing.detail} (${requests} requests, ${seconds} s)`);
    process.exitCode = 1;
    return;
  }
  const { postings, stats } = selectColombianPostings(listing.postings);
  console.log(
    `[canary] ${atsType}:${atsRef} → completo · tablero ${listing.boardTotal} · leídas ${listing.postings.length} · ` +
      `diferidas ${listing.deferred ?? 0} · Colombia ${stats.colombia} · vigentes ${stats.kept} · >30 días ${stats.stale} · ` +
      `fuera de Colombia ${stats.notColombia} (${requests} requests, ${seconds} s)`
  );
  for (const posting of postings.slice(0, argValue("--show", 5))) {
    console.log(
      `  - ${posting.title} | ${posting.city ?? posting.locationRaw} | ${posting.workplace ?? "modalidad no indicada"} | ` +
        `${posting.publishedAt?.slice(0, 10) ?? "fecha no indicada"} | desc ${posting.descriptionText ? posting.descriptionText.length : 0} | ${posting.applyUrl}`
    );
  }
  console.log("[canary] No se escribió nada.");
}

main().catch((error) => {
  console.error("[canary] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
