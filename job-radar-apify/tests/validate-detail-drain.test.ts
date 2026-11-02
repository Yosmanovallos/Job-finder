import assert from "node:assert/strict";
import test from "node:test";
import { DETAIL_ADAPTER_NAMES } from "../src/sources/detail-capability.js";
import { detailCapFor, drainOrder, drainSliceMs, formatDrainLine } from "../src/queue/detail-enrichment.js";
import { circuitKeyFor, resolvePolicy, resolvePolicyForKey } from "../src/sources/source-policy.js";
import { PACED_SOURCES } from "../src/queue/source-pacing.js";
import type { SourceAdapter } from "../src/sources/types.js";

function adapter(name: string, withDetail = true): SourceAdapter {
  return {
    name,
    fetch: async () => [],
    ...(withDetail ? { fetchDetail: async () => null } : {})
  } as SourceAdapter;
}

test("healthy robots-allowed sources drain before LinkedIn and Computrabajo", () => {
  const co = DETAIL_ADAPTER_NAMES.filter((name) => !name.endsWith("-VE"));
  assert.deepEqual(co, ["Magneto", "Elempleo", "LinkedIn", "Computrabajo"]);
});

test("drainOrder ignores input order and adapters without fetchDetail", () => {
  const given = [adapter("Computrabajo"), adapter("Torre", false), adapter("LinkedIn"), adapter("Elempleo"), adapter("Magneto")];
  assert.deepEqual(
    drainOrder(given).map((a) => a.name),
    ["Magneto", "Elempleo", "LinkedIn", "Computrabajo"]
  );
  assert.deepEqual(drainOrder([adapter("LinkedIn-VE"), adapter("Computrabajo-VE")]).map((a) => a.name), ["LinkedIn-VE", "Computrabajo-VE"]);
});

test("caps: larger and bounded for Magneto/Elempleo, unchanged for LinkedIn/Computrabajo", () => {
  assert.equal(detailCapFor("Magneto"), 30);
  assert.equal(detailCapFor("Elempleo"), 20);
  assert.equal(detailCapFor("LinkedIn"), 8);
  assert.equal(detailCapFor("Computrabajo"), 8);
  assert.equal(detailCapFor("LinkedIn-VE"), 8);
});

test("drain log line: silent when nothing was claimed, fault classes when present", () => {
  const base = { claimed: 0, complete: 0, rejected: 0, retry: 0, noDetail: 0, failed: 0, stoppedEarly: false, faultClasses: {} };
  assert.equal(formatDrainLine("Magneto", base), null);
  const line = formatDrainLine("Magneto", { ...base, claimed: 3, complete: 2, retry: 1, stoppedEarly: true, faultClasses: { FetchBlockedError: 1 } });
  assert.ok(line?.includes("Detalle Magneto: 3 reclamadas → 2 completas"));
  assert.ok(line?.includes("(fuente detenida por política/plazo)"));
  assert.ok(line?.includes("Fallos: FetchBlockedError×1."));
});

// --- GOOGLE-JOBS F3 ---------------------------------------------------------

test("F3: Magneto and Elempleo claim newest first; the 429 sources keep the pre-F3 order", () => {
  assert.equal(resolvePolicy("Magneto", "detail").detailClaimOrder, "newest_first");
  assert.equal(resolvePolicy("Elempleo", "detail").detailClaimOrder, "newest_first");
  for (const name of ["LinkedIn", "Computrabajo", "LinkedIn-VE", "Computrabajo-VE"]) {
    assert.equal(resolvePolicy(name, "detail").detailClaimOrder, "due_first", name);
  }
});

test("F3: no in-call 429 retries on the paced sources' detail; listing and other sources unchanged", () => {
  for (const name of [...PACED_SOURCES.CO, ...PACED_SOURCES.VE]) {
    assert.equal(resolvePolicy(name, "detail").retryRateLimited, false, `${name} detail`);
    assert.equal(resolvePolicy(name, "listing").retryRateLimited, true, `${name} listing`);
  }
  assert.equal(resolvePolicy("Magneto", "detail").retryRateLimited, true);
  assert.equal(resolvePolicy("Elempleo", "detail").retryRateLimited, true);
});

test("F3: the resilient engine resolves a circuit key to its declared detail policy", () => {
  assert.equal(resolvePolicyForKey(circuitKeyFor("LinkedIn", "detail"), "detail").retryRateLimited, false);
  assert.equal(resolvePolicyForKey(circuitKeyFor("Computrabajo-VE", "detail"), "detail").retryRateLimited, false);
  assert.equal(resolvePolicyForKey("LinkedIn", "listing").retryRateLimited, true);
  // Thresholds the engine does read are still the pre-F3 defaults.
  const before = resolvePolicy("Computrabajo-detail", "detail");
  const after = resolvePolicyForKey("Computrabajo-detail", "detail");
  assert.equal(after.failureThreshold, before.failureThreshold);
  assert.equal(after.openForMs, before.openForMs);
  assert.equal(after.maxRetryAfterMs, before.maxRetryAfterMs);
});

test("F3: caps are unchanged, so requests per drain cannot grow", () => {
  assert.deepEqual(["Magneto", "Elempleo", "LinkedIn", "Computrabajo", "LinkedIn-VE", "Computrabajo-VE"].map(detailCapFor), [30, 20, 8, 8, 8, 8]);
});

test("F3: drain time is split by cap, not 1/n", () => {
  // CO tick with the paced sources in: 420 s over caps 30/20/8/8.
  assert.equal(drainSliceMs(420_000, [30, 20, 8, 8]), Math.floor((420_000 * 30) / 66));
  assert.ok(drainSliceMs(420_000, [30, 20, 8, 8]) > 420_000 / 3, "Magneto gets more than the old third");
  // Paced sources held out (most dispatch ticks): Magneto and Elempleo only.
  assert.equal(drainSliceMs(420_000, [30, 20]), 252_000);
  // The last source always gets everything left (surplus flows forward).
  assert.equal(drainSliceMs(90_000, [8]), 90_000);
  assert.equal(drainSliceMs(90_000, []), 0);
  assert.equal(drainSliceMs(90_000, [0, 0]), 0);
});
