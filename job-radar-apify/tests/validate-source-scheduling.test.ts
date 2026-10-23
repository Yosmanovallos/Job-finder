import assert from "node:assert/strict";
import test from "node:test";
import { countsAsGlobalRun, GLOBAL_SOURCE_CADENCE_MS, orderDueGlobalSources } from "../src/queue/source-cadence.js";

/**
 * Catalog-step scheduling (2026-10-22): the starved source goes first, and
 * the retired catalog sources stay unscheduled.
 */

test("due catalog sources: longest without a successful run first, never-run first of all", () => {
  const lastRun = new Map([
    ["RemoteOK", 5_000],
    ["GetOnBoard", 4_000],
    ["WeRemoto", 3_000],
    ["Magneto", 1_000]
  ]);
  assert.deepEqual(
    orderDueGlobalSources(["RemoteOK", "GetOnBoard", "WeRemoto", "WorkanaV2", "Magneto"], lastRun),
    ["WorkanaV2", "Magneto", "WeRemoto", "GetOnBoard", "RemoteOK"]
  );
});

test("due catalog sources: ties keep map order", () => {
  assert.deepEqual(orderDueGlobalSources(["A", "B", "C"], new Map()), ["A", "B", "C"]);
  assert.deepEqual(orderDueGlobalSources(["A", "B"], new Map([["A", 7], ["B", 7]])), ["A", "B"]);
  assert.deepEqual(orderDueGlobalSources([], new Map()), []);
});

test("a source that timed out (not marked as run) leads the next tick", () => {
  // Magneto last ran OK long ago; everyone else ran on the previous tick.
  const lastRun = new Map([["RemoteOK", 100], ["WorkanaV2", 100], ["Magneto", 10]]);
  assert.equal(orderDueGlobalSources(["RemoteOK", "WorkanaV2", "Magneto"], lastRun)[0], "Magneto");
});

test("Remotive (terms) and Jooble (US-only key) are not scheduled", () => {
  assert.equal("Remotive" in GLOBAL_SOURCE_CADENCE_MS, false);
  assert.equal("Jooble" in GLOBAL_SOURCE_CADENCE_MS, false);
  assert.ok("Magneto" in GLOBAL_SOURCE_CADENCE_MS);
});

test("a catalog source cut off by the budget does not count as run; any real answer does", () => {
  assert.equal(countsAsGlobalRun("timeout"), false);
  for (const status of ["success", "partial", "empty", "failed", "misconfigured", undefined]) {
    assert.equal(countsAsGlobalRun(status), true, String(status));
  }
});
