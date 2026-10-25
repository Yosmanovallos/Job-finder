import assert from "node:assert/strict";
import test from "node:test";
import { DETAIL_ADAPTER_NAMES } from "../src/sources/detail-capability.js";
import { detailCapFor, drainOrder, formatDrainLine } from "../src/queue/detail-enrichment.js";
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
