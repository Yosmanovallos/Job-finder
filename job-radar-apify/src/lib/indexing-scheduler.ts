/**
 * Daily Indexing API send planner (docs/adr/0004-indexing-api-notification-policy.md).
 *
 * Pure and synchronous: given the pending candidates of each lane and the
 * remaining publish budget, returns what to send, in order. It removes the
 * chosen (and the dropped) items from the lane arrays it is given. The same
 * function drives scripts/simulate-indexing-queue.ts, so what the ADR measured
 * is what ships.
 *
 * Lanes:
 *   new       — a job became Google-ready (priority 2)
 *   delete    — an API-notified URL was removed (priority 1)
 *   content   — a meaningful change of an already-ready job (priority 3)
 *   reconcile — self-heal / legacy rows (priority 4-5)
 *
 * Every lane is FIFO (oldest first) except where a config says otherwise
 * (`newestFirst` on a weighted config, or the `newest` kind).
 */
export type QueueLane = "new" | "delete" | "content" | "reconcile";

export interface Schedulable {
  lane: QueueLane;
  /** Hours (any epoch) — only differences matter. */
  arrival: number;
}

export type LaneQueues<T extends Schedulable> = Record<QueueLane, T[]>;

export type SchedulerConfig =
  | { kind: "strict"; order: QueueLane[] }
  | { kind: "fixed"; shares: Record<QueueLane, number> }
  | { kind: "weighted"; shares: Record<QueueLane, number>; spillOrder: QueueLane[]; newestFirst?: QueueLane[] }
  | { kind: "age"; targetHours: Record<QueueLane, number> }
  | { kind: "newest"; deleteShare: number };

const LANES: QueueLane[] = ["new", "delete", "content", "reconcile"];

/**
 * The shipped policy (ADR 0004, chosen by simulation, amended by GOOGLE-JOBS
 * F2): new-ready and delete share the budget 50/50 and any unused share spills
 * over — new first, then delete, then content updates, then reconcile.
 * Neither new jobs nor deletes can starve the other while both have work.
 *
 * F2 (simulated with the F0 arrivals and the real tick runs, 200/day): both
 * lanes are drained newest-first. With ~300 new-ready jobs/day the new lane is
 * always full, and FIFO sent each job ~160 h after it became ready, just
 * before its 7-day window closed; newest-first sends the same count within
 * hours (notified within 24 h: 0.4 % → ~33 %). Deletes are newest-first inside
 * their 7-day window, so they go out ~2 h after the purge instead of ~44 days
 * (within 7 days: ~0 % → ~85 %). The share stays 50/50: a new job's only
 * fallback is the sitemap and a delete's is the 410 + sitemap removal (no
 * validThrough without a source date, contract §2), so neither lane has a
 * proven better fallback. Moving it is the only trade-off left: 75/25 gives
 * ~46 % / ~36 % (docs/seo-baseline/2026-11-02-indexing-f2-simulation.md).
 */
export const DEFAULT_SCHEDULER: SchedulerConfig = {
  kind: "weighted",
  shares: { new: 0.5, delete: 0.5, content: 0, reconcile: 0 },
  spillOrder: ["new", "delete", "content", "reconcile"],
  newestFirst: ["new", "delete"]
};

/**
 * @param isUseful called on each candidate before it is chosen; `false` drops
 *   it (removed from its lane, no budget spent) — e.g. its job is gone or its
 *   API window passed.
 */
