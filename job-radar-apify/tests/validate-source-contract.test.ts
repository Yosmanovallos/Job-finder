import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFetchResult,
  emptyResult,
  failedResult,
  liftJobArray,
  partialResult,
  successResult,
  type SourceFetchResult
} from "../src/sources/fetch-result.js";
import {
  DEFAULT_SOURCE_POLICY,
  resolvePolicy,
  SOURCE_POLICIES
} from "../src/sources/source-policy.js";
import { circuitEffectOf, type CircuitEffect } from "../src/engine/circuit-policy.js";
import { FetchRateLimitedError, retryAfterMsFrom } from "../src/engine/rate-limit.js";
import type { Job } from "../src/sources/types.js";

/**
 * P4 unit checks (openspec/changes/p4-source-contract).
 * Pure functions only — the database-backed behavior lives in
 * tests/validate-source-contract.ts (integration).
 *
 * SRC-003 is the phase's headline requirement and its state machine is
 * tested here exhaustively: before P4, a null detail reached
 * `recordSuccess` and wiped the failure counter, which is why
 * `source_circuit_state` never contained a single `-detail` row in
 * production despite Computrabajo spending 102 detail pages for 0 results.
 */

function job(id: string): Job {
  return {
    jobId: id,
    title: `Ingeniero sintético P4 ${id}`,
    company: "Empresa Sintética P4",
    location: "Bogotá",
    url: `https://example.invalid/p4/${id}`,
    dateText: "hace 1 día",
    source: "Torre"
  };
}

// ---------------------------------------------------------------------------
// SRC-001 — a source says WHAT happened, not just how much it brought
// ---------------------------------------------------------------------------

test("SRC-001: every outcome respects the data/error invariant table", () => {
  // The table from design.md §2.1. Written as data, not prose, so a future
  // change to the union has to come here and state its intent.
  const cases: Array<{ result: SourceFetchResult<Job>; data: "empty" | "filled"; error: boolean }> = [
    { result: successResult([job("a")], { received: 1, valid: 1, requests: 1, bytes: null }), data: "filled", error: false },
    { result: partialResult([job("b")], { class: "DetailUnavailable" }, "detail_unavailable", { received: 3, valid: 1, requests: 3, bytes: null }), data: "filled", error: true },
    { result: emptyResult("no_results", { received: 0, valid: 0, requests: 1, bytes: null }), data: "empty", error: false },
    { result: failedResult("blocked", { class: "FetchBlockedError", statusCode: 403 }, "http_deny"), data: "empty", error: true },
    { result: failedResult("rate_limited", { class: "FetchRateLimitedError", statusCode: 429, retryAfterMs: 30_000 }, "retry_after"), data: "empty", error: true },
    { result: failedResult("misconfigured", { class: "MissingCredential" }, "missing_credentials"), data: "empty", error: true },
    { result: failedResult("schema_changed", { class: "ParserMismatch" }, "schema_changed"), data: "empty", error: true },
    { result: failedResult("timeout", { class: "AbortError" }, "deadline_exceeded"), data: "empty", error: true },
    { result: failedResult("failed", { class: "Error" }, "exception"), data: "empty", error: true }
  ];

  for (const { result, data, error } of cases) {
    assert.equal(Array.isArray(result.data), true, `${result.outcome}: data is always an array, never null`);
    if (data === "empty") assert.equal(result.data.length, 0, `${result.outcome} must carry no data`);
    else assert.ok(result.data.length > 0, `${result.outcome} must carry data`);
    assert.equal(result.error !== undefined, error, `${result.outcome}: error presence`);
    assert.ok(result.reason.length > 0, `${result.outcome}: a reason is always stated`);
  }
});

test("SRC-001: 'partial' carries data AND an error at the same time", () => {
  // The most common real detail outcome (LinkedIn 28, LinkedIn-VE 17,
  // Computrabajo 9 in 7 days). Collapsing it into `success` is exactly the
  // information loss this phase exists to stop.
  const result = partialResult(
    [job("c"), job("d")],
    { class: "DetailUnavailable" },
    "detail_unavailable",
    { received: 8, valid: 2, requests: 8, bytes: null }
  );
  assert.equal(result.outcome, "partial");
  assert.equal(result.data.length, 2);
  assert.ok(result.error, "partial without an error would be an undiagnosed success");
  assert.equal(result.counters.received, 8);
  assert.equal(result.counters.valid, 2);
});

test("SRC-001: a classified error never leaks the raw message or URL", () => {
  // Adversarial: the thrown message embeds a credential in a query string.
  // AGENTS.md — logs carry no tokens; source_attempts stores error_class only.
  const leaky = new Error("ECONNREFUSED https://api.example.invalid/v1?api_key=SUPERSECRET123&q=dev");
  const result = classifyFetchResult<Job>(leaky, { received: 0, valid: 0, requests: 1, bytes: null });

  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("SUPERSECRET123"), "the credential must never reach the result object");
  assert.ok(!serialized.includes("api.example.invalid"), "the URL must never reach the result object");
  assert.equal(result.error?.class, "Error", "only the error class survives");
});

