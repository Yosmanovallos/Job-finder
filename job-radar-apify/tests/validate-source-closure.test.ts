import assert from "node:assert/strict";
import test from "node:test";
import { classifyTorreOpportunity, fetchTorreOpportunityStatus, torreIdFromUrl, type TorreStatusVerdict } from "../src/sources/torre-status.js";
import { verifyTorreClosures, type ClosureDeps } from "../src/queue/source-closure.js";
import { createFetchContext } from "../src/engine/fetch-context.js";

/**
 * Source-closure check (bug 2026-10-04: closed Torre postings stayed live).
 * Offline only: every network/DB edge is injected.
 */

test("torreIdFromUrl reads the stored and the shared URL shapes, nothing else", () => {
  assert.equal(torreIdFromUrl("https://torre.ai/jobs/kWR9GX7r"), "kWR9GX7r");
  assert.equal(torreIdFromUrl("https://torre.ai/post/JdmMGOKd-getlabs-business-strategy-analyst-1?t=1&r=x"), "JdmMGOKd");
  assert.equal(torreIdFromUrl("https://torre.co/jobs/abc123/"), "abc123");
  assert.equal(torreIdFromUrl("https://evil.example/torre.ai/jobs/abc"), null);
  assert.equal(torreIdFromUrl("https://www.linkedin.com/jobs/view/123"), null);
  assert.equal(torreIdFromUrl(null), null);
});

test("classification only closes on an explicit source status", () => {
  // Real shapes captured 2026-10-04 for the two reported postings.
  assert.deepEqual(classifyTorreOpportunity(200, { status: "closed", deadline: "2026-09-25T17:53:09Z" }), {
    kind: "closed",
    status: "closed",
    deadline: "2026-09-25T17:53:09.000Z"
  });
  assert.deepEqual(classifyTorreOpportunity(200, { status: "open", deadline: null }), { kind: "open", deadline: null });
  assert.equal(classifyTorreOpportunity(200, { status: "Paused" }).kind, "closed");
  assert.deepEqual(classifyTorreOpportunity(404, null), { kind: "not_found" });
  // No evidence → never closed.
  assert.equal(classifyTorreOpportunity(200, {}).kind, "unknown");
  assert.equal(classifyTorreOpportunity(200, { status: "" }).kind, "unknown");
  assert.equal(classifyTorreOpportunity(200, null).kind, "unknown");
  assert.equal(classifyTorreOpportunity(429, null).kind, "unknown");
  assert.equal(classifyTorreOpportunity(500, null).kind, "unknown");
});

