/**
 * ADR 0004 — daily Indexing API send planner (pure, no database) and the
 * bounded-backlog property, driven through the same simulator the ADR used.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_SCHEDULER,
  newestFirstLanes,
  pacedSendAllowance,
  planIndexingSends,
  type LaneQueues,
  type QueueLane,
  type Schedulable,
  type SchedulerConfig
} from "../src/lib/indexing-scheduler.js";
import { simDataFromFunnel, simulate, type FunnelExport, type SimData, type SimParams } from "../scripts/simulate-indexing-queue.js";

interface Row extends Schedulable { id: string }

function lanes(counts: Partial<Record<QueueLane, number>>): LaneQueues<Row> {
  const make = (lane: QueueLane) =>
    Array.from({ length: counts[lane] ?? 0 }, (_, i) => ({ id: `${lane}-${i}`, lane, arrival: i }));
  return { new: make("new"), delete: make("delete"), content: make("content"), reconcile: make("reconcile") };
}

const count = (plan: Row[], lane: QueueLane) => plan.filter((row) => row.lane === lane).length;

test("a delete backlog cannot starve new ready jobs, day after day", () => {
  const queues = lanes({ delete: 50_000 });
  for (let day = 0; day < 30; day++) {
    queues.new.push(...Array.from({ length: 400 }, (_, i) => ({ id: `n${day}-${i}`, lane: "new" as const, arrival: day * 24 })));
    const plan = planIndexingSends(queues, 200, DEFAULT_SCHEDULER, day * 24);
    assert.equal(plan.length, 200);
    assert.equal(count(plan, "new"), 150, `day ${day}: new jobs keep their 75 %`);
  }
});

test("a stream of new jobs cannot starve API-notified deletes", () => {
  const queues = lanes({ delete: 1_000 });
  for (let day = 0; day < 20; day++) {
    queues.new.push(...Array.from({ length: 5_000 }, (_, i) => ({ id: `n${day}-${i}`, lane: "new" as const, arrival: day * 24 })));
    const plan = planIndexingSends(queues, 200, DEFAULT_SCHEDULER, day * 24);
    assert.equal(count(plan, "delete"), 50, `day ${day}: deletes keep their 25 %`);
  }
  assert.equal(queues.delete.length, 0, "the delete backlog drains in 20 days at 50/day");
});

test("deletes are newest-first too (GOOGLE-JOBS F2): a fresh purge is sent before an old one", () => {
  const plan = planIndexingSends(lanes({ new: 500, delete: 500 }), 200, DEFAULT_SCHEDULER, 0);
  assert.deepEqual(plan.filter((row) => row.lane === "delete").slice(0, 2).map((row) => row.id), ["delete-499", "delete-498"]);
});

test("unused share spills over: new → delete → content → reconcile", () => {
  assert.equal(count(planIndexingSends(lanes({ new: 500 }), 200, DEFAULT_SCHEDULER, 0), "new"), 200, "no deletes → all to new");
  const fewNew = planIndexingSends(lanes({ new: 10, delete: 500 }), 200, DEFAULT_SCHEDULER, 0);
  assert.deepEqual([count(fewNew, "new"), count(fewNew, "delete")], [10, 190], "few new → deletes take the rest");
  const tail = planIndexingSends(lanes({ new: 20, delete: 30, content: 100, reconcile: 100 }), 200, DEFAULT_SCHEDULER, 0);
  assert.deepEqual([count(tail, "new"), count(tail, "delete"), count(tail, "content"), count(tail, "reconcile")], [20, 30, 100, 50]);
  const busy = planIndexingSends(lanes({ new: 500, delete: 500, content: 50 }), 200, DEFAULT_SCHEDULER, 0);
  assert.equal(count(busy, "content"), 0, "content updates rank below new jobs and deletes");
});

test("dropped candidates spend no budget; the new lane is newest-first (GOOGLE-JOBS F2)", () => {
  const queues = lanes({ new: 300 });
  const plan = planIndexingSends(queues, 100, DEFAULT_SCHEDULER, 0, (row) => Number(row.id.split("-")[1]) % 2 === 0);
  assert.equal(plan.length, 100, "odd rows are dropped, the budget is still fully used");
  assert.deepEqual(plan.slice(0, 3).map((row) => row.id), ["new-298", "new-296", "new-294"], "newest first");
  // 200 rows scanned (100 sent + 100 dropped); the 100 oldest never reached stay queued.
  assert.equal(queues.new.length, 100, "sent and dropped rows leave the lane; unscanned rows stay");
  assert.equal(queues.new[0].id, "new-0", "what is never reached waits for its API window to close");
});

test("the shipped scheduler drains new jobs newest-first; content and reconcile stay FIFO", () => {
  assert.ok(newestFirstLanes(DEFAULT_SCHEDULER).includes("new"));
  const plan = planIndexingSends(lanes({ new: 50, content: 50, reconcile: 50 }), 120, DEFAULT_SCHEDULER, 0);
  assert.equal(plan[0].id, "new-49");
  assert.deepEqual(plan.filter((row) => row.lane === "content").slice(0, 2).map((row) => row.id), ["content-0", "content-1"]);
  assert.deepEqual(plan.filter((row) => row.lane === "reconcile").slice(0, 2).map((row) => row.id), ["reconcile-0", "reconcile-1"]);
});

test("contrast (why S0 was rejected): strict delete-first priority starves new jobs", () => {
  const plan = planIndexingSends(lanes({ delete: 50_000, new: 400 }), 200, { kind: "strict", order: ["delete", "new", "content", "reconcile"] }, 0);
  assert.equal(count(plan, "new"), 0);
});

function overloadData(readyPerHour: number): SimData {
  const t0 = 500_000;
  const jobs: SimData["jobs"] = [];
  for (let h = t0 - 16 * 24; h < t0; h++) for (let i = 0; i < readyPerHour; i++) jobs.push([h, h, 1, 0, 0, "LinkedIn"]);
  jobs.push([t0 - 1, t0 - 1, 0, 0, 0, "LinkedIn"]);
  const lifetimes: SimData["lifetimes"] = Array.from({ length: 100 }, (_, i) => [t0 - 40 * 24 + i, t0 - 40 * 24 + i + 30 * 24 + (i % 10) * 24, 0]);
  return { jobs, lifetimes, pendingDeletes: [] };
}

test("under 5× overload the queue stays bounded by the API window, and new jobs are still served", () => {
  const data = overloadData(40); // 960 new ready/day against 200/day
  const bounded = simulate(data, { policy: "D2", scheduler: "S2", quota: 200, windowDays: 7, replayDays: 14 });
  // Plateau: new lane ≤ 7 days of arrivals; the D2 delete lane ≤ what was sent.
  assert.ok(bounded.queue.d90 <= bounded.queue.d60 * 1.05, `plateau: ${bounded.queue.d60} → ${bounded.queue.d90}`);
  assert.ok(Math.abs(bounded.growthPerDay) <= 50, `no sustained growth: ${bounded.growthPerDay}/day`);
  assert.ok(bounded.expiredUpdates > 0, "missed opportunities fall back to the sitemap");
  assert.ok(bounded.sends.new > 0 && bounded.sends.delete > 0, "both lanes are served");
  const unbounded = simulate(data, { policy: "D2", scheduler: "S2", quota: 200, windowDays: null, replayDays: 14 });
  assert.ok(unbounded.queue.d90 > 3 * bounded.queue.d90, "without the window the backlog holds weeks-old notifications");
});

test("newestFirst lanes drain the newest rows first; the other lanes stay FIFO", () => {
  const config: SchedulerConfig = {
    kind: "weighted",
    shares: { new: 0.5, delete: 0.5, content: 0, reconcile: 0 },
    spillOrder: ["new", "delete", "content", "reconcile"],
    newestFirst: ["new"]
  };
  const queues = lanes({ new: 300, delete: 300 });
  const plan = planIndexingSends(queues, 10, config, 0);
  assert.deepEqual(plan.filter((row) => row.lane === "new").map((row) => row.id), ["new-299", "new-298", "new-297", "new-296", "new-295"]);
  assert.deepEqual(plan.filter((row) => row.lane === "delete").map((row) => row.id), ["delete-0", "delete-1", "delete-2", "delete-3", "delete-4"]);
  assert.deepEqual(newestFirstLanes(config), ["new"]);
  assert.deepEqual(newestFirstLanes({ kind: "strict", order: ["new"] }), []);
});

// The 300 real gaps between indexing-tick runs (2026-09-06 … 2026-11-02).
const tickGaps = JSON.parse(readFileSync(new URL("../docs/seo-baseline/2026-11-02-indexing-tick-gaps.json", import.meta.url), "utf8")) as { gapsH: number[] };

/** Replays the real cadence with always-full lanes; returns each run's sends and time. */
function replayPacing(allowance: (remaining: number, sinceLast: number) => number) {
  const runs: { t: number; sent: number }[] = [];
  let t = 0;
  for (const gap of [...tickGaps.gapsH, ...tickGaps.gapsH]) {
    t += gap;
    const inWindow = runs.filter((run) => run.t > t - 24 && run.sent > 0);
    const remaining = 200 - inWindow.reduce((sum, run) => sum + run.sent, 0);
    const sinceLast = inWindow.length > 0 ? t - inWindow[inWindow.length - 1].t : 24;
    runs.push({ t, sent: allowance(remaining, sinceLast) });
  }
  return runs;
}

