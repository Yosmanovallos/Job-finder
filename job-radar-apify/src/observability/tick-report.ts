/**
 * F-fuentes — honest end-of-tick report (docs/adr/0010-external-dispatch-cadence.md).
 *
 * Before this, the step summary listed only LISTING statuses, so a tick that
 * ended `partial (some_sources_degraded)` because of detail 429s showed a
 * table of green "success" rows, and the workflow stayed green. This module
 * builds one per-source view (listing + detail + drain + roles) for the step
 * summary and one structured log record, and turns a run of consecutive
 * degraded ticks into a persistent `::warning::`.
 *
 * Pure on purpose: no DB, no env, no clock — testable offline and impossible
 * to break a scrape by importing. Nothing here decides an exit code: a
 * degraded source never fails the job (the drain and indexing steps after it
 * must still run).
 *
 * Privacy (AGENTS.md "Security defaults"): only source names, status/reason
 * enums, error CLASSES and counts. Never error messages (they can carry
 * URLs), HTML or anything about a user.
 */
import type { AttemptOutcome, AttemptStage, AttemptStatus } from "./run-telemetry.js";

/** Consecutive degraded ticks before a source gets a persistent warning. */
export const DEGRADED_STREAK_THRESHOLD = 3;
/** How many past ticks the streak query looks at. */
export const DEGRADED_STREAK_WINDOW = 12;

/**
 * Same neutral set as circuit-policy.ts: `timeout` is OUR budget running out,
 * `skipped` is a circuit or lease decision, `empty` can be a legitimate
 * "nothing new". Counting them would raise a warning on every late tick and
 * train everyone to ignore the warning.
 */
const NEUTRAL_STATUSES = new Set<AttemptStatus>(["success", "empty", "skipped", "timeout", "running"]);

export function isDegradedAttempt(status: AttemptStatus, reason: string | null): boolean {
  if (NEUTRAL_STATUSES.has(status)) return false;
  // Data arrived but the budget cut the rest: a capacity fact, not source
  // health. `detail_unavailable` = some postings simply have no detail page
  // (Computrabajo, run 41364751660: 3 complete, 5 sin detalle, no fault),
  // which circuit-policy also treats as neutral.
  if (status === "partial" && (reason === "deadline_exceeded" || reason === "detail_unavailable")) return false;
  return true;
}

/** Drain counters, structurally (mirrors detail-enrichment's EnrichmentCounters). */
export interface DrainCountersLike {
  claimed: number;
  complete: number;
  retry: number;
  noDetail: number;
  failed: number;
  stoppedEarly: boolean;
  faultClasses: Record<string, number>;
}

export interface RoleProgress {
  /** Roles with at least one due source when the tick looked. */
  due: number;
  /** Role×source pairs due when the tick looked (the finer-grained backlog). */
  duePairs: number;
  /** Roles the tick selected (capped at MAX_ROLES_PER_RUN). */
  selected: number;
  /** Selected roles that finished inside their budget. */
  completed: number;
  /** Selected roles cut by their budget (their unfinished sources stay due). */
  timedOut: number;
}

export interface SourceListingInput {
  fetched: number;
  /** True when the adapter threw (the message itself is never reported). */
  threw: boolean;
}

export interface TickReportInput {
  country: string;
  trigger: string;
  runStatus: string;
  runReason: string;
  roles: RoleProgress;
  savedCount: number;
  duplicateCount: number;
  purged: number;
  attempts: AttemptOutcome[];
  /** Per source: what the listing returned (merged across roles). */
  listings: Record<string, SourceListingInput[]>;
  /** In-tick drain counters, by adapter name. */
  drain: Record<string, DrainCountersLike>;
  /** Sources held out of this tick by source pacing, if any. */
  pacedOut: string[];
}

export interface SourceHealth {
  source: string;
  fetched: number;
  listing: { ok: number; degraded: number; neutral: number; threw: number; notFound: number };
  detail: { ok: number; degraded: number; neutral: number };
  drain: { claimed: number; complete: number; retry: number; noDetail: number; failed: number; rateLimited: number; faults: string };
  /** Statuses seen, e.g. { success: 4, failed: 1 }. */
  statuses: Partial<Record<AttemptStatus, number>>;
  degraded: boolean;
}

