import { isValidRef } from "../connectors.js";
import { DIRECT_ATS_TYPES, type DirectAtsType } from "../types.js";
import { atsLinkFromUrl, DETECTABLE_ATS_TYPES, type DetectableAtsType } from "./ats-links.js";

/**
 * ATS board inventory, phase I1 (openspec/changes/ats-inventory-co-2026-11,
 * INV-001…INV-005; ADR 0006 §13). Board references found from the ATS side,
 * independent of job-board company names. Only (ats_type, ats_ref) and their
 * provenance are kept — never a URL, page text or posting. Nothing here
 * probes a board or enables one (phase I2).
 */

export const INVENTORY_SOURCES = ["commoncrawl", "job_link", "site_probe"] as const;
export type InventorySource = (typeof INVENTORY_SOURCES)[number];

/**
 * `pending` waits for the I2 probe; `owned` is already an employer_sources
 * row; `unsupported_ats` is a board no connector can read. The I2 end states
 * (enabled, no_colombia, agency, ambiguous, blocked, error) are set later.
 */
export type InventoryStatus = "pending" | "owned" | "unsupported_ats";

export interface CanonicalRef {
  atsType: DetectableAtsType;
  atsRef: string;
  /** True only when a connector reads this exact ref form. */
  supported: boolean;
}

/** A URL that names a board, or a ref an earlier probe already parsed (site-probe evidence). */
export type InventorySighting =
  | { source: InventorySource; url: string }
  | { source: InventorySource; atsType: string; atsRef: string };

export interface InventoryRow extends CanonicalRef {
  firstSource: InventorySource;
  sources: InventorySource[];
  /** URLs that named this board in this run (evidence volume, not stored per URL). */
  sightings: number;
}

/**
 * The board a URL names, in the form its connector reads. One parser for
 * every source (ats-links.ts), so the same board never becomes two rows.
 */
export function canonicalBoardRef(url: string): CanonicalRef | null {
  const link = atsLinkFromUrl(url);
  if (!link) return null;
  const supported =
    (DIRECT_ATS_TYPES as readonly string[]).includes(link.atsType) &&
    isValidRef({ atsType: link.atsType as DirectAtsType, atsRef: link.atsRef });
  return { atsType: link.atsType, atsRef: link.atsRef, supported };
}

// Same alphabet as every connector's ref (tokens, hosts, Workday paths, Eightfold host@domain).
const STORED_REF = /^[A-Za-z0-9][A-Za-z0-9._@/-]{0,199}$/;

/** A ref read back from stored evidence: only a known ATS type and a well-formed ref count. */
export function canonicalStoredRef(atsType: string, atsRef: string): CanonicalRef | null {
  if (!(DETECTABLE_ATS_TYPES as readonly string[]).includes(atsType) || !STORED_REF.test(atsRef) || atsRef.includes("..")) return null;
  const supported =
    (DIRECT_ATS_TYPES as readonly string[]).includes(atsType) && isValidRef({ atsType: atsType as DirectAtsType, atsRef });
  return { atsType: atsType as DetectableAtsType, atsRef, supported };
}

/** Uniqueness key: ATS refs are compared case-insensitively (the table's ref_key). */
export function inventoryKey(atsType: string, atsRef: string): string {
  return `${atsType}:${atsRef.toLowerCase()}`;
}

/** Distinct boards from all sightings. Deterministic: same input, same rows in the same order. */
export function collectInventory(sightings: InventorySighting[]): InventoryRow[] {
  const rows = new Map<string, InventoryRow>();
  for (const sighting of sightings) {
    const ref = "url" in sighting ? canonicalBoardRef(sighting.url) : canonicalStoredRef(sighting.atsType, sighting.atsRef);
    if (!ref) continue;
    const key = inventoryKey(ref.atsType, ref.atsRef);
    const row = rows.get(key);
    if (!row) {
      rows.set(key, { ...ref, firstSource: sighting.source, sources: [sighting.source], sightings: 1 });
      continue;
    }
    row.sightings += 1;
    if (!row.sources.includes(sighting.source)) row.sources.push(sighting.source);
  }
  return [...rows.values()];
}

/** Status a new inventory row starts with. `ownedKeys` are inventoryKey()s of employer_sources. */
export function initialStatus(row: CanonicalRef, ownedKeys: ReadonlySet<string>): InventoryStatus {
  if (ownedKeys.has(inventoryKey(row.atsType, row.atsRef))) return "owned";
  return row.supported ? "pending" : "unsupported_ats";
}

export type SourceState = "ok" | "no_data" | "skipped";

export interface InventorySummary {
  total: number;
  /** Boards each source named; null when the source gave no data (never 0). */
  bySource: Record<InventorySource, number | null>;
  byAts: Record<string, number>;
  byStatus: Record<string, number>;
}

export function summarizeInventory(
  rows: InventoryRow[],
  ownedKeys: ReadonlySet<string>,
  sourceState: Record<InventorySource, SourceState>
): InventorySummary {
  const bySource = {} as Record<InventorySource, number | null>;
  for (const source of INVENTORY_SOURCES) {
    bySource[source] = sourceState[source] === "ok" ? rows.filter((row) => row.sources.includes(source)).length : null;
  }
  const byAts: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    byAts[row.atsType] = (byAts[row.atsType] ?? 0) + 1;
    const status = initialStatus(row, ownedKeys);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  return { total: rows.length, bySource, byAts, byStatus };
}
