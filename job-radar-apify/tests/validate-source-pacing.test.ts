import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PACED_FALLBACK_MS, decidePacing, pacedOutForDrain, pacedSourcesFor } from "../src/queue/source-pacing.js";
import { SOURCE_CADENCE_MS, SOURCE_CADENCE_MS_VE } from "../src/queue/source-cadence.js";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const HOUR = 60 * 60 * 1000;

test("paced sources are real per-role sources of each market", () => {
  for (const name of pacedSourcesFor("CO")) assert.ok(name in SOURCE_CADENCE_MS, name);
  for (const name of pacedSourcesFor("VE")) assert.ok(name in SOURCE_CADENCE_MS_VE, name);
  assert.deepEqual(pacedSourcesFor("XX"), []);
});

test("schedule ticks keep today's behavior: always allowed, whatever the history", () => {
  for (const last of [undefined, null, NOW - HOUR, NOW]) {
    assert.equal(decidePacing({ country: "CO", trigger: "schedule", lastParticipationMs: last, nowMs: NOW }).allowed, true);
  }
});

test("dispatch ticks hold paced sources until the worst observed schedule gap", () => {
  const held = decidePacing({ country: "CO", trigger: "workflow_dispatch", lastParticipationMs: NOW - 2 * HOUR, nowMs: NOW });
  assert.deepEqual({ allowed: held.allowed, reason: held.reason }, { allowed: false, reason: "held_for_schedule" });
  const fallback = decidePacing({ country: "CO", trigger: "workflow_dispatch", lastParticipationMs: NOW - PACED_FALLBACK_MS, nowMs: NOW });
  assert.deepEqual({ allowed: fallback.allowed, reason: fallback.reason }, { allowed: true, reason: "fallback_gap" });
  assert.equal(PACED_FALLBACK_MS >= 7 * HOUR, true, "never more often than the worst measured gap (7.17 h)");
});

test("an unreadable history fails closed for non-schedule ticks", () => {
  const decision = decidePacing({ country: "VE", trigger: "workflow_dispatch", lastParticipationMs: undefined, nowMs: NOW });
  assert.equal(decision.allowed, false);
  assert.deepEqual([...decision.sources], ["LinkedIn-VE", "Computrabajo-VE"]);
  assert.equal(decidePacing({ country: "CO", trigger: "manual", lastParticipationMs: null, nowMs: NOW }).reason, "never_ran");
});

test("the drain step follows the tick's decision, or the same rule from the trigger", () => {
  assert.deepEqual(pacedOutForDrain("CO", "1", "workflow_dispatch"), []);
  assert.deepEqual([...pacedOutForDrain("CO", "0", "schedule")], ["LinkedIn", "Computrabajo"]);
  assert.deepEqual(pacedOutForDrain("CO", undefined, "schedule"), []);
  assert.deepEqual(pacedOutForDrain("CO", undefined, "manual"), []);
  assert.deepEqual([...pacedOutForDrain("CO", undefined, "workflow_dispatch")], ["LinkedIn", "Computrabajo"]);
});

// Más corridas no deben significar más presión: the workflow guards that make
// extra dispatches safe must stay in place.
test("scrape workflows keep queueing (never parallel ticks) and a bounded timeout", () => {
  for (const [file, group] of [
    ["../.github/workflows/scrape-jobs.yml", "scrape-jobs-tick"],
    ["../.github/workflows/scrape-jobs-ve.yml", "scrape-jobs-ve-tick"]
  ]) {
    const yaml = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(yaml, new RegExp(`group: ${group}\\s+cancel-in-progress: false`), file);
    assert.match(yaml, /workflow_dispatch:/, file);
    const timeout = Number(/timeout-minutes: (\d+)/.exec(yaml)?.[1]);
    assert.ok(timeout > 0 && timeout <= 36, `${file}: ${timeout}`);
  }
});