export interface TickReport {
  sources: SourceHealth[];
  degradedSources: string[];
  markdown: string;
  /** One structured log record (JSON-safe, PII-free). */
  log: Record<string, unknown>;
}

/** Fault classes that mean the source asked us to slow down. */
const RATE_LIMIT_CLASSES = new Set(["FetchRateLimitedError", "rate_limited", "HTTP_429"]);

function formatFaults(faultClasses: Record<string, number>): string {
  return Object.entries(faultClasses)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name}×${count}`)
    .join(", ");
}

function emptyHealth(source: string): SourceHealth {
  return {
    source,
    fetched: 0,
    listing: { ok: 0, degraded: 0, neutral: 0, threw: 0, notFound: 0 },
    detail: { ok: 0, degraded: 0, neutral: 0 },
    drain: { claimed: 0, complete: 0, retry: 0, noDetail: 0, failed: 0, rateLimited: 0, faults: "" },
    statuses: {},
    degraded: false
  };
}

function bump(bucket: { ok: number; degraded: number; neutral: number }, outcome: AttemptOutcome): void {
  if (isDegradedAttempt(outcome.status, outcome.reason)) bucket.degraded++;
  else if (outcome.status === "success" || outcome.status === "partial") bucket.ok++;
  else bucket.neutral++;
}

const STAGE_BUCKET: Record<AttemptStage, "listing" | "detail" | null> = { listing: "listing", detail: "detail", verification: null };

export function buildSourceHealth(input: Pick<TickReportInput, "attempts" | "listings" | "drain">): SourceHealth[] {
  const bySource = new Map<string, SourceHealth>();
  const health = (source: string) => {
    let entry = bySource.get(source);
    if (!entry) bySource.set(source, (entry = emptyHealth(source)));
    return entry;
  };

  for (const outcome of input.attempts) {
    const entry = health(outcome.source);
    entry.statuses[outcome.status] = (entry.statuses[outcome.status] ?? 0) + 1;
    const bucket = STAGE_BUCKET[outcome.stage];
    if (bucket) bump(entry[bucket], outcome);
    if (outcome.stage === "listing") entry.listing.notFound += outcome.notFound;
    if (isDegradedAttempt(outcome.status, outcome.reason)) entry.degraded = true;
  }
  for (const [source, runs] of Object.entries(input.listings)) {
    const entry = health(source);
    for (const run of runs) {
      entry.fetched += run.fetched;
      if (run.threw) {
        entry.listing.threw++;
        entry.degraded = true;
      }
    }
  }
  for (const [source, counters] of Object.entries(input.drain)) {
    if (counters.claimed === 0) continue;
    const entry = health(source);
    entry.drain = {
      claimed: counters.claimed,
      complete: counters.complete,
      retry: counters.retry,
      noDetail: counters.noDetail,
      failed: counters.failed,
      rateLimited: rateLimitedCount(counters),
      faults: formatFaults(counters.faultClasses)
    };
    if (entry.drain.rateLimited > 0) entry.degraded = true;
  }
  return [...bySource.values()].sort((a, b) => a.source.localeCompare(b.source));
}

function statusCell(statuses: SourceHealth["statuses"]): string {
  const parts = Object.entries(statuses)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([status, count]) => (count === 1 ? status : `${status}×${count}`));
  return parts.join(", ") || "—";
}

function listingCell(entry: SourceHealth): string {
  const { ok, degraded, threw, notFound } = entry.listing;
  if (ok + degraded + threw + entry.listing.neutral === 0) return "—";
  const extras = [degraded ? `${degraded} degradado(s)` : "", threw ? `${threw} excepción(es)` : "", notFound ? `${notFound} búsqueda(s) 404` : ""]
    .filter(Boolean)
    .join(", ");
  return `${ok} ok${extras ? ` · ${extras}` : ""}`;
}

function detailCell(entry: SourceHealth): string {
  const parts: string[] = [];
  const { ok, degraded } = entry.detail;
  if (ok + degraded + entry.detail.neutral > 0) parts.push(`intentos ${ok} ok${degraded ? ` / ${degraded} degradado(s)` : ""}`);
  const d = entry.drain;
  if (d.claimed > 0) {
    parts.push(`drenaje ${d.complete}/${d.claimed} completas, ${d.retry} reintento${d.rateLimited ? `, **429×${d.rateLimited}**` : ""}`);
  }
  return parts.join(" · ") || "—";
}

export function buildTickReport(input: TickReportInput, now: Date): TickReport {
  const sources = buildSourceHealth(input);
  const degradedSources = sources.filter((entry) => entry.degraded).map((entry) => entry.source);
  const { roles } = input;
  const pendingRoles = Math.max(roles.due - roles.completed, 0);

  const lines: string[] = [];
  lines.push(`## 🕒 Scrape tick ${input.country} — ${now.toISOString()}`);
  lines.push("");
  const statusIcon = input.runStatus === "success" || input.runStatus === "empty" ? "✅" : "⚠️";
  lines.push(`${statusIcon} Estado de la ejecución: **${input.runStatus}** (${input.runReason}) · disparo: \`${input.trigger}\``);
  if (degradedSources.length > 0) {
    lines.push(`Fuentes degradadas en este tick: **${degradedSources.join(", ")}**`);
  }
  lines.push("");
  lines.push(
    `Roles: **${roles.due}** con fuentes vencidas (${roles.duePairs} pares rol/fuente) · seleccionados **${roles.selected}** · completos **${roles.completed}** · cortados por presupuesto **${roles.timedOut}** · pendientes al cerrar **${pendingRoles}**`
  );
  lines.push(
    `Vacantes nuevas guardadas: **${input.savedCount}** | Duplicadas fusionadas: **${input.duplicateCount}** | Purgadas (>30d): **${input.purged}**`
  );
  if (input.pacedOut.length > 0) {
    lines.push(`Fuentes con ritmo protegido, fuera de este tick: ${input.pacedOut.join(", ")} (ver ADR 0010)`);
  }
  lines.push("");
  lines.push("| Fuente | Vacantes obtenidas | Listado | Detalle | Estados | Salud |");
  lines.push("|---|---|---|---|---|---|");
  for (const entry of sources) {
    const hasListing = entry.listing.ok + entry.listing.degraded + entry.listing.neutral + entry.listing.threw > 0;
    const zero = hasListing && entry.fetched === 0 ? " ⚠️ 0 resultados" : "";
    lines.push(
      `| ${entry.source} | ${hasListing ? entry.fetched : "—"}${zero} | ${listingCell(entry)} | ${detailCell(entry)} | ${statusCell(entry.statuses)} | ${entry.degraded ? "⚠️ degradada" : "ok"} |`
    );
  }

  const log: Record<string, unknown> = {
    event: "tick_health",
    country: input.country,
    trigger: input.trigger,
    run_status: input.runStatus,
    run_reason: input.runReason,
    roles: { ...roles, pending: pendingRoles },
    saved: input.savedCount,
    duplicates: input.duplicateCount,
    purged: input.purged,
    paced_out: input.pacedOut,
    degraded_sources: degradedSources,
    sources: sources.map((entry) => ({
      source: entry.source,
      fetched: entry.fetched,
      listing: entry.listing,
      detail: entry.detail,
      drain: { ...entry.drain, faults: undefined },
      statuses: entry.statuses,
      degraded: entry.degraded
    }))
  };

  return { sources, degradedSources, markdown: lines.join("\n"), log };
}

