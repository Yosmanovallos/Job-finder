import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  ATTEMPT_STATUSES,
  RESERVED_ATTEMPT_STATUSES,
  RunRecorder,
  classifyAttempt,
  decodeRunCursor,
  deriveRunStatus,
  detectRunEnvironment,
  emptySignalTally,
  encodeRunCursor,
  reportSourceSignal,
  type AttemptCounters,
  type AttemptFinishRecord,
  type AttemptStartRecord,
  type RunFinishRecord,
  type RunStartRecord,
  type RunTelemetryStore,
  type SignalTally
} from "../src/observability/run-telemetry.js";
import { checkOpsAdminAuthorization } from "../src/server/ops-auth.js";

const counters = (partial: Partial<AttemptCounters> = {}): AttemptCounters => ({
  received: null, valid: null, filtered: null, new: null, duplicate: null, failed: null, ...partial
});
const signals = (partial: Partial<SignalTally> = {}): SignalTally => ({ ...emptySignalTally(), ...partial });

class MemoryStore implements RunTelemetryStore {
  calls: { op: string; input: unknown }[] = [];
  async insertRun(input: RunStartRecord) { this.calls.push({ op: "insertRun", input }); }
  async heartbeatRun(input: string) { this.calls.push({ op: "heartbeatRun", input }); }
  async insertAttempt(input: AttemptStartRecord) { this.calls.push({ op: "insertAttempt", input }); }
  async finishAttempt(input: AttemptFinishRecord) { this.calls.push({ op: "finishAttempt", input }); }
  async timeoutRunningAttempts(runId: string) { this.calls.push({ op: "timeoutRunningAttempts", input: runId }); return 0; }
  async finishRun(input: RunFinishRecord) { this.calls.push({ op: "finishRun", input }); }
  ops() { return this.calls.map((call) => call.op); }
}

test("OBS-003: listing attempts are classified from real signals, never as empty success", () => {
  const cases: [string, Parameters<typeof classifyAttempt>[0], string, string][] = [
    ["results", { stage: "listing", counters: counters({ received: 3, valid: 3 }), signals: signals() }, "success", "ok"],
    ["no results", { stage: "listing", counters: counters({ received: 0 }), signals: signals() }, "empty", "no_results"],
    ["circuit open", { stage: "listing", counters: counters({ received: 0 }), signals: signals({ circuit_open: 1 }) }, "skipped", "circuit_open"],
    ["deny", { stage: "listing", counters: counters({ received: 0 }), signals: signals({ blocked: 1 }) }, "blocked", "http_deny"],
    ["retries", { stage: "listing", counters: counters({ received: 0 }), signals: signals({ retries_exhausted: 1 }) }, "failed", "retries_exhausted"],
    ["swallowed", { stage: "listing", counters: counters({ received: 0 }), signals: signals({ swallowed_error: 2 }) }, "failed", "swallowed_error"],
    ["missing key", { stage: "listing", counters: counters({ received: 0 }), signals: signals({ misconfigured: 1 }) }, "misconfigured", "missing_credentials"],
    ["mixed", { stage: "listing", counters: counters({ received: 4, valid: 4 }), signals: signals({ blocked: 1, circuit_open: 1 }) }, "partial", "http_deny"],
    ["all invalid", { stage: "listing", counters: counters({ received: 5, valid: 0 }), signals: signals() }, "failed", "all_rejected_by_validation"],
    ["exception", { stage: "listing", counters: counters(), signals: signals(), failure: { error: new Error("boom") } }, "failed", "exception"],
    ["rejected undefined", { stage: "listing", counters: counters(), signals: signals(), failure: { error: undefined } }, "failed", "exception"],
    ["thrown deny", { stage: "listing", counters: counters(), signals: signals(), failure: { error: Object.assign(new Error("x"), { name: "FetchBlockedError" }) } }, "blocked", "http_deny"],
    ["thrown timeout", { stage: "listing", counters: counters(), signals: signals(), failure: { error: Object.assign(new Error("x"), { name: "AbortError" }) } }, "timeout", "timeout"],
    ["persist", { stage: "listing", counters: counters({ received: 2 }), signals: signals(), phase: "persist", failure: { error: new Error("db") } }, "failed", "persistence_error"]
  ];
  for (const [label, input, status, reason] of cases) {
    assert.deepEqual(classifyAttempt(input), { status, reason }, label);
  }
});

