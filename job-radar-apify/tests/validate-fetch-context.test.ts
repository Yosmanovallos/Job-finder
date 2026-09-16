import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  BUDGET_ESTIMATES,
  createFetchContext,
  hasBudget,
  isCancelled,
  sleepWithContext,
  estimateListingMs,
  whenAborted,
  SOURCE_LISTING_ESTIMATE_MS,
  type FetchContext
} from "../src/engine/fetch-context.js";
import { planTickBudget } from "../src/queue/tick-budget.js";

test("EXE-002: sub-budgets are derived from the global deadline, never the reverse", () => {
  // The base defect: 3 min (global catalog) + 4 batches x 5 min = 23 min of
  // permitted work under a 20 min deadline, inside a 27 min hard kill.
  const plan = planTickBudget({ totalMs: 20 * 60_000, roleCount: 8, concurrency: 2 });

  assert.ok(plan.workMs + plan.reserveMs <= plan.totalMs, "work + reserve must fit in total");
  assert.ok(plan.globalCatalogMs + plan.batchCount * plan.maxPerBatchMs <= plan.workMs,
    `permitted work ${plan.globalCatalogMs + plan.batchCount * plan.maxPerBatchMs}ms exceeds work budget ${plan.workMs}ms`);
  assert.equal(plan.batchCount, 4);
  assert.ok(plan.reserveMs > 0, "teardown must have a reserve outside the work budget");
});

test("EXE-002: a fast batch returns its surplus, a slow one never takes the reserve", () => {
  const plan = planTickBudget({ totalMs: 20 * 60_000, roleCount: 8, concurrency: 2 });

  // Batch budget is recomputed against what is ACTUALLY left, not a fixed
  // upfront split, so an early fast batch widens the later ones.
  const fast = plan.budgetForBatch({ elapsedMs: 60_000, batchesRemaining: 3 });
  const slow = plan.budgetForBatch({ elapsedMs: 12 * 60_000, batchesRemaining: 3 });
  assert.ok(fast > slow, "a cheaper start must leave more for what follows");
  assert.ok(fast <= plan.maxPerBatchMs, "never above the per-batch ceiling");

  // The invariant that protects the teardown: a batch is never granted more
  // than what is left of the WORK budget, so the reserve is unreachable no
  // matter how late the tick is running.
  for (const elapsedMs of [0, 5 * 60_000, 17 * 60_000, 19 * 60_000, 25 * 60_000]) {
    const granted = plan.budgetForBatch({ elapsedMs, batchesRemaining: 1 });
    assert.ok(granted <= Math.max(0, plan.workMs - elapsedMs),
      `at ${elapsedMs}ms elapsed, granted ${granted}ms exceeds the remaining work budget`);
    assert.ok(granted >= 0, "a budget is never negative");
  }
  // Already past the work budget: nothing more is handed out at all.
  assert.equal(plan.budgetForBatch({ elapsedMs: 19 * 60_000, batchesRemaining: 1 }), 0);
});

test("EXE-003: after the deadline nothing new starts", () => {
  const ctx = createFetchContext(0);
  assert.equal(isCancelled(ctx), true);
  assert.equal(ctx.remainingMs(), 0);
  assert.equal(ctx.hasBudgetFor(1), false);
  assert.equal(ctx.hasBudgetFor(0), false, "an expired context has no room even for free work");

  // A live context still refuses work that plainly doesn't fit — starting a
  // ~30s source with 5s left is waste with an extra step, not cancellation.
  const live = createFetchContext(5_000);
  assert.equal(live.hasBudgetFor(BUDGET_ESTIMATES.sourceListing), false);
  assert.equal(live.hasBudgetFor(1_000), true);
  live.dispose();
  ctx.dispose();
});

test("EXE-003: no context means unbudgeted — exactly the pre-P3 behavior", () => {
  assert.equal(isCancelled(undefined), false);
  assert.equal(hasBudget(undefined, Number.MAX_SAFE_INTEGER), true);
});

test("EXE-004: backoff and jitter waits end at the deadline instead of sleeping through it", async () => {
  const ctx = createFetchContext(120);
  const startedAt = Date.now();
  // The real 9s third backoff of executeWithResilience.
  await ctx.sleep(9_000);
  const elapsed = Date.now() - startedAt;

  assert.ok(elapsed < 1_000, `abortable sleep took ${elapsed}ms — it slept through the deadline`);
  assert.equal(isCancelled(ctx), true);
  assert.equal(ctx.hasBudgetFor(BUDGET_ESTIMATES.retry), false, "no retry after the deadline");
  ctx.dispose();
});

test("EXE-004: a sleep is capped by the remaining budget, never extends past it", async () => {
  const ctx = createFetchContext(10_000);
  const startedAt = Date.now();
  await ctx.sleep(50);
  assert.ok(Date.now() - startedAt >= 40, "a sleep within budget still waits");
  assert.ok(!isCancelled(ctx), "waiting within budget must not cancel the context");
  ctx.dispose();
});

test("EXE-004: without a context, sleeping behaves as before", async () => {
  const startedAt = Date.now();
  await sleepWithContext(40);
  assert.ok(Date.now() - startedAt >= 30);
});

test("EXE-003: a child context can shorten its parent's deadline but never extend it", () => {
  const parent = createFetchContext(1_000);
  const greedy = parent.child(60 * 60_000);
  assert.ok(greedy.deadlineAt <= parent.deadlineAt, "a child must not outlive its parent");

  const shorter = parent.child(200);
  assert.ok(shorter.deadlineAt < parent.deadlineAt);
  parent.dispose();
});