export function planIndexingSends<T extends Schedulable>(
  lanes: LaneQueues<T>,
  budget: number,
  config: SchedulerConfig,
  now: number,
  isUseful: (item: T) => boolean = () => true
): T[] {
  const plan: T[] = [];
  if (budget <= 0) return plan;

  // Consumed items (sent or dropped) sit outside [head, tail) of each lane;
  // the arrays are compacted once at the end (no O(n) shift per item).
  const head: Record<QueueLane, number> = { new: 0, delete: 0, content: 0, reconcile: 0 };
  const tail: Record<QueueLane, number> = {
    new: lanes.new.length, delete: lanes.delete.length, content: lanes.content.length, reconcile: lanes.reconcile.length
  };
  /** Next useful item of a lane (oldest, or newest when `lifo`), without consuming it. */
  const peek = (lane: QueueLane, lifo = false): T | undefined => {
    const queue = lanes[lane];
    while (head[lane] < tail[lane]) {
      const item = lifo ? queue[tail[lane] - 1] : queue[head[lane]];
      if (isUseful(item)) return item;
      if (lifo) tail[lane]--; else head[lane]++;
    }
    return undefined;
  };
  const take = (lane: QueueLane, limit: number, lifo = false): number => {
    let taken = 0;
    while (taken < limit && plan.length < budget) {
      const item = peek(lane, lifo);
      if (!item) break;
      plan.push(item);
      if (lifo) tail[lane]--; else head[lane]++;
      taken++;
    }
    return taken;
  };
  const compact = () => {
    for (const lane of LANES) lanes[lane] = lanes[lane].slice(head[lane], tail[lane]);
  };
  const share = (fraction: number) => Math.floor(fraction * budget);

  switch (config.kind) {
    case "strict":
      for (const lane of config.order) take(lane, budget);
      break;
    case "fixed":
      for (const lane of LANES) take(lane, share(config.shares[lane]));
      break;
    case "weighted": {
      const lifo = (lane: QueueLane) => config.newestFirst?.includes(lane) ?? false;
      for (const lane of LANES) take(lane, share(config.shares[lane]), lifo(lane));
      for (const lane of config.spillOrder) take(lane, budget, lifo(lane));
      break;
    }
    case "age":
      while (plan.length < budget) {
        let best: QueueLane | null = null;
        let bestUrgency = -Infinity;
        for (const lane of LANES) {
          const head = peek(lane);
          if (!head) continue;
          const urgency = (now - head.arrival) / config.targetHours[lane];
          if (urgency > bestUrgency) { bestUrgency = urgency; best = lane; }
        }
        if (!best) break;
        take(best, 1);
      }
      break;
    case "newest": {
      take("delete", share(config.deleteShare));
      take("new", budget, true);
      for (const lane of ["delete", "content", "reconcile"] as const) take(lane, budget);
      break;
    }
  }
  compact();
  return plan;
}

/** Lanes a config drains newest-first: the caller must hand it the NEWEST pending rows of those lanes. */
export function newestFirstLanes(config: SchedulerConfig): QueueLane[] {
  if (config.kind === "weighted") return config.newestFirst ?? [];
  if (config.kind === "newest") return ["new"];
  return [];
}

/**
 * How much of the rolling 24 h budget one tick may spend (GOOGLE-JOBS F2).
 *
 * The cron fires ~5 times a day at drifting hours. Spending the whole rolling
 * budget in the first run of each window sends the day's 200 at once, at a
 * later hour every day (F0 even saw a Bogotá day with no sends). Pacing lets a
 * run spend headroom × quota/24 per hour since the last attempt, so the quota
 * is spread over the day's runs whatever their cadence; never above
 * `remaining`, so the rolling 24 h cap still holds.
 *
 * The gap is capped at PACE_MAX_GAP_HOURS: after a burst (the old behavior, or
 * a quiet day) the next attempt comes ~24 h later, and an uncapped gap would
 * hand it the whole quota again, so the burst would repeat forever.
 *
 * Replayed over the 300 real gaps between runs (2026-09-06 … 11-02, see the
 * scheduler tests): 177 sends/day against 181.5 for the burst (a rolling
 * window cannot reuse a freed slot before the next run, whatever the policy),
 * at most 74 per run against 200, and 94 % of runs send against 17 %.
 *
 * @param hoursSinceLastAttempt hours since the last sent/failed attempt; 24 or
 *   more when there was none in the rolling window.
 */
export const PACE_MAX_GAP_HOURS = 8;
export const PACE_HEADROOM = 1.1;

export function pacedSendAllowance(
  quota: number,
  remaining: number,
  hoursSinceLastAttempt: number,
  maxGapHours = PACE_MAX_GAP_HOURS,
  headroom = PACE_HEADROOM
): number {
  if (remaining <= 0) return 0;
  const gap = Math.min(Math.max(0, hoursSinceLastAttempt), maxGapHours);
  return Math.min(remaining, Math.ceil((headroom * quota * gap) / 24));
}
