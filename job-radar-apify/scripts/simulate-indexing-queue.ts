/**
 * Indexing API queue simulator (docs/adr/0004-indexing-api-notification-policy.md).
 *
 * Replays REAL production arrivals — exported read-only as epoch-hour
 * timestamps and flags, no ids, no text — against delete policies (D0/D1/D2),
 * schedulers (S0..S4) and daily quotas, and reports queue size, waits and
 * starvation. Deterministic (seeded). Never touches a database.
 *
 *   npx tsx scripts/simulate-indexing-queue.ts <simdata.json> [--replay=14|30] [--json]
 *   npx tsx scripts/simulate-indexing-queue.ts --funnel=<F0 funnel.json> --ticks=<tick gaps.json> --grid=f2
 *
 * simdata.json shape (see the ADR for the export query):
 *   jobs:           [createdHour, lastSeenHour, seoReady 0|1, updateSentBefore 0|1, updatePending 0|1, source, readyDelayH?][]
 *   lifetimes:      [insertHour, purgeHour, sent 0|1][]   (purged jobs, insert-time rows only)
 *   pendingDeletes: [createdHour, priority][]
 *   tickGapsH?:     hours between real indexing-tick runs, replayed cyclically (send modes burst/paced)
 *
 * --funnel rebuilds a SimData from the F0 aggregates (GOOGLE-JOBS F2): there is
 * no per-job export for November, so arrivals are a deterministic
 * reconstruction of the measured daily counts (see simDataFromFunnel()).
 */
import { readFileSync } from "node:fs";
import {
  pacedSendAllowance,
  planIndexingSends,
  type LaneQueues,
  type SchedulerConfig,
  type QueueLane
} from "../src/lib/indexing-scheduler.js";

type DeletePolicy = "D0" | "D1" | "D2";
export type SimScheduler = "SF" | "S0" | "S1" | "S2" | "S2N" | "S2NB" | "S3" | "S4";
/** daily: one send at hour 0 of every day (the ADR 0004 model); burst/paced replay the real tick runs. */
export type SendMode = "daily" | "burst" | "paced";

interface SimJob { created: number; purge: number; ready: boolean; sentBefore: boolean; sentAt: number; purged: boolean }
interface SimItem { lane: QueueLane; arrival: number; anchor: number; job: number; backlog: boolean }

const HOUR = 1;
const DAY = 24 * HOUR;
const PURGE_AFTER = 30 * DAY;

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export interface SimData {
  jobs: ([number, number, number, number, number, string] | [number, number, number, number, number, string, number])[];
  lifetimes: [number, number, number][];
  pendingDeletes: [number, number][];
  tickGapsH?: number[];
}

export interface SimParams {
  policy: DeletePolicy;
  scheduler: SimScheduler;
  quota: number;
  /** API window for URL_UPDATED, in days from the job's first discovery; null = unbounded. */
  windowDays: number | null;
  replayDays: number;
  horizonDays?: number;
  newShare?: number;
  /** Default "daily". burst = the whole rolling budget in the first run of each window (deployed); paced = pacedSendAllowance. */
  sendMode?: SendMode;
  /** URL_DELETED older than this (days since enqueued) is closed, never sent; null/undefined = unbounded. */
  deleteWindowDays?: number | null;
  /** Default true: every job already ready at t0 enters the reconcile lane (the ADR 0004 deploy wave). */
  legacyReconcile?: boolean;
}

export interface SimResult {
  params: SimParams;
  queue: { d7: number; d30: number; d60: number; d90: number };
  growthPerDay: number;
  newP50h: number; newP95h: number; newSentPct: number;
  /** Share of new-ready arrivals notified within 24 h / 48 h of becoming ready. */
  newWithin24hPct: number; newWithin48hPct: number;
  /** Median wait of the new-ready jobs that WERE sent, and the largest single send of a run. */
  newSentP50h: number; maxSendsPerRun: number;
  delP50h: number; delP95h: number; delSentPct: number;
  delWithin7dPct: number; expiredDeletes: number; deleteLaneEnd: number;
  sendsPerDay: number;
  starvedNew: number; starvedDel: number;
  expiredUpdates: number; obsoleteUpdates: number;
  legacyClearedDay: number | null; delBacklogClearedDay: number | null;
  demand: { newPerDay: number; delPerDayWave: number; delPerDaySteady: number };
  sends: Record<QueueLane, number>;
}