test("OBS-003: detail attempts distinguish complete, partial, unavailable and degraded", () => {
  assert.deepEqual(classifyAttempt({ stage: "detail", counters: counters({ received: 3, filtered: 0, valid: 3, failed: 0 }), signals: signals() }), { status: "success", reason: "ok" });
  assert.deepEqual(classifyAttempt({ stage: "detail", counters: counters({ received: 10, filtered: 2, valid: 5, failed: 0 }), signals: signals() }), { status: "partial", reason: "detail_unavailable" });
  assert.deepEqual(classifyAttempt({ stage: "detail", counters: counters({ received: 2, filtered: 0, valid: 0, failed: 0 }), signals: signals() }), { status: "empty", reason: "no_detail" });
  assert.deepEqual(classifyAttempt({ stage: "detail", counters: counters({ received: 2, filtered: 0, valid: 0, failed: 2 }), signals: signals() }), { status: "failed", reason: "exception" });
  assert.deepEqual(classifyAttempt({ stage: "detail", counters: counters({ received: 2, filtered: 0, valid: 0, failed: 0 }), signals: signals({ circuit_open: 2 }) }), { status: "skipped", reason: "circuit_open" });
});

test("OBS-004: reserved statuses are in the contract but never emitted by P2 classification", () => {
  for (const reserved of ["rate_limited", "quota_exhausted", "schema_changed"]) {
    assert.ok((ATTEMPT_STATUSES as readonly string[]).includes(reserved));
    assert.ok((RESERVED_ATTEMPT_STATUSES as readonly string[]).includes(reserved));
  }
  const kinds = Object.keys(emptySignalTally()) as (keyof SignalTally)[];
  for (let mask = 0; mask < 1 << kinds.length; mask++) {
    for (const received of [0, 3]) {
      for (const stage of ["listing", "detail"] as const) {
        const tally = signals();
        kinds.forEach((kind, index) => { if (mask & (1 << index)) tally[kind] = 1; });
        const { status } = classifyAttempt({ stage, counters: counters({ received, valid: received, filtered: 0, failed: 0 }), signals: tally });
        assert.ok(!(RESERVED_ATTEMPT_STATUSES as readonly string[]).includes(status), `${stage}/${received}/${mask} -> ${status}`);
      }
    }
  }
});

test("OBS-006: run status derivation", () => {
  assert.deepEqual(deriveRunStatus([]), { status: "skipped", reason: "no_due_sources" });
  assert.deepEqual(deriveRunStatus(["success", "empty", "skipped"]), { status: "success", reason: "ok" });
  assert.deepEqual(deriveRunStatus(["empty", "skipped"]), { status: "empty", reason: "no_results" });
  assert.deepEqual(deriveRunStatus(["skipped"]), { status: "skipped", reason: "all_sources_skipped" });
  assert.deepEqual(deriveRunStatus(["success", "blocked"]), { status: "partial", reason: "some_sources_degraded" });
  assert.deepEqual(deriveRunStatus(["partial"]), { status: "partial", reason: "some_sources_degraded" });
  assert.deepEqual(deriveRunStatus(["empty", "misconfigured"]), { status: "failed", reason: "no_source_succeeded" });
  assert.deepEqual(deriveRunStatus(["success", "timeout"], { deadlineExceeded: true }), { status: "timeout", reason: "deadline_exceeded" });
});