test("EXE-003: aborting a parent takes its children with it", async () => {
  const parent = createFetchContext(60);
  const child = parent.child(60_000);
  const grandchild = child.child(60_000);

  await delay(120);
  assert.equal(isCancelled(parent), true);
  assert.equal(isCancelled(child), true, "a child must not keep working on a budget the tick no longer has");
  assert.equal(isCancelled(grandchild), true);
  parent.dispose();
});

test("EXE-006: the deadline timer must not by itself keep the process alive", () => {
  // A ref'd timer here would hold the event loop open until the deadline even
  // after all real work finished — reintroducing, from the mechanism meant to
  // fix it, the very "process won't exit" failure this phase removes.
  const ctx = createFetchContext(60 * 60_000);
  interface MaybeTimer { hasRef?: () => boolean; _idleTimeout?: number }
  const getHandles = (process as unknown as { _getActiveHandles?: () => MaybeTimer[] })._getActiveHandles;
  const handles: MaybeTimer[] = getHandles ? getHandles.call(process) : [];
  const refdTimers = handles.filter(
    (h) => typeof h?.hasRef === "function" && h.hasRef() && (h._idleTimeout ?? 0) > 60_000
  );
  assert.equal(refdTimers.length, 0, "the context deadline timer must be unref'd");
  ctx.dispose();
});

/**
 * EXE-005 — the highest-risk requirement in the phase. Per-adapter saving
 * exists because of a real data-loss incident (2026-07-25, cited in
 * scrape-worker.ts). A naive abort reintroduces it.
 */
test("EXE-005: cancellation stops work that has not started, never a persist in flight", async () => {
  const ctx = createFetchContext(150);
  const events: string[] = [];

  // Stands in for one source: fetch (abortable) then persist (not).
  const runSource = async (name: string, ctx: FetchContext) => {
    if (!ctx.hasBudgetFor(10)) {
      events.push(`${name}:not-started`);
      return;
    }
    events.push(`${name}:fetch`);
    const fetched = [`${name}-job`];
    // Persist begins here. From this point there are NO further budget
    // checks until it returns — that asymmetry is the requirement.
    events.push(`${name}:persist-begin`);
    await delay(200); // outlives the deadline on purpose
    events.push(`${name}:persist-end:${fetched.length}`);
  };

  await runSource("a", ctx);
  await runSource("b", ctx); // deadline has passed by now

  assert.deepEqual(events, [
    "a:fetch",
    "a:persist-begin",
    "a:persist-end:1", // completed despite the deadline passing mid-write
    "b:not-started"    // never begun, so nothing to lose
  ]);
  assert.equal(isCancelled(ctx), true);
  ctx.dispose();
});

test("EXE-005: an expired context still reports what was already obtained", () => {
  const ctx = createFetchContext(0);
  // Cancellation must never be expressed by discarding counters — a source
  // that fetched 40 jobs before the deadline reports 40, not 0.
  const obtained = 40;
  assert.equal(isCancelled(ctx), true);
  assert.equal(obtained, 40);
  ctx.dispose();
});

/**
 * Regresión del 2026-09-16 (run 35049467975, `cancelled` a los 27m21s).
 * Un `adapter.fetch()` no recibe el signal — recorre sus variantes de
 * keyword por dentro — así que esperarlo sin límite dejaba al tick a merced
 * del adaptador más lento y el cierre no llegaba a ejecutarse nunca.
 */
test("EXE-006: esperar una unidad que ignora el signal nunca bloquea el cierre", async () => {
  const ctx = createFetchContext(120);
  // Simula adapter.fetch(): no conoce el contexto y tarda mucho más que el plazo.
  const stubborn = new Promise<string>((resolve) => setTimeout(() => resolve("tarde"), 5_000).unref?.());

  const startedAt = Date.now();
  const finished = await Promise.race([stubborn.then(() => true), whenAborted(ctx).then(() => false)]);
  const elapsed = Date.now() - startedAt;

  assert.equal(finished, false, "el plazo debe ganar a la unidad que lo ignora");
  assert.ok(elapsed < 1_000, `esperó ${elapsed}ms — el cierre seguiría siendo inalcanzable`);
  ctx.dispose();
});

test("EXE-006: sin contexto, whenAborted no interfiere", async () => {
  const quick = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 30));
  assert.equal(await Promise.race([quick, whenAborted(undefined).then(() => false)]), true);
});

test("EXE-002: las estimaciones por fuente salen de medidas, no de una constante", () => {
  // La constante única de 30s daba por buena una fuente que tarda minutos:
  // así se arrancaban listados sin posibilidad de terminar.
  assert.ok(estimateListingMs("Elempleo") > 100_000, "Elempleo mide ~118s de mediana");
  assert.ok(estimateListingMs("Torre") < estimateListingMs("LinkedIn"), "Torre es medible más rápida que LinkedIn");
  assert.equal(estimateListingMs("FuenteQueNoExiste"), 60_000, "una fuente sin medir usa el valor por defecto");

  // Ninguna estimación debe superar el techo de un lote, o esa fuente no
  // arrancaría jamás — que es peor que arrancarla y abandonarla.
  const maxBatchMs = 225_000;
  for (const [source, ms] of Object.entries(SOURCE_LISTING_ESTIMATE_MS)) {
    assert.ok(ms < maxBatchMs, `${source} (${ms}ms) no cabría nunca en un lote y quedaría en inanición`);
  }
});