test("SRC-001: bytes is null when the source does not report it — never invented", () => {
  const result = successResult([job("e")], { received: 1, valid: 1, requests: 1, bytes: null });
  assert.equal(result.counters.bytes, null, "an unknown byte count stays unknown (AGENTS.md #5)");
});

// ---------------------------------------------------------------------------
// SRC-002 — gradual adoption: no adapter breaks
// ---------------------------------------------------------------------------

test("SRC-002: liftJobArray classifies exactly as today — no invented richness", () => {
  // An unmigrated adapter cannot distinguish "nothing there" from "I was
  // blocked": the wrapper must not pretend otherwise, or migrating an
  // adapter in P5 would look like a no-op.
  const withJobs = liftJobArray([job("f"), job("g")]);
  assert.equal(withJobs.outcome, "success");
  assert.equal(withJobs.data.length, 2);
  assert.equal(withJobs.counters.received, 2);

  const empty = liftJobArray<Job>([]);
  assert.equal(empty.outcome, "empty", "an empty array stays 'empty', same as P2 inferred");
  assert.equal(empty.error, undefined);
});

// ---------------------------------------------------------------------------
// SRC-003 — THE HEADLINE: a missing detail is not a circuit success
// ---------------------------------------------------------------------------

test("SRC-003: an empty outcome is NEUTRAL for the circuit — it neither resets nor increments", () => {
  // The defect, in one assertion: before P4 this path reached recordSuccess
  // and reset the counter to 0.
  assert.equal(circuitEffectOf("empty"), "neutral");
});

test("SRC-003: only a real success resets, only a real failure increments", () => {
  const expected: Record<string, CircuitEffect> = {
    success: "reset",
    partial: "reset", // it DID get data through; the shortfall is not a transport failure
    empty: "neutral",
    timeout: "neutral", // running out of budget says nothing about the source's health
    blocked: "increment",
    rate_limited: "increment",
    quota_exhausted: "increment",
    misconfigured: "increment",
    schema_changed: "increment",
    failed: "increment"
  };
  for (const [outcome, effect] of Object.entries(expected)) {
    assert.equal(circuitEffectOf(outcome as never), effect, `circuit effect of '${outcome}'`);
  }
});

test("SRC-003: null details interleaved with real failures do not erase the failure history", () => {
  // The production scenario, replayed as a pure state machine: Computrabajo
  // spent 102 detail pages over 24 attempts and its circuit row never even
  // came into existence, because every null reset the counter.
  const threshold = DEFAULT_SOURCE_POLICY.failureThreshold;
  let failures = 0;
  const apply = (outcome: Parameters<typeof circuitEffectOf>[0]) => {
    const effect = circuitEffectOf(outcome);
    if (effect === "reset") failures = 0;
    else if (effect === "increment") failures += 1;
  };

  // fail, null, fail, null, fail  →  under the old behavior this ended at 1.
  apply("failed");
  apply("empty");
  apply("failed");
  apply("empty");
  apply("failed");

  assert.equal(failures, 3, "three real failures must count as three, whatever came between");
  assert.ok(failures >= threshold, "and that must be enough to open the circuit");

  // A genuine success is still what clears it.
  apply("success");
  assert.equal(failures, 0);
});

// ---------------------------------------------------------------------------
// SRC-004 — the detail circuit has a policy of its own
// ---------------------------------------------------------------------------

test("SRC-004: an undeclared source resolves to today's exact behavior", () => {
  // The compatibility guarantee that makes rollback trivial: policy can only
  // change something when someone writes an explicit entry.
  const policy = resolvePolicy("UnaFuenteQueNoExiste", "listing");
  assert.equal(policy.failureThreshold, 3, "today's FAILURE_THRESHOLD");
  assert.equal(policy.openForMs, 30 * 60 * 1000, "today's DEGRADED_TIMEOUT_MS");
  assert.equal(policy.transport, "direct", "direct transport is the default");
  assert.equal(policy.maxRequestsPerAttempt, null);
});

test("SRC-004: policy is keyed by (source, stage), not by source alone", () => {
  const listing = resolvePolicy("Computrabajo", "listing");
  const detail = resolvePolicy("Computrabajo", "detail");
  assert.equal(listing.stage, "listing");
  assert.equal(detail.stage, "detail");
  // Both resolve; the point is that they are addressable separately, so a
  // detail policy can diverge without touching the healthy listing.
  assert.equal(listing.source, "Computrabajo");
  assert.equal(detail.source, "Computrabajo");
});