// --- Dedicated drain step ----------------------------------------------------

function rateLimitedCount(counters: DrainCountersLike): number {
  return Object.entries(counters.faultClasses)
    .filter(([name]) => RATE_LIMIT_CLASSES.has(name))
    .reduce((sum, [, count]) => sum + count, 0);
}

/** Step-summary section for scripts/run-detail-drain.ts. */
export function formatDrainSummary(country: string, drained: Record<string, DrainCountersLike>, pacedOut: readonly string[]): string {
  const lines = [`### 🧾 Drenaje de detalle ${country}`, ""];
  if (pacedOut.length > 0) lines.push(`Fuera de este drenaje por ritmo protegido: ${pacedOut.join(", ")} (ADR 0010)`, "");
  const rows = Object.entries(drained).filter(([, counters]) => counters.claimed > 0);
  if (rows.length === 0) {
    lines.push("Nada pendiente de detalle en este mercado.");
    return lines.join("\n");
  }
  lines.push("| Fuente | Reclamadas | Completas | Reintento | Sin detalle | Agotadas | 429 | Fallos | Detenida |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const [source, c] of rows.sort((a, b) => a[0].localeCompare(b[0]))) {
    const limited = rateLimitedCount(c);
    lines.push(
      `| ${source} | ${c.claimed} | ${c.complete} | ${c.retry} | ${c.noDetail} | ${c.failed} | ${limited ? `**${limited}**` : 0} | ${formatFaults(c.faultClasses) || "—"} | ${c.stoppedEarly ? "sí" : "no"} |`
    );
  }
  return lines.join("\n");
}