/** The scheduler variants compared by the ADR; S2 is what src/lib/indexing-scheduler.ts ships. */
export function schedulerConfig(name: SimScheduler, newShare = 0.5): SchedulerConfig {
  const shares = { new: newShare, delete: 1 - newShare, content: 0, reconcile: 0 };
  switch (name) {
    // Deployed origin/main sender: one global oldest-first queue (equal age targets = global FIFO).
    case "SF": return { kind: "age", targetHours: { new: 1, delete: 1, content: 1, reconcile: 1 } };
    case "S0": return { kind: "strict", order: ["delete", "new", "content", "reconcile"] };
    case "S1": return { kind: "fixed", shares };
    case "S2": return { kind: "weighted", shares, spillOrder: ["new", "delete", "content", "reconcile"] };
    // S2 with the new lane newest-first (GOOGLE-JOBS F2); deletes stay FIFO.
    case "S2N": return { kind: "weighted", shares, spillOrder: ["new", "delete", "content", "reconcile"], newestFirst: ["new"] };
    // S2N with deletes newest-first too.
    case "S2NB": return { kind: "weighted", shares, spillOrder: ["new", "delete", "content", "reconcile"], newestFirst: ["new", "delete"] };
    case "S3": return { kind: "age", targetHours: { new: 24, delete: 72, content: 72, reconcile: 168 } };
    case "S4": return { kind: "newest", deleteShare: 1 - newShare };
  }
}