test("OBS-002/OBS-006: recorder persists attempts, keeps the original error and times out stragglers", async () => {
  const store = new MemoryStore();
  const recorder = await RunRecorder.start({ workflow: "scrape-tick", country: "CO", store, env: {} });
  const value = await recorder.trackAttempt({ source: "Torre", role: "QA", stage: "listing" }, async (attempt) => {
    reportSourceSignal("request");
    attempt.setCounters({ received: 2, valid: 2, filtered: 0, new: 1, duplicate: 1 });
    return "saved";
  });
  assert.equal(value, "saved");

  const original = new Error("adapter exploded");
  await assert.rejects(recorder.trackAttempt({ source: "LinkedIn", role: "QA", stage: "listing" }, async () => { throw original; }), (error) => error === original);

  let release!: () => void;
  const hung = recorder.trackAttempt({ source: "Magneto", role: "QA", stage: "listing" }, () => new Promise<void>((resolve) => { release = resolve; }));
  const summary = await recorder.finish();
  assert.equal(summary.status, "timeout");
  assert.equal(summary.reason, "deadline_exceeded");
  assert.deepEqual(summary.totals, { attempts: 3, received: 2, new: 1, duplicate: 1 });

  const finishCount = store.ops().filter((op) => op === "finishAttempt").length;
  release();
  await hung;
  await delay(10);
  assert.equal(store.ops().filter((op) => op === "finishAttempt").length, finishCount, "a late straggler must not write after finish");
  assert.deepEqual(store.ops(), ["insertRun", "insertAttempt", "finishAttempt", "insertAttempt", "finishAttempt", "insertAttempt", "timeoutRunningAttempts", "finishRun"]);
  const [okFinish, errorFinish] = store.calls.filter((call) => call.op === "finishAttempt").map((call) => call.input as AttemptFinishRecord);
  assert.equal(okFinish.status, "success");
  assert.equal(okFinish.requests, 1);
  assert.equal(errorFinish.status, "failed");
  assert.equal(errorFinish.errorClass, "Error");
  assert.ok(!JSON.stringify(store.calls).includes("adapter exploded"), "raw error messages are never persisted");
});

test("OBS-003: concurrent attempts never mix their signals", async () => {
  const recorder = RunRecorder.disabled();
  const ids: Record<string, string> = {};
  await Promise.all([
    recorder.trackAttempt({ source: "A", role: "r1", stage: "listing" }, async (attempt) => {
      ids.a = attempt.id;
      await delay(20);
      reportSourceSignal("blocked");
      attempt.setCounters({ received: 0 });
    }),
    recorder.trackAttempt({ source: "B", role: "r2", stage: "listing" }, async (attempt) => {
      ids.b = attempt.id;
      await delay(5);
      reportSourceSignal("circuit_open");
      attempt.setCounters({ received: 0 });
    })
  ]);
  assert.equal(recorder.statusOf(ids.a), "blocked");
  assert.equal(recorder.statusOf(ids.b), "skipped");
  assert.doesNotThrow(() => reportSourceSignal("blocked"), "signals outside an attempt are a no-op");
});

test("OBS-007: a failing store never breaks the work and disables itself", async () => {
  let failures = 0;
  const failing: RunTelemetryStore = {
    insertRun: async () => { failures++; throw Object.assign(new Error("relation does not exist"), { code: "42P01" }); },
    heartbeatRun: async () => { failures++; throw new Error("x"); },
    insertAttempt: async () => { failures++; throw new Error("x"); },
    finishAttempt: async () => { failures++; throw new Error("x"); },
    timeoutRunningAttempts: async () => { failures++; throw new Error("x"); },
    finishRun: async () => { failures++; throw new Error("x"); }
  };
  const recorder = await RunRecorder.start({ workflow: "scrape-tick", country: "VE", store: failing, env: {} });
  const saved: string[] = [];
  for (let i = 0; i < 5; i++) {
    await recorder.trackAttempt({ source: "Torre", role: "QA", stage: "listing" }, async (attempt) => {
      saved.push(`job-${i}`);
      attempt.setCounters({ received: 1, valid: 1 });
    });
  }
  const summary = await recorder.finish();
  assert.equal(saved.length, 5);
  assert.equal(summary.status, "success");
  assert.equal(summary.telemetryEnabled, false);
  assert.equal(failures, 1, "a failed run insert disables every later write");
});

