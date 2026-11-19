import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMarketSnapshot, type MarketSnapshot } from "../lib/market-report.js";

// Frozen editions of the monthly labour-market report (adsense-readiness F4).
// scripts/build-market-report.ts writes them, aggregates only, to
// data/market-reports/<country>-<YYYY-MM>.json; they are committed and read
// here once per process. The report pages, the hub comparisons and the home
// figures only ever read this in-memory list: no database query, no cache to
// warm, nothing on the request path but a Map lookup.
//
// MARKET_REPORTS_DIR overrides the directory (isolated tests).

const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "market-reports");
const FILE_NAME = /^(CO|VE)-(\d{4}-\d{2})\.json$/;

let loaded: Map<string, MarketSnapshot[]> | null = null;

function load(): Map<string, MarketSnapshot[]> {
  const byCountry = new Map<string, MarketSnapshot[]>();
  const dir = process.env.MARKET_REPORTS_DIR || DEFAULT_DIR;
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return byCountry;
  }
  for (const file of files) {
    const match = FILE_NAME.exec(file);
    if (!match) continue;
    try {
      const value: unknown = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
      // The file name, the country and the period must agree; anything else is skipped.
      if (!isMarketSnapshot(value) || value.country !== match[1] || value.period !== match[2]) {
        console.warn(JSON.stringify({ event: "market_report_skipped", file }));
        continue;
      }
      const list = byCountry.get(value.country) ?? [];
      list.push(value);
      byCountry.set(value.country, list);
    } catch {
      console.warn(JSON.stringify({ event: "market_report_skipped", file }));
    }
  }
  for (const list of byCountry.values()) list.sort((a, b) => b.period.localeCompare(a.period));
  return byCountry;
}

/** Every edition of a country, newest first. */
export function getMarketEditions(country: string): readonly MarketSnapshot[] {
  loaded ??= load();
  return loaded.get(country.toUpperCase()) ?? [];
}

/** The newest edition of a country, or undefined when none exists. Never touches the database. */
export function latestMarketSnapshot(country: string): MarketSnapshot | undefined {
  return getMarketEditions(country)[0];
}