export function simulate(data: SimData, params: SimParams): SimResult {
  const rand = mulberry32(42);
  const horizon = (params.horizonDays ?? 90) * DAY;
  const t0 = Math.max(...data.jobs.map((j) => j[1])) + 1;
  const windowH = params.windowDays == null ? Infinity : params.windowDays * DAY;
  const deleteWindowH = params.deleteWindowDays == null ? Infinity : params.deleteWindowDays * DAY;
  const sendMode = params.sendMode ?? "daily";

  // Empirical "still seen at the source" span, from the cohort discovered 31-45 days ago:
  // purged rows give a complete span, still-active rows a lower bound.
  const spans: number[] = [];
  for (const [ins, purge] of data.lifetimes) if (ins >= t0 - 45 * DAY && ins < t0 - 31 * DAY) spans.push(Math.max(0, purge - ins - PURGE_AFTER));
  for (const [c, s] of data.jobs) if (c >= t0 - 45 * DAY && c < t0 - 31 * DAY) spans.push(Math.max(0, s - c));
  const sampleSpan = (atLeast = 0) => {
    for (let i = 0; i < 50; i++) {
      const v = spans[Math.floor(rand() * spans.length)];
      if (v >= atLeast) return v;
    }
    return atLeast;
  };

  const jobs: SimJob[] = [];
  const lanes: LaneQueues<SimItem> = { new: [], delete: [], content: [], reconcile: [] };
  const newArrivals = new Map<number, number[]>();
  const purges = new Map<number, number[]>();
  const pushAt = (map: Map<number, number[]>, h: number, v: number) => {
    const list = map.get(h);
    if (list) list.push(v); else map.set(h, [v]);
  };

  // Existing corpus: purge at last_seen + 30 d; a job still being seen keeps living.
  for (const [c, s, r, n] of data.jobs) {
    const seenRecently = t0 - s < 2 * DAY;
    const span = seenRecently ? sampleSpan(s - c) : s - c;
    const job: SimJob = { created: c, purge: Math.max(t0, c + span + PURGE_AFTER), ready: r === 1, sentBefore: n === 1, sentAt: -1, purged: false };
    const idx = jobs.push(job) - 1;
    pushAt(purges, job.purge, idx);
    if (job.ready && params.legacyReconcile !== false) lanes.reconcile.push({ lane: "reconcile", arrival: t0, anchor: c, job: idx, backlog: true });
  }
  // Pending deletes already in the queue at deploy time. D1 cannot be evaluated
  // for purged rows (the job row is gone), so it keeps the same set as D2.
  for (const [c, p] of data.pendingDeletes) {
    if (params.policy === "D0" || p === 1) lanes.delete.push({ lane: "delete", arrival: c, anchor: c, job: -1, backlog: true });
  }
  // Future arrivals: replay the last `replayDays` full days of discoveries.
  const histFrom = t0 - (params.replayDays + 1) * DAY;
  const histTo = t0 - DAY;
  const history = data.jobs.filter(([c]) => c >= histFrom && c < histTo);
  for (let k = 0; ; k++) {
    const shift = t0 - histFrom + k * params.replayDays * DAY - DAY;
    if (histFrom + shift >= t0 + horizon) break;
    for (const [c, , r, , , , readyDelay = 0] of history) {
      const created = c + shift;
      if (created < t0 || created >= t0 + horizon) continue;
      const job: SimJob = { created, purge: created + sampleSpan() + PURGE_AFTER, ready: r === 1, sentBefore: false, sentAt: -1, purged: false };
      const idx = jobs.push(job) - 1;
      pushAt(purges, job.purge, idx);
      // It enters the new lane when it becomes ready; the API window still counts from discovery.
      if (job.ready) pushAt(newArrivals, created + readyDelay, idx);
    }
  }

  const config = schedulerConfig(params.scheduler, params.newShare);
  const sends: Record<QueueLane, number> = { new: 0, delete: 0, content: 0, reconcile: 0 };
  const newWaits: number[] = [];
  const delWaits: number[] = [];
  let newArrived = 0, delArrived = 0;
  let expiredUpdates = 0, obsoleteUpdates = 0, expiredDeletes = 0, maxSendsPerRun = 0;
  const queueAt: Record<number, number> = {};
  const delArrivalsByDay: number[] = [];
  let legacyClearedDay: number | null = null;
  let delBacklogClearedDay: number | null = null;
  const metricCutoff = t0 + horizon - 14 * DAY; // right-censoring guard for wait percentiles

  // Drops (never sends) an update whose job is gone or whose API window passed.
  const stillUseful = (item: SimItem, now: number): boolean => {
    if (item.lane === "delete") {
      if (now - item.arrival > deleteWindowH) { expiredDeletes++; return false; }
      return true;
    }
    const job = jobs[item.job];
    if (job.purged) { obsoleteUpdates++; return false; }
    if (now - job.created > windowH) { expiredUpdates++; return false; }
    return true;
  };
  const sweep = (now: number) => {
    for (const lane of ["new", "delete", "content", "reconcile"] as const) lanes[lane] = lanes[lane].filter((item) => stillUseful(item, now));
  };

  // Tick runs: daily = hour 0 of each day; otherwise the real gaps, replayed cyclically from t0.
  const runHours = new Set<number>();
  if (sendMode !== "daily") {
    const gaps = data.tickGapsH;
    if (!gaps || gaps.length === 0) throw new Error(`sendMode ${sendMode} needs data.tickGapsH`);
    for (let t = t0, i = 0; t < t0 + horizon; t += gaps[i++ % gaps.length]) runHours.add(Math.round(t));
  }
  const sendLog: number[] = []; // hour of every send, ascending (rolling 24 h budget)
  let sendLogHead = 0;
  const budgetAt = (h: number): number => {
    if (sendMode === "daily") return params.quota;
    while (sendLogHead < sendLog.length && sendLog[sendLogHead] <= h - DAY) sendLogHead++;
    const remaining = Math.max(0, params.quota - (sendLog.length - sendLogHead));
    if (sendMode === "burst") return remaining;
    const sinceLast = sendLogHead < sendLog.length ? h - sendLog[sendLog.length - 1] : DAY;
    return pacedSendAllowance(params.quota, remaining, sinceLast);
  };

  for (let h = t0; h < t0 + horizon; h++) {
    for (const idx of newArrivals.get(h) ?? []) {
      lanes.new.push({ lane: "new", arrival: h, anchor: jobs[idx].created, job: idx, backlog: false });
      if (h < metricCutoff) newArrived++;
    }
    for (const idx of purges.get(h) ?? []) {
      const job = jobs[idx];
      job.purged = true;
      const eligible =
        params.policy === "D0" ? true :
        params.policy === "D1" ? job.ready :
        job.sentBefore || job.sentAt >= 0;
      if (eligible) {
        lanes.delete.push({ lane: "delete", arrival: h, anchor: h, job: idx, backlog: false });
        const day = Math.floor((h - t0) / DAY);
        delArrivalsByDay[day] = (delArrivalsByDay[day] ?? 0) + 1;
        if (h < metricCutoff) delArrived++;
      }
    }
    const dayBoundary = (h - t0) % DAY === 0;
    if (sendMode === "daily" ? dayBoundary : runHours.has(h)) {
      // daily: the ADR 0004 model, one send per day with the full quota.
      // burst/paced: the real tick runs, rolling 24 h budget. Items that are
      // obsolete/expired never consume budget.
      sweep(h);
      const plan = planIndexingSends(lanes, budgetAt(h), config, h, (item) => stillUseful(item, h));
      if (h >= t0 + DAY) maxSendsPerRun = Math.max(maxSendsPerRun, plan.length); // past the deploy-time catch-up
      for (const item of plan) {
        sends[item.lane]++;
        sendLog.push(h);
        if (item.lane !== "delete") jobs[item.job].sentAt = h;
        if (item.backlog) continue;
        if (item.arrival >= metricCutoff) continue;
        (item.lane === "delete" ? delWaits : item.lane === "new" ? newWaits : []).push(h - item.arrival);
      }
    }
    if (!dayBoundary) continue;
    sweep(h);
    const day = (h - t0) / DAY;
    const size = lanes.new.length + lanes.delete.length + lanes.content.length + lanes.reconcile.length;
    queueAt[day] = size;
    if (legacyClearedDay === null && lanes.reconcile.length === 0) legacyClearedDay = day;
    if (delBacklogClearedDay === null && !lanes.delete.some((item) => item.backlog)) delBacklogClearedDay = day;
  }

  const withNever = (waits: number[], arrived: number) => [...waits, ...Array(Math.max(0, arrived - waits.length)).fill(Infinity)];
  const allNew = withNever(newWaits, newArrived);
  const allDel = withNever(delWaits, delArrived);
  const lastDay = (params.horizonDays ?? 90) - 1;
  const at = (d: number) => queueAt[Math.min(d, lastDay)] ?? 0;
  const sum = (from: number, to: number) => delArrivalsByDay.slice(from, to).reduce((a, b) => a + (b ?? 0), 0);
  return {
    params,
    queue: { d7: at(7), d30: at(30), d60: at(60), d90: at(lastDay) },
    growthPerDay: Math.round((at(lastDay) - at(60)) / (lastDay - 60)),
    newP50h: quantile(allNew, 0.5), newP95h: quantile(allNew, 0.95), newSentPct: Math.round((100 * newWaits.length) / Math.max(1, newArrived)),
    newWithin24hPct: pct(newWaits.filter((w) => w <= DAY).length, newArrived),
    newWithin48hPct: pct(newWaits.filter((w) => w <= 2 * DAY).length, newArrived),
    newSentP50h: quantile(newWaits, 0.5), maxSendsPerRun,
    delP50h: quantile(allDel, 0.5), delP95h: quantile(allDel, 0.95), delSentPct: Math.round((100 * delWaits.length) / Math.max(1, delArrived)),
    delWithin7dPct: pct(delWaits.filter((w) => w <= 7 * DAY).length, delArrived),
    expiredDeletes, deleteLaneEnd: lanes.delete.length,
    sendsPerDay: Math.round((sends.new + sends.delete + sends.content + sends.reconcile) / (horizon / DAY)),
    starvedNew: allNew.filter((w) => w > 7 * DAY).length,
    starvedDel: allDel.filter((w) => w > 14 * DAY).length,
    expiredUpdates, obsoleteUpdates, legacyClearedDay, delBacklogClearedDay,
    demand: {
      newPerDay: Math.round(newArrived / ((metricCutoff - t0) / DAY)),
      delPerDayWave: Math.round(sum(0, 30) / 30),
      delPerDaySteady: Math.round(sum(30, lastDay) / (lastDay - 30))
    },
    sends
  };
}