test("pacing spreads the quota over the real tick runs at almost no cost", () => {
  const paced = replayPacing((remaining, sinceLast) => pacedSendAllowance(200, remaining, sinceLast));
  const burst = replayPacing((remaining) => remaining);
  const days = paced[paced.length - 1].t / 24;
  for (const run of paced) {
    const window = paced.filter((other) => other.t > run.t - 24 && other.t <= run.t);
    assert.ok(window.reduce((sum, other) => sum + other.sent, 0) <= 200, "never more than the quota in any rolling 24 h");
  }
  const perDay = (runs: typeof paced) => runs.reduce((sum, run) => sum + run.sent, 0) / days;
  const settled = paced.slice(30);
  assert.ok(Math.max(...settled.map((run) => run.sent)) <= 80, "one run sends well under half the quota");
  assert.equal(Math.max(...burst.map((run) => run.sent)), 200, "contrast: the burst sends the whole quota at once");
  assert.ok(settled.filter((run) => run.sent === 0).length <= 0.1 * settled.length, "nearly every run sends");
  assert.ok(burst.slice(30).filter((run) => run.sent === 0).length >= 0.75 * settled.length, "contrast: most burst runs send nothing");
  assert.ok(perDay(paced) >= 0.97 * perDay(burst), `pacing costs ≤3 % of the quota: ${perDay(paced).toFixed(1)} vs ${perDay(burst).toFixed(1)}/day`);
});