test("OBS-007: a hanging store never blocks the work and finish is bounded", async () => {
  const never = () => new Promise<never>(() => {});
  const hanging: RunTelemetryStore = {
    insertRun: never, heartbeatRun: never, insertAttempt: never, finishAttempt: never,
    timeoutRunningAttempts: never, finishRun: never
  };
  const started = Date.now();
  const recorder = await RunRecorder.start({ workflow: "browser-tick", country: null, store: hanging, env: {}, drainTimeoutMs: 50 });
  await recorder.trackAttempt({ source: "Glassdoor-CO", role: null, stage: "listing" }, async (attempt) => attempt.setCounters({ received: 0 }));
  const summary = await recorder.finish();
  assert.equal(summary.status, "empty");
  assert.ok(Date.now() - started < 1000, "telemetry waits are bounded");
});

test("OBS-001/OBS-010: environment detection is sanitized and test runs are marked", () => {
  assert.deepEqual(detectRunEnvironment({
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "schedule", GITHUB_SHA: "a".repeat(40),
    GITHUB_REPOSITORY: "owner/repo", GITHUB_WORKFLOW: "Job Radar Scraper Tick", GITHUB_RUN_ID: "30170319327", GITHUB_RUN_ATTEMPT: "2"
  }), {
    trigger: "schedule", isTest: false, gitSha: "a".repeat(40), ghRepository: "owner/repo",
    ghWorkflow: "Job Radar Scraper Tick", ghRunId: "30170319327", ghRunAttempt: 2
  });
  assert.deepEqual(detectRunEnvironment({}), {
    trigger: "manual", isTest: false, gitSha: null, ghRepository: null, ghWorkflow: null, ghRunId: null, ghRunAttempt: null
  });
  const hostile = detectRunEnvironment({
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "x'; DROP", GITHUB_SHA: "not-a-sha", GITHUB_REPOSITORY: "../../etc",
    GITHUB_RUN_ID: "12abc", GITHUB_RUN_ATTEMPT: "-1"
  });
  assert.equal(hostile.trigger, "github_actions");
  assert.equal(hostile.gitSha, null);
  assert.equal(hostile.ghRepository, null);
  assert.equal(hostile.ghRunId, null);
  assert.equal(hostile.ghRunAttempt, null);
  const testRun = detectRunEnvironment({ JOB_RADAR_TEST_MODE: "integration", GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "schedule" });
  assert.equal(testRun.trigger, "test");
  assert.equal(testRun.isTest, true);
});

test("OBS-009: operator authorization is fail-closed and exact", () => {
  const token = "t".repeat(40);
  assert.equal(checkOpsAdminAuthorization(`Bearer ${token}`, undefined), "disabled");
  assert.equal(checkOpsAdminAuthorization(`Bearer short`, "short"), "disabled");
  assert.equal(checkOpsAdminAuthorization(undefined, token), "unauthorized");
  assert.equal(checkOpsAdminAuthorization(["Bearer", token], token), "unauthorized");
  assert.equal(checkOpsAdminAuthorization(`Basic ${token}`, token), "unauthorized");
  assert.equal(checkOpsAdminAuthorization(`Bearer ${token}x`, token), "unauthorized");
  assert.equal(checkOpsAdminAuthorization(`Bearer ${token}`, token), "authorized");
});

test("OBS-008: cursors round-trip and reject tampering", () => {
  const cursor = { startedAt: "2026-09-15T20:15:00.000Z", id: "0b7a2a8e-6f3c-4d1e-9a2b-3c4d5e6f7a8b" };
  assert.deepEqual(decodeRunCursor(encodeRunCursor(cursor)), cursor);
  for (const bad of ["", "%%%", Buffer.from("[1,2]").toString("base64url"), Buffer.from(JSON.stringify(["nope", cursor.id])).toString("base64url"),
    Buffer.from(JSON.stringify([cursor.startedAt, "1; DROP TABLE"])).toString("base64url"), "a".repeat(500)]) {
    assert.equal(decodeRunCursor(bad), null, bad);
  }
});