export function drainHealthLog(country: string, drained: Record<string, DrainCountersLike>, pacedOut: readonly string[]): Record<string, unknown> {
  return {
    event: "drain_health",
    country,
    paced_out: pacedOut,
    sources: Object.entries(drained)
      .filter(([, counters]) => counters.claimed > 0)
      .map(([source, c]) => ({
        source,
        claimed: c.claimed,
        complete: c.complete,
        retry: c.retry,
        no_detail: c.noDetail,
        failed: c.failed,
        rate_limited: rateLimitedCount(c),
        stopped_early: c.stoppedEarly
      }))
  };
}

// --- Streaks -----------------------------------------------------------------

/** One past (or the current) tick: source → was it degraded. Absent = did not run. */
export type TickSourceHealth = Map<string, boolean>;

/**
 * Consecutive degraded ticks per source, newest first. A tick in which the
 * source did not run at all (not due, paced out) neither breaks nor extends
 * its streak — only a tick where it ran healthy resets it.
 */
export function degradationStreaks(historyNewestFirst: TickSourceHealth[]): Map<string, number> {
  const streaks = new Map<string, number>();
  const settled = new Set<string>();
  for (const tick of historyNewestFirst) {
    for (const [source, degraded] of tick) {
      if (settled.has(source)) continue;
      if (degraded) streaks.set(source, (streaks.get(source) ?? 0) + 1);
      else settled.add(source);
    }
  }
  return streaks;
}

/** Groups (run, source, status, reason) rows into per-tick health, newest first. */
export function groupHealthRows(
  rows: { run_id: string; source_name: string; status: AttemptStatus; reason: string | null }[],
  runOrderNewestFirst: string[]
): TickSourceHealth[] {
  const byRun = new Map<string, TickSourceHealth>(runOrderNewestFirst.map((id) => [id, new Map()]));
  for (const row of rows) {
    const tick = byRun.get(row.run_id);
    if (!tick) continue;
    const degraded = isDegradedAttempt(row.status, row.reason);
    tick.set(row.source_name, (tick.get(row.source_name) ?? false) || degraded);
  }
  return runOrderNewestFirst.map((id) => byRun.get(id)!);
}

export function streakWarnings(
  streaks: Map<string, number>,
  country: string,
  threshold = DEGRADED_STREAK_THRESHOLD
): string[] {
  return [...streaks.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(
      ([source, count]) =>
        `::warning title=Fuente degradada ${count} ticks seguidos (${country})::${source} lleva ${count} ticks consecutivos degradada. El job sigue en verde a propósito; revisa el resumen del tick y source_attempts.`
    );
}

/** Same health, as a TickSourceHealth for the current tick (in memory). */
export function currentTickHealth(sources: SourceHealth[]): TickSourceHealth {
  return new Map(sources.map((entry) => [entry.source, entry.degraded]));
}
