import type { JobLinkResult } from "./resolve.js";

// AI Resume Studio R4d — how well the link reader covers the links people
// actually paste. Every read is counted as (day, host, outcome), aggregated:
// only the site's host name (no path, no query, no user, no vacancy text).
// The weekly report (scripts/resume-studio-link-report.ts) lists the sites
// that most often end in «pega el texto», which is what to fix next.

export const OUTCOME_PASTED = "pasted";

/** The link's host, lower-case and without «www.»; «invalid» when it isn't a web URL. Never the path. */
export function linkHost(raw: string | null | undefined): string {
  if (!raw) return "none";
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "invalid";
    const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
    // An IP address or a one-label name says nothing useful (and may be private).
    if (!host.includes(".") || /^\d+(\.\d+){3}$/.test(host) || host.includes(":")) return "other";
    return host.slice(0, 253);
  } catch {
    return "invalid";
  }
}

/** «resolved_<via>», «paste_<reason>» or «invalid_<reason>»: a short label, never content. */
export function linkOutcome(result: JobLinkResult | { status: "error" }): string {
  if (result.status === "resolved") return `resolved_${result.cached ? "cache" : result.snapshot.via}`;
  if (result.status === "paste_required") return `paste_${result.reason}`;
  if (result.status === "invalid") return `invalid_${result.reason}`;
  return "error";
}

export interface CoverageRow {
  host: string;
  outcome: string;
  hits: number;
}

export interface CoverageReport {
  total: number;
  resolved: number;
  /** Share of reads that needed no paste (0–100, one decimal). */
  resolvedPct: number;
  /** Times the user then pasted the text (the flow never dead-ends). */
  pasted: number;
  byOutcome: { outcome: string; hits: number }[];
  /** Sites that most often ended in «pega el texto», with their reasons. */
  topFailing: { host: string; hits: number; reasons: string[] }[];
}

/** Pure: the report from aggregated rows (tests and the script share it). */
export function coverageReport(rows: CoverageRow[], top = 15): CoverageReport {
  const reads = rows.filter((r) => r.outcome !== OUTCOME_PASTED);
  const total = reads.reduce((n, r) => n + r.hits, 0);
  const resolved = reads.filter((r) => r.outcome.startsWith("resolved_")).reduce((n, r) => n + r.hits, 0);
  const byOutcome = new Map<string, number>();
  for (const r of rows) byOutcome.set(r.outcome, (byOutcome.get(r.outcome) ?? 0) + r.hits);
  const failing = new Map<string, { hits: number; reasons: Map<string, number> }>();
  for (const r of reads) {
    if (!r.outcome.startsWith("paste_") && r.outcome !== "error") continue;
    const f = failing.get(r.host) ?? { hits: 0, reasons: new Map() };
    f.hits += r.hits;
    f.reasons.set(r.outcome, (f.reasons.get(r.outcome) ?? 0) + r.hits);
    failing.set(r.host, f);
  }
  return {
    total,
    resolved,
    resolvedPct: total ? Math.round((resolved / total) * 1000) / 10 : 0,
    pasted: byOutcome.get(OUTCOME_PASTED) ?? 0,
    byOutcome: [...byOutcome].map(([outcome, hits]) => ({ outcome, hits })).sort((a, b) => b.hits - a.hits),
    topFailing: [...failing]
      .map(([host, f]) => ({ host, hits: f.hits, reasons: [...f.reasons].sort((a, b) => b[1] - a[1]).map(([o]) => o) }))
      .sort((a, b) => b.hits - a.hits || a.host.localeCompare(b.host))
      .slice(0, top)
  };
}