test("fetchTorreOpportunityStatus maps transport failures to unknown, never closed", async () => {
  const failing = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  assert.deepEqual(await fetchTorreOpportunityStatus("x", { fetchImpl: failing }), { kind: "unknown", reason: "network" });

  const badJson = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await fetchTorreOpportunityStatus("x", { fetchImpl: badJson }), { kind: "unknown", reason: "invalid_json" });

  let requested = "";
  const closed = (async (url: string) => {
    requested = url;
    return new Response(JSON.stringify({ status: "closed" }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal((await fetchTorreOpportunityStatus("kWR9GX7r", { fetchImpl: closed })).kind, "closed");
  assert.equal(requested, "https://torre.ai/api/suite/opportunities/kWR9GX7r");
});

function fakeDeps(rows: { id: string; url: string }[], verdicts: Record<string, TorreStatusVerdict>) {
  const calls = { deleted: [] as string[], marked: [] as string[], checked: [] as string[] };
  const deps: ClosureDeps = {
    pick: async (_source, limit) => rows.slice(0, limit),
    markChecked: async (ids) => {
      calls.marked.push(...ids);
    },
    deleteClosed: async (ids) => {
      calls.deleted.push(...ids);
      return ids.length;
    },
    check: async (externalId) => {
      calls.checked.push(externalId);
      return verdicts[externalId] ?? { kind: "unknown", reason: "unmapped" };
    }
  };
  return { deps, calls };
}

test("closed and not-found rows are deleted, open/unknown rotate, no-id rows rotate unchecked", async () => {
  const { deps, calls } = fakeDeps(
    [
      { id: "j1", url: "https://torre.ai/jobs/kWR9GX7r" },
      { id: "j2", url: "https://torre.ai/jobs/OPEN1" },
      { id: "j3", url: "https://torre.ai/jobs/GONE1" },
      { id: "j4", url: "https://torre.ai/jobs/FLAKY1" },
      { id: "j5", url: "https://elsewhere.example/job/1" }
    ],
    {
      kWR9GX7r: { kind: "closed", status: "closed", deadline: null },
      OPEN1: { kind: "open", deadline: null },
      GONE1: { kind: "not_found" },
      FLAKY1: { kind: "unknown", reason: "timeout" }
    }
  );
  const report = await verifyTorreClosures(undefined, { deps });
  assert.deepEqual(calls.deleted.sort(), ["j1", "j3"]);
  assert.deepEqual(calls.marked.sort(), ["j2", "j4", "j5"]);
  assert.equal(calls.checked.length, 4);
  assert.equal(report.deleted, 2);
  assert.equal(report.unverifiable, 1);
  assert.equal(report.degraded, false);
});

test("a 404 storm is treated as a moved endpoint: 404s kept, explicit closures still applied", async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `j${i}`, url: `https://torre.ai/jobs/ID${i}` }));
  const verdicts: Record<string, TorreStatusVerdict> = {};
  rows.forEach((_, i) => {
    verdicts[`ID${i}`] = i < 2 ? { kind: "closed", status: "closed", deadline: null } : { kind: "not_found" };
  });
  const { deps, calls } = fakeDeps(rows, verdicts);
  const report = await verifyTorreClosures(undefined, { deps });
  assert.equal(report.degraded, true);
  assert.deepEqual(calls.deleted.sort(), ["j0", "j1"]);
  assert.equal(calls.marked.length, 10);
});

test("dry-run performs zero writes but reports what it would delete", async () => {
  const { deps, calls } = fakeDeps([{ id: "j1", url: "https://torre.ai/jobs/C1" }], {
    C1: { kind: "closed", status: "closed", deadline: null }
  });
  const report = await verifyTorreClosures(undefined, { deps, dryRun: true });
  assert.deepEqual(calls.deleted, []);
  assert.deepEqual(calls.marked, []);
  assert.deepEqual(report.closedJobIds, ["j1"]);
  assert.equal(report.deleted, 0);
});

test("an exhausted budget starts no request and deletes nothing", async () => {
  const { deps, calls } = fakeDeps([{ id: "j1", url: "https://torre.ai/jobs/C1" }], {
    C1: { kind: "closed", status: "closed", deadline: null }
  });
  const ctx = createFetchContext(0);
  const report = await verifyTorreClosures(ctx, { deps });
  ctx.dispose();
  assert.equal(report.stoppedEarly, true);
  assert.deepEqual(calls.checked, []);
  assert.deepEqual(calls.deleted, []);
});

test("missing migration column is a clean skip, any other DB error propagates", async () => {
  const missing: ClosureDeps = {
    pick: async () => {
      throw Object.assign(new Error("column does not exist"), { code: "42703" });
    },
    markChecked: async () => assert.fail("must not write"),
    deleteClosed: async () => assert.fail("must not write"),
    check: async () => assert.fail("must not fetch")
  };
  assert.equal((await verifyTorreClosures(undefined, { deps: missing })).skipped, "missing_column");

  const broken: ClosureDeps = { ...missing, pick: async () => Promise.reject(Object.assign(new Error("boom"), { code: "08006" })) };
  await assert.rejects(verifyTorreClosures(undefined, { deps: broken }), /boom/);
});