const pct = (part: number, whole: number) => Math.round((1000 * part) / Math.max(1, whole)) / 10;

const fmtH = (h: number) => (Number.isFinite(h) ? (h < 48 ? `${h}h` : `${(h / 24).toFixed(1)}d`) : "never");

export function formatRow(r: SimResult): string {
  const p = r.params;
  return [p.policy, p.scheduler, p.newShare ?? "", p.quota, p.windowDays ?? "∞",
    r.queue.d7, r.queue.d30, r.queue.d60, r.queue.d90, r.growthPerDay,
    fmtH(r.newP50h), fmtH(r.newP95h), `${r.newSentPct}%`, fmtH(r.delP50h), fmtH(r.delP95h), `${r.delSentPct}%`,
    r.starvedNew, r.starvedDel, r.expiredUpdates, r.obsoleteUpdates,
    r.legacyClearedDay ?? "-", r.delBacklogClearedDay ?? "-"].join(" | ");
}

/** GOOGLE-JOBS F2 view: what changes 1-3 move (≤24 h from ready is the primary metric). */
export function formatF2Row(r: SimResult): string {
  const p = r.params;
  return [p.scheduler, p.sendMode ?? "daily", p.newShare ?? "", p.deleteWindowDays ?? "∞",
    `${r.newWithin24hPct}%`, `${r.newWithin48hPct}%`, `${r.newSentPct}%`, fmtH(r.newSentP50h),
    `${r.delSentPct}%`, `${r.delWithin7dPct}%`, fmtH(r.delP50h), r.deleteLaneEnd, r.expiredDeletes,
    r.sends.new, r.sends.delete, r.sendsPerDay, r.maxSendsPerRun].join(" | ");
}

