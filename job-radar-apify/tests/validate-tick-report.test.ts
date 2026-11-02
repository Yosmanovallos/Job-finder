import assert from "node:assert/strict";
import test from "node:test";
import { RunRecorder, reportSourceSignal, type AttemptOutcome } from "../src/observability/run-telemetry.js";
import {
  DEGRADED_STREAK_THRESHOLD,
  buildTickReport,
  currentTickHealth,
  degradationStreaks,
  drainHealthLog,
  formatDrainSummary,
  groupHealthRows,
  isDegradedAttempt,
  streakWarnings,
  type DrainCountersLike,
  type TickReportInput
} from "../src/observability/tick-report.js";

const NOW = new Date("2026-11-02T00:15:53.000Z");

function outcome(source: string, stage: AttemptOutcome["stage"], status: AttemptOutcome["status"], reason = "ok", notFound = 0): AttemptOutcome {
  return { source, stage, status, reason, notFound };
}

function drain(partial: Partial<DrainCountersLike> = {}): DrainCountersLike {
  return { claimed: 0, complete: 0, retry: 0, noDetail: 0, failed: 0, stoppedEarly: false, faultClasses: {}, ...partial };
}

function input(partial: Partial<TickReportInput> = {}): TickReportInput {
  return {
    country: "CO",
    trigger: "schedule",
    runStatus: "partial",
    runReason: "some_sources_degraded",
    roles: { due: 35, duePairs: 120, selected: 8, completed: 5, timedOut: 3 },
    savedCount: 68,
    duplicateCount: 374,
    purged: 10,
    attempts: [],
    listings: {},
    drain: {},
    pacedOut: [],
    ...partial
  };
}

test("neutral outcomes never count as degradation (same set as circuit-policy)", () => {
  for (const status of ["success", "empty", "skipped", "timeout"] as const) assert.equal(isDegradedAttempt(status, "x"), false, status);
  assert.equal(isDegradedAttempt("partial", "deadline_exceeded"), false);
  for (const status of ["failed", "blocked", "misconfigured", "interrupted"] as const) assert.equal(isDegradedAttempt(status, "x"), true, status);
  assert.equal(isDegradedAttempt("partial", "retries_exhausted"), true);
});

// Run 41364751660 (2026-11-02): every listing row "success", run `partial`,
// LinkedIn detail drain hit a 429. The old table showed only green rows.
test("a tick whose listings are all green but whose details hit 429 is reported as degraded", () => {
  const report = buildTickReport(
    input({
      attempts: [
        outcome("Computrabajo", "listing", "success"),
        outcome("Magneto", "listing", "success"),
        outcome("LinkedIn", "detail", "failed", "retries_exhausted")
      ],
      listings: { Computrabajo: [{ fetched: 369, threw: false }], Magneto: [{ fetched: 192, threw: false }] },
      drain: { LinkedIn: drain({ claimed: 8, complete: 2, retry: 1, stoppedEarly: true, faultClasses: { FetchRateLimitedError: 1 } }) }
    }),
    NOW
  );
  assert.deepEqual(report.degradedSources, ["LinkedIn"]);
  assert.match(report.markdown, /⚠️ Estado de la ejecución: \*\*partial\*\* \(some_sources_degraded\)/);
  assert.match(report.markdown, /Fuentes degradadas en este tick: \*\*LinkedIn\*\*/);
  assert.match(report.markdown, /\| LinkedIn \| — \| — \| .*429×1/);
  assert.match(report.markdown, /pendientes al cerrar \*\*30\*\*/);
  const linkedIn = report.sources.find((entry) => entry.source === "LinkedIn")!;
  assert.equal(linkedIn.drain.rateLimited, 1);
});

test("Elempleo per-keyword 404s are counted apart and do not degrade the source", () => {
  const report = buildTickReport(
    input({
      attempts: [outcome("Elempleo", "listing", "success", "ok", 1), outcome("Elempleo", "listing", "success", "ok", 1)],
      listings: { Elempleo: [{ fetched: 21, threw: false }, { fetched: 3, threw: false }] }
    }),
    NOW
  );
  const elempleo = report.sources[0];
  assert.equal(elempleo.listing.notFound, 2);
  assert.equal(elempleo.degraded, false);
  assert.match(report.markdown, /2 búsqueda\(s\) 404/);
});

