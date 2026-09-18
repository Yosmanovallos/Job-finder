/**
 * ADR 0004 — daily Indexing API send planner (pure, no database) and the
 * bounded-backlog property, driven through the same simulator the ADR used.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCHEDULER,
  planIndexingSends,
  type LaneQueues,
  type QueueLane,
  type Schedulable
} from "../src/lib/indexing-scheduler.js";
import { simulate, type SimData } from "../scripts/simulate-indexing-queue.js";

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
    assert.equal(count(plan, "new"), 100, `day ${day}: new jobs keep their half`);
  }
});

test("a stream of new jobs cannot starve API-notified deletes", () => {
  const queues = lanes({ delete: 1_000 });
  for (let day = 0; day < 10; day++) {
    queues.new.push(...Array.from({ length: 5_000 }, (_, i) => ({ id: `n${day}-${i}`, lane: "new" as const, arrival: day * 24 })));
    const plan = planIndexingSends(queues, 200, DEFAULT_SCHEDULER, day * 24);
    assert.equal(count(plan, "delete"), 100, `day ${day}: deletes keep their half`);
  }
  assert.equal(queues.delete.length, 0, "the delete backlog drains in 10 days at 100/day");
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

test("dropped candidates spend no budget; lanes are FIFO", () => {
  const queues = lanes({ new: 300 });
  const plan = planIndexingSends(queues, 100, DEFAULT_SCHEDULER, 0, (row) => Number(row.id.split("-")[1]) % 2 === 0);
  assert.equal(plan.length, 100, "odd rows are dropped, the budget is still fully used");
  assert.deepEqual(plan.slice(0, 3).map((row) => row.id), ["new-0", "new-2", "new-4"], "oldest first");
  // 199 rows scanned (100 sent + 99 dropped); the 101 never reached stay queued.
  assert.equal(queues.new.length, 101, "sent and dropped rows leave the lane; unscanned rows stay");
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
