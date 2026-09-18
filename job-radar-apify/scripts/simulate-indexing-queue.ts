/**
 * Indexing API queue simulator (docs/adr/0004-indexing-api-notification-policy.md).
 *
 * Replays REAL production arrivals — exported read-only as epoch-hour
 * timestamps and flags, no ids, no text — against delete policies (D0/D1/D2),
 * schedulers (S0..S4) and daily quotas, and reports queue size, waits and
 * starvation. Deterministic (seeded). Never touches a database.
 *
 *   npx tsx scripts/simulate-indexing-queue.ts <simdata.json> [--replay=14|30] [--json]
 *
 * simdata.json shape (see the ADR for the export query):
 *   jobs:           [createdHour, lastSeenHour, seoReady 0|1, updateSentBefore 0|1, updatePending 0|1, source][]
 *   lifetimes:      [insertHour, purgeHour, sent 0|1][]   (purged jobs, insert-time rows only)
 *   pendingDeletes: [createdHour, priority][]
 */
import { readFileSync } from "node:fs";
import { planIndexingSends, type LaneQueues, type SchedulerConfig, type QueueLane } from "../src/lib/indexing-scheduler.js";

type DeletePolicy = "D0" | "D1" | "D2";
export type SimScheduler = "SF" | "S0" | "S1" | "S2" | "S3" | "S4";

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
  jobs: [number, number, number, number, number, string][];
  lifetimes: [number, number, number][];
  pendingDeletes: [number, number][];
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
}

export interface SimResult {
  params: SimParams;
  queue: { d7: number; d30: number; d60: number; d90: number };
  growthPerDay: number;
  newP50h: number; newP95h: number; newSentPct: number;
  delP50h: number; delP95h: number; delSentPct: number;
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
    case "S3": return { kind: "age", targetHours: { new: 24, delete: 72, content: 72, reconcile: 168 } };
    case "S4": return { kind: "newest", deleteShare: 1 - newShare };
  }
}

export function simulate(data: SimData, params: SimParams): SimResult {
  const rand = mulberry32(42);
  const horizon = (params.horizonDays ?? 90) * DAY;
  const t0 = Math.max(...data.jobs.map((j) => j[1])) + 1;
  const windowH = params.windowDays == null ? Infinity : params.windowDays * DAY;

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
    if (job.ready) lanes.reconcile.push({ lane: "reconcile", arrival: t0, anchor: c, job: idx, backlog: true });
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
    for (const [c, , r] of history) {
      const created = c + shift;
      if (created < t0 || created >= t0 + horizon) continue;
      const job: SimJob = { created, purge: created + sampleSpan() + PURGE_AFTER, ready: r === 1, sentBefore: false, sentAt: -1, purged: false };
      const idx = jobs.push(job) - 1;
      pushAt(purges, job.purge, idx);
      if (job.ready) pushAt(newArrivals, created, idx);
    }
  }

  const config = schedulerConfig(params.scheduler, params.newShare);
  const sends: Record<QueueLane, number> = { new: 0, delete: 0, content: 0, reconcile: 0 };
  const newWaits: number[] = [];
  const delWaits: number[] = [];
  let newArrived = 0, delArrived = 0;
  let expiredUpdates = 0, obsoleteUpdates = 0;
  const queueAt: Record<number, number> = {};
  const delArrivalsByDay: number[] = [];
  let legacyClearedDay: number | null = null;
  let delBacklogClearedDay: number | null = null;
  const metricCutoff = t0 + horizon - 14 * DAY; // right-censoring guard for wait percentiles

  // Drops (never sends) an update whose job is gone or whose API window passed.
  const stillUseful = (item: SimItem, now: number): boolean => {
    if (item.lane === "delete") return true;
    const job = jobs[item.job];
    if (job.purged) { obsoleteUpdates++; return false; }
    if (now - job.created > windowH) { expiredUpdates++; return false; }
    return true;
  };
  const sweep = (now: number) => {
    for (const lane of ["new", "content", "reconcile"] as const) lanes[lane] = lanes[lane].filter((item) => stillUseful(item, now));
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
    if ((h - t0) % DAY !== 0) continue;

    // Daily send: the drain uses a rolling 24 h budget, so the first run of a
    // day spends it. Items that are obsolete/expired never consume budget.
    sweep(h);
    const plan = planIndexingSends(lanes, params.quota, config, h, (item) => stillUseful(item, h));
    for (const item of plan) {
      sends[item.lane]++;
      if (item.lane !== "delete") jobs[item.job].sentAt = h;
      if (item.backlog) continue;
      if (item.arrival >= metricCutoff) continue;
      (item.lane === "delete" ? delWaits : item.lane === "new" ? newWaits : []).push(h - item.arrival);
    }
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
    delP50h: quantile(allDel, 0.5), delP95h: quantile(allDel, 0.95), delSentPct: Math.round((100 * delWaits.length) / Math.max(1, delArrived)),
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

const fmtH = (h: number) => (Number.isFinite(h) ? (h < 48 ? `${h}h` : `${(h / 24).toFixed(1)}d`) : "never");

export function formatRow(r: SimResult): string {
  const p = r.params;
  return [p.policy, p.scheduler, p.newShare ?? "", p.quota, p.windowDays ?? "∞",
    r.queue.d7, r.queue.d30, r.queue.d60, r.queue.d90, r.growthPerDay,
    fmtH(r.newP50h), fmtH(r.newP95h), `${r.newSentPct}%`, fmtH(r.delP50h), fmtH(r.delP95h), `${r.delSentPct}%`,
    r.starvedNew, r.starvedDel, r.expiredUpdates, r.obsoleteUpdates,
    r.legacyClearedDay ?? "-", r.delBacklogClearedDay ?? "-"].join(" | ");
}

export const HEADER = "policy | sched | newShare | Q/day | window d | q@7 | q@30 | q@60 | q@90 | growth/d | new p50 | new p95 | new sent | del p50 | del p95 | del sent | starved new(>7d) | starved del(>14d) | expired upd | obsolete upd | legacy cleared d | del backlog cleared d";

if (process.argv[1]?.endsWith("simulate-indexing-queue.ts")) {
  const file = process.argv[2];
  if (!file) throw new Error("usage: simulate-indexing-queue.ts <simdata.json> [--replay=14|30] [--json]");
  const data = JSON.parse(readFileSync(file, "utf8")) as SimData;
  const replay = Number(process.argv.find((a) => a.startsWith("--replay="))?.split("=")[1] ?? 14);
  const grid = process.argv.find((a) => a.startsWith("--grid="))?.split("=")[1] ?? "main";
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
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(results));
  else { console.log(HEADER); for (const r of results) console.log(formatRow(r)); }
}