test("pacedSendAllowance: rolling cap, gap cap, and a delayed cron still gets its share", () => {
  assert.equal(pacedSendAllowance(200, 0, 5), 0, "quota spent in the last 24 h");
  assert.equal(pacedSendAllowance(200, 10, 5), 10, "never above the rolling remaining budget");
  assert.equal(pacedSendAllowance(200, 200, 24), Math.ceil((1.1 * 200 * 8) / 24), "after a quiet day: capped, not a new burst");
  assert.ok(pacedSendAllowance(200, 200, 10) >= Math.ceil((200 * 8) / 24), "the longest real gap gets at least its capped share");
  assert.equal(pacedSendAllowance(200, 200, 0), 0);
});

// F0 reconstruction (GOOGLE-JOBS F2): the simulator must reproduce what F0 measured before it is trusted.
const funnel = JSON.parse(readFileSync(new URL("../docs/seo-baseline/2026-11-01-google-jobs-funnel.json", import.meta.url), "utf8")) as FunnelExport;
const f0 = simDataFromFunnel(funnel, tickGaps.gapsH);
const f0Base: SimParams = { policy: "D2", scheduler: "S2", quota: 200, windowDays: 7, replayDays: 13, legacyReconcile: false, newShare: 0.5, sendMode: "burst" };

test("the F0 reconstruction reproduces the measured FIFO funnel", () => {
  const today = simulate(f0, f0Base);
  assert.ok(today.newSentP50h >= 6 * 24, `FIFO sends a week late (F0: 158-167 h): ${today.newSentP50h} h`);
  assert.ok(today.newWithin24hPct < 2, `almost nothing within 24 h: ${today.newWithin24hPct}%`);
  assert.ok(today.newSentPct >= 25 && today.newSentPct <= 40, `about a third notified (F0: 30 %): ${today.newSentPct}%`);
  assert.ok(today.sendsPerDay >= 180 && today.sendsPerDay <= 190, `burst sends ~187/day (F0): ${today.sendsPerDay}`);
  assert.ok(today.deleteLaneEnd > 8_000, `the delete backlog does not drain (F0: 8,850): ${today.deleteLaneEnd}`);
});

test("change 1 — newest-first notifies new jobs within 24 h instead of a week later (F0 arrivals, 200/day)", () => {
  const fifo = simulate(f0, f0Base);
  const newest = simulate(f0, { ...f0Base, scheduler: "S2N" });
  assert.ok(newest.newWithin24hPct >= 25, `newest-first: ${newest.newWithin24hPct}% within 24 h`);
  assert.ok(fifo.newWithin24hPct < 2, `FIFO: ${fifo.newWithin24hPct}% within 24 h`);
  assert.ok(newest.newSentP50h <= 12, `sent within hours of readiness: ${newest.newSentP50h} h`);
  assert.ok(newest.newSentPct >= fifo.newSentPct - 5, "about as many new jobs notified overall");
  assert.equal(newest.sends.delete, fifo.sends.delete, "the delete lane keeps its share");
});

test("change 2 — the delete lane: 25 % newest-first inside a 7-day window (F0 arrivals, 200/day)", () => {
  const today = simulate(f0, f0Base);
  const f2 = simulate(f0, { ...f0Base, scheduler: "S2NB", newShare: 0.75, deleteWindowDays: 7 });
  assert.ok(today.delWithin7dPct < 1, `today almost no delete goes out within 7 days of the purge: ${today.delWithin7dPct}%`);
  assert.ok(today.deleteLaneEnd > 8_000, "today the delete backlog never drains");
  assert.ok(f2.delWithin7dPct >= 30, `deletes sent within 7 days: ${f2.delWithin7dPct}%`);
  assert.ok(f2.delP50h === Infinity || f2.delP50h <= 7 * 24, "a delete is sent within its window or closed");
  assert.ok(f2.deleteLaneEnd < 1_000, `the delete lane is bounded by its window: ${f2.deleteLaneEnd}`);
  assert.ok(f2.newWithin24hPct >= 40, `new-ready notified within 24 h: ${f2.newWithin24hPct}%`);
  const half = simulate(f0, { ...f0Base, scheduler: "S2NB", newShare: 0.5, deleteWindowDays: 7 });
  assert.ok(half.delWithin7dPct > f2.delWithin7dPct && half.newWithin24hPct < f2.newWithin24hPct, "the share is the trade-off between the two lanes");
});