test("SRC-004: every declared policy is internally coherent", () => {
  for (const policy of SOURCE_POLICIES) {
    assert.ok(policy.failureThreshold >= 1, `${policy.source}/${policy.stage}: threshold >= 1`);
    assert.ok(policy.openForMs > 0, `${policy.source}/${policy.stage}: a circuit that opens for 0ms never opens`);
    assert.ok(policy.maxRetryAfterMs > 0, `${policy.source}/${policy.stage}: Retry-After cap must be positive`);
    assert.ok(
      policy.maxRequestsPerAttempt === null || policy.maxRequestsPerAttempt > 0,
      `${policy.source}/${policy.stage}: a 0-request ceiling would disable the source silently`
    );
  }
});

// ---------------------------------------------------------------------------
// SRC-005 — Retry-After (unit-only by design: 0 rate_limited in 7 days)
// ---------------------------------------------------------------------------

test("SRC-005: Retry-After is read from seconds and from an HTTP date", () => {
  assert.equal(retryAfterMsFrom("30"), 30_000);
  assert.equal(retryAfterMsFrom("0"), 0);
  const twoMinutes = new Date(Date.now() + 120_000).toUTCString();
  const parsed = retryAfterMsFrom(twoMinutes);
  assert.ok(parsed !== null && parsed > 100_000 && parsed <= 120_000, `HTTP-date form parsed to ${parsed}`);
  assert.equal(retryAfterMsFrom(undefined), null, "absent header → fall back to the existing backoff");
  assert.equal(retryAfterMsFrom("mañana por la tarde"), null, "unparseable → fall back, never guess");
  assert.equal(retryAfterMsFrom("-5"), null, "a negative wait is not a wait");
});

test("SRC-005: a rate-limit error carries its own wait and classifies as rate_limited", () => {
  const err = new FetchRateLimitedError("Torre", 429, 30_000);
  assert.equal(err.statusCode, 429);
  assert.equal(err.retryAfterMs, 30_000);
  const result = classifyFetchResult<Job>(err, { received: 0, valid: 0, requests: 1, bytes: null });
  assert.equal(result.outcome, "rate_limited", "429 is not a generic failure");
  assert.equal(result.error?.retryAfterMs, 30_000);
});

test("SRC-005: an absurd Retry-After is capped by policy before it is honored", () => {
  // A source can legitimately answer "come back in an hour". The tick cannot
  // wait an hour, and sleeping past the deadline is the P3 failure mode.
  const policy = resolvePolicy("Torre", "listing");
  const requested = 60 * 60 * 1000;
  const honored = Math.min(requested, policy.maxRetryAfterMs);
  assert.ok(honored < requested, "an hour is never honored verbatim");
  assert.equal(honored, policy.maxRetryAfterMs);
});

// ---------------------------------------------------------------------------
// SRC-006 / SRC-007 — declared transport and centralized limits
// ---------------------------------------------------------------------------

test("SRC-006: transport is direct unless a policy declares otherwise", () => {
  assert.equal(DEFAULT_SOURCE_POLICY.transport, "direct");
  for (const policy of SOURCE_POLICIES) {
    if (policy.transport !== "proxy") continue;
    // A source that opts into proxy must be one of the browser-route ones;
    // enabling the proxy must not silently change anybody else.
    assert.match(policy.source, /Glassdoor|Indeed/, `${policy.source} declares proxy unexpectedly`);
  }
});

test("SRC-007: the detail page ceiling stays declared, never unbounded", () => {
  // AGENTS.md #12 — every loop has a budget. The existing cap is 8.
  const detail = resolvePolicy("Computrabajo", "detail");
  assert.ok(
    detail.maxRequestsPerAttempt === null || detail.maxRequestsPerAttempt <= 8,
    "the detail ceiling must not silently grow past today's 8"
  );
});

// ---------------------------------------------------------------------------
// SRC-008 — "everything rejected by validation" is its own outcome
// ---------------------------------------------------------------------------

test("SRC-008: received > 0 with valid === 0 is not 'empty'", () => {
  // Jooble's real shape: 14 received, 0 valid, because it is the only
  // stamped source missing from KNOWN_SOURCES. P4 classifies it; P5 fixes it.
  const result = classifyFetchResult<Job>(null, { received: 14, valid: 0, requests: 3, bytes: null });
  assert.notEqual(result.outcome, "empty", "14 jobs arrived — this is not 'nothing was there'");
  assert.equal(result.reason, "all_rejected_by_validation");
  assert.equal(result.counters.received, 14);
  assert.equal(result.counters.valid, 0);
});

test("SRC-008: received > 0 with valid > 0 is a success that keeps the shortfall visible", () => {
  const result = classifyFetchResult<Job>(null, { received: 10, valid: 7, requests: 2, bytes: null }, [job("h")]);
  assert.equal(result.outcome, "success");
  assert.equal(result.counters.received, 10);
  assert.equal(result.counters.valid, 7);
});