export const F2_HEADER = "sched | mode | newShare | del window d | new ≤24h | new ≤48h | new sent | sent new p50 | del sent | del ≤7d | del p50 | del lane @end | del closed | sent new | sent del | sends/day | max/run";

/** The F0 aggregate export (docs/seo-baseline/2026-11-01-google-jobs-funnel.json), only the fields used here. */
export interface FunnelExport {
  enqueued_by_day_priority: { day: string; notification_type: string; priority: number; n: string }[];
  ready_by_day_source: { day: string; source: string; became_ready: string; official_projection: string }[];
  pending_now: { notification_type: string; priority: number; n: string; p50_age_h: string; max_age_h: string }[];
}

/** Created → ready for Magneto CO (F0 §2: p50 107-113 h); the other sources are ready in the same tick. */
const MAGNETO_READY_DELAY_H = 110;
const FUNNEL_DAYS = 13; // 10-19 … 10-31, the complete Bogotá days of F0
const FUNNEL_SENT_PER_DAY = 100; // F0: 100 URL_UPDATED sent per day

/**
 * Rebuilds a SimData from the F0 aggregates. Deterministic (seeded); it is a
 * reconstruction of the measured counts, not a per-job export:
 *
 * - new lane: every priority-2 URL_UPDATED enqueued per complete Bogotá day,
 *   at a uniform hour; Magneto's share of that day's non-official ready jobs
 *   becomes ready MAGNETO_READY_DELAY_H after discovery (its window is shorter);
 * - API-notified jobs (the future D2 deletes): 100/day over the last 30 days,
 *   excluding the last 7 (FIFO sends a job ~7 days after it is ready);
 * - purge exactly 30 days after discovery (ADR 0008's public maximum);
 * - the 8,850 pending priority-1 URL_DELETED: the per-day F0 arrivals of the
 *   last 13 days, the rest uniform on both sides of the measured p50 up to the max.
 */