test("an adapter that threw degrades the source, but its message never reaches the report", () => {
  const report = buildTickReport(
    input({
      attempts: [outcome("Torre", "listing", "failed", "exception")],
      listings: { Torre: [{ fetched: 0, threw: true }] }
    }),
    NOW
  );
  assert.deepEqual(report.degradedSources, ["Torre"]);
  const serialized = JSON.stringify(report.log) + report.markdown;
  assert.doesNotMatch(serialized, /https?:\/\//);
  assert.equal((report.log as { event: string }).event, "tick_health");
});

test("the structured log carries roles, pacing and per-source health", () => {
  const report = buildTickReport(input({ pacedOut: ["LinkedIn", "Computrabajo"], trigger: "workflow_dispatch" }), NOW);
  const log = report.log as { roles: { pending: number; selected: number }; paced_out: string[]; trigger: string };
  assert.equal(log.roles.pending, 30);
  assert.equal(log.roles.selected, 8);
  assert.deepEqual(log.paced_out, ["LinkedIn", "Computrabajo"]);
  assert.equal(log.trigger, "workflow_dispatch");
  assert.match(report.markdown, /ritmo protegido, fuera de este tick: LinkedIn, Computrabajo/);
});

test("streaks: consecutive degraded ticks count, a healthy tick resets, an absent tick neither breaks nor extends", () => {
  const ticks = [
    new Map([["LinkedIn", true], ["Elempleo", true]]),
    new Map([["LinkedIn", true]]), // Elempleo not due this tick
    new Map([["LinkedIn", true], ["Elempleo", true]]),
    new Map([["LinkedIn", false], ["Elempleo", true]]),
    new Map([["LinkedIn", true]])
  ];
  const streaks = degradationStreaks(ticks);
  assert.equal(streaks.get("LinkedIn"), 3);
  assert.equal(streaks.get("Elempleo"), 3);
  assert.equal(degradationStreaks([new Map([["Torre", false]]), new Map([["Torre", true]])]).get("Torre"), undefined);
});

test("warnings fire only at the threshold, never as a failure", () => {
  const warnings = streakWarnings(new Map([["LinkedIn", DEGRADED_STREAK_THRESHOLD], ["Torre", DEGRADED_STREAK_THRESHOLD - 1]]), "CO");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^::warning title=Fuente degradada 3 ticks seguidos \(CO\)::LinkedIn /);
  assert.doesNotMatch(warnings.join(""), /::error/);
});

test("history rows group per run, a source is degraded if any of its attempts was", () => {
  const history = groupHealthRows(
    [
      { run_id: "b", source_name: "LinkedIn", status: "success", reason: "ok" },
      { run_id: "b", source_name: "LinkedIn", status: "failed", reason: "retries_exhausted" },
      { run_id: "a", source_name: "LinkedIn", status: "timeout", reason: "deadline_exceeded" },
      { run_id: "zz", source_name: "LinkedIn", status: "failed", reason: "x" }
    ],
    ["b", "a"]
  );
  assert.equal(history[0].get("LinkedIn"), true);
  assert.equal(history[1].get("LinkedIn"), false);
  const report = buildTickReport(input({ attempts: [outcome("LinkedIn", "detail", "blocked", "http_deny")] }), NOW);
  assert.equal(degradationStreaks([currentTickHealth(report.sources), ...history]).get("LinkedIn"), 2);
});

test("drain step summary shows 429s and paced-out sources without error text", () => {
  const drained = {
    LinkedIn: drain({ claimed: 8, retry: 4, stoppedEarly: true, faultClasses: { FetchRateLimitedError: 1 } }),
    Magneto: drain({ claimed: 30, complete: 28 }),
    Elempleo: drain()
  };
  const markdown = formatDrainSummary("CO", drained, []);
  assert.match(markdown, /\| LinkedIn \| 8 \| 0 \| 4 \| 0 \| 0 \| \*\*1\*\* \| FetchRateLimitedError×1 \| sí \|/);
  assert.doesNotMatch(markdown, /Elempleo/);
  assert.match(formatDrainSummary("CO", {}, ["LinkedIn"]), /ritmo protegido: LinkedIn/);
  const log = drainHealthLog("CO", drained, []) as { sources: { source: string; rate_limited: number }[] };
  assert.deepEqual(log.sources.map((s) => [s.source, s.rate_limited]), [["LinkedIn", 1], ["Magneto", 0]]);
});

test("recorder outcomes expose status, reason and not_found without changing classification", async () => {
  const recorder = RunRecorder.disabled();
  await recorder.trackAttempt({ source: "Elempleo", role: "AI Engineer", stage: "listing" }, async (attempt) => {
    reportSourceSignal("not_found");
    attempt.setCounters({ received: 2, valid: 2, filtered: 0, new: 1, duplicate: 1 });
  });
  await recorder.trackAttempt({ source: "Elempleo", role: "Chef", stage: "listing" }, async (attempt) => {
    reportSourceSignal("swallowed_error");
    attempt.setCounters({ received: 0, valid: 0, filtered: 0, new: 0, duplicate: 0 });
  });
  assert.deepEqual(recorder.outcomes(), [
    { source: "Elempleo", stage: "listing", status: "success", reason: "ok", notFound: 1 },
    { source: "Elempleo", stage: "listing", status: "failed", reason: "swallowed_error", notFound: 0 }
  ]);
});