export function simDataFromFunnel(funnel: FunnelExport, tickGapsH?: number[]): SimData {
  const rand = mulberry32(7);
  const bogotaDayStart = (day: string) => Date.parse(`${day}T05:00:00Z`) / 3_600_000;
  const days = [...new Set(funnel.enqueued_by_day_priority.map((row) => row.day))].sort();
  const lastFullDay = "2026-10-31";
  const replayDays = days.filter((day) => day <= lastFullDay).slice(-FUNNEL_DAYS);
  const t0 = bogotaDayStart(lastFullDay) + 2 * DAY; // 11-02 00:00 Bogotá, right after F0's export

  const jobs: SimData["jobs"] = [];
  for (const day of replayDays) {
    const start = bogotaDayStart(day);
    const n = Number(funnel.enqueued_by_day_priority.find((row) => row.day === day && row.notification_type === "URL_UPDATED" && row.priority === 2)?.n ?? 0);
    const readyRows = funnel.ready_by_day_source.filter((row) => row.day === day);
    const nonOfficial = (row: FunnelExport["ready_by_day_source"][number]) => Number(row.became_ready) - Number(row.official_projection);
    const total = readyRows.reduce((sum, row) => sum + nonOfficial(row), 0);
    const magneto = readyRows.filter((row) => row.source === "Magneto").reduce((sum, row) => sum + nonOfficial(row), 0);
    const magnetoShare = total > 0 ? magneto / total : 0;
    const sentToday = t0 - start > 8 * DAY ? Math.min(n, FUNNEL_SENT_PER_DAY) : 0;
    for (let i = 0; i < n; i++) {
      const created = start + Math.floor(rand() * DAY);
      const isMagneto = rand() < magnetoShare;
      jobs.push([created, created, 1, i < sentToday ? 1 : 0, 0, isMagneto ? "Magneto" : "other", isMagneto ? MAGNETO_READY_DELAY_H : 0]);
    }
  }
  // Older API-notified jobs, whose deletes arrive during the first weeks.
  const replayStart = bogotaDayStart(replayDays[0]);
  for (let start = t0 - 30 * DAY; start < replayStart; start += DAY)
    for (let i = 0; i < FUNNEL_SENT_PER_DAY; i++) {
      const created = start + Math.floor(rand() * DAY);
      jobs.push([created, created, 0, 1, 0, "other"]);
    }
  jobs.push([t0 - 1, t0 - 1, 0, 0, 0, "other"]); // pins t0

  const lifetimes: SimData["lifetimes"] = Array.from({ length: 50 }, (_, i) => {
    const ins = t0 - 44 * DAY + i;
    return [ins, ins + PURGE_AFTER, 0];
  });

  const pendingDeletes: SimData["pendingDeletes"] = [];
  const recentDays = days.filter((day) => bogotaDayStart(day) >= t0 - FUNNEL_DAYS * DAY);
  for (const day of recentDays) {
    const n = Number(funnel.enqueued_by_day_priority.find((row) => row.day === day && row.notification_type === "URL_DELETED" && row.priority === 1)?.n ?? 0);
    for (let i = 0; i < n; i++) pendingDeletes.push([bogotaDayStart(day) + Math.floor(rand() * DAY), 1]);
  }
  const pending = funnel.pending_now.find((row) => row.notification_type === "URL_DELETED" && row.priority === 1);
  const total = Number(pending?.n ?? 0);
  const p50 = Number(pending?.p50_age_h ?? 0);
  const max = Number(pending?.max_age_h ?? 0);
  const fill = (count: number, fromAge: number, toAge: number) => {
    for (let i = 0; i < count; i++) pendingDeletes.push([Math.round(t0 - (fromAge + rand() * (toAge - fromAge))), 1]);
  };
  const half = Math.floor(total / 2);
  fill(Math.max(0, half - pendingDeletes.length), FUNNEL_DAYS * DAY, p50);
  fill(total - half, p50, max);
  return { jobs, lifetimes, pendingDeletes, tickGapsH };
}

export const HEADER = "policy | sched | newShare | Q/day | window d | q@7 | q@30 | q@60 | q@90 | growth/d | new p50 | new p95 | new sent | del p50 | del p95 | del sent | starved new(>7d) | starved del(>14d) | expired upd | obsolete upd | legacy cleared d | del backlog cleared d";

if (process.argv[1]?.endsWith("simulate-indexing-queue.ts")) {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const funnel = arg("funnel");
  const file = process.argv[2];
  if (!funnel && (!file || file.startsWith("--"))) {
    throw new Error("usage: simulate-indexing-queue.ts <simdata.json> [--replay=14|30] [--json] | --funnel=<json> --ticks=<json> --grid=f2");
  }
  const ticks = arg("ticks");
  const tickGapsH = ticks ? (JSON.parse(readFileSync(ticks, "utf8")) as { gapsH: number[] }).gapsH : undefined;
  const data = funnel
    ? simDataFromFunnel(JSON.parse(readFileSync(funnel, "utf8")) as FunnelExport, tickGapsH)
    : { ...(JSON.parse(readFileSync(file, "utf8")) as SimData), ...(tickGapsH ? { tickGapsH } : {}) };
  const replay = Number(arg("replay") ?? (funnel ? FUNNEL_DAYS : 14));
  const grid = arg("grid") ?? "main";
  const results: SimResult[] = [];
  const run = (p: Omit<SimParams, "replayDays">) => results.push(simulate(data, { ...p, replayDays: replay }));
  if (grid === "main") {
    for (const policy of ["D0", "D1", "D2"] as const)
      for (const scheduler of ["S0", "S1", "S2", "S3", "S4"] as const)
        for (const quota of [200, 400, 600, 800, 1000])
          for (const windowDays of [null, 7])
            run({ policy, scheduler, quota, windowDays, newShare: 0.5 });
  } else if (grid === "final") {
    for (const scheduler of ["SF", "S0", "S2", "S4"] as const)
      for (const quota of [200, 400, 600, 800, 1000, 1200, 1500])
        for (const windowDays of [3, 7])
          run({ policy: "D2", scheduler, quota, windowDays, newShare: 0.5 });
  } else if (grid === "shares") {
    for (const newShare of [0.4, 0.5, 0.6, 0.7, 0.8])
      for (const quota of [200, 400, 600, 800, 1000])
        for (const scheduler of ["S1", "S2", "S4"] as const)
          run({ policy: "D2", scheduler, quota, windowDays: 7, newShare });
  } else if (grid === "window") {
    for (const windowDays of [1, 2, 3, 5, 7, 10, 14, 21, null])
      for (const quota of [200, 400, 600, 800])
        run({ policy: "D2", scheduler: "S2", quota, windowDays, newShare: 0.5 });
  } else if (grid === "minquota") {
    for (const policy of ["D0", "D1", "D2"] as const)
      for (const scheduler of ["S0", "S2", "S3", "S4"] as const)
        for (let quota = 100; quota <= 3000; quota += 25) {
          const r = simulate(data, { policy, scheduler, quota, windowDays: null, replayDays: replay, newShare: 0.5 });
          if (r.growthPerDay <= 0 && r.newP95h <= 48 && r.delP95h <= 7 * 24) { results.push(r); break; }
        }
  } else if (grid === "f2") {
    // GOOGLE-JOBS F2, 200/day. Today's tick is S2 + burst; daily is the ADR 0004 model.
    const base = { policy: "D2" as const, quota: 200, windowDays: 7, legacyReconcile: false };
    for (const sendMode of ["daily", "burst", "paced"] as const)
      for (const scheduler of ["SF", "S2", "S3", "S4", "S2N"] as const)
        run({ ...base, scheduler, sendMode, newShare: 0.5 });
    for (const newShare of [0.5, 0.6, 0.75, 0.9])
      for (const deleteWindowDays of [null, 30, 14, 7, 3])
        run({ ...base, scheduler: "S2N", sendMode: "paced", newShare, deleteWindowDays });
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(results));
  else if (grid === "f2") { console.log(F2_HEADER); for (const r of results) console.log(formatF2Row(r)); }
  else { console.log(HEADER); for (const r of results) console.log(formatRow(r)); }
}
