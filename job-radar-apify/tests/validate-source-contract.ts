import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { Pool } from "pg";

/**
 * P4 integration checks (openspec/changes/p4-source-contract).
 * Runs against the disposable PostgreSQL of the isolated runner — never
 * production. Covers the requirements that need a real database:
 * SRC-003 (a missing detail must not reset the circuit), SRC-004 (listing and
 * detail circuits are independent) and SRC-002 (a migrated adapter coexists
 * with unmigrated ones).
 *
 * SRC-003 is the phase's headline requirement, and it is exactly the kind of
 * defect a unit test alone would have missed: the bug lived in the
 * interaction between `recordSuccess` (an UPDATE that silently affects zero
 * rows) and `recordFailure` (an INSERT). Only real SQL shows that.
 */

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });

// Every adapter imports src/index.ts, which exits at import time without
// Notion settings. Synthetic values never reach the network: the isolated
// runner blocks every TCP connection except the disposable database.
process.env.NOTION_TOKEN = "p4-synthetic-notion-token";
process.env.NOTION_DATABASE_ID = "p4-synthetic-notion-database";

const { executeWithResilienceResult, executeWithResilience } = await import(
  "../src/engine/resilient-fetch.js"
);
const { successResult, emptyResult, failedResult, liftJobArray } = await import(
  "../src/sources/fetch-result.js"
);
const { resolvePolicy, circuitKeyFor } = await import("../src/sources/source-policy.js");
const { pool: appPool } = await import("../src/db/client.js");

async function circuitRow(sourceName: string): Promise<{ failures: number; open_until: Date | null } | null> {
  const result = await pool.query(
    `SELECT failures, open_until FROM source_circuit_state WHERE source_name = $1`,
    [sourceName]
  );
  return result.rows[0] ?? null;
}

async function resetCircuit(sourceName: string): Promise<void> {
  await pool.query(`DELETE FROM source_circuit_state WHERE source_name = $1`, [sourceName]);
}

let failures = 0;
function check(label: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✔ ${label}`))
    .catch((error) => {
      failures += 1;
      console.error(`✖ ${label}\n   ${error instanceof Error ? error.message : error}`);
    });
}

// ---------------------------------------------------------------------------
// SRC-003 — the headline: a null detail must not wipe the failure history
// ---------------------------------------------------------------------------

await check(
  "SRC-003: the circuit row does NOT come into existence from empty detail results",
  async () => {
    const key = circuitKeyFor("P4SyntheticEmpty", "detail");
    await resetCircuit(key);

    // Ten detail fetches that find nothing — the Computrabajo shape.
    for (let i = 0; i < 10; i++) {
      const result = await executeWithResilienceResult(
        key,
        "detail",
        async () => emptyResult("no_detail", { received: 1, valid: 0, requests: 1, bytes: null }),
        3
      );
      assert.equal(result.outcome, "empty", "a detail that yields nothing is 'empty'");
    }

    // Neutral means neutral: no row is created by them alone.
    assert.equal(await circuitRow(key), null, "empty outcomes must not fabricate circuit state");
    await resetCircuit(key);
  }
);

await check(
  "SRC-003: empty detail results interleaved with real failures do not erase them",
  async () => {
    // This is the regression in its exact production form. Before P4 the
    // empty results called recordSuccess and reset `failures` to 0, so the
    // three real failures never accumulated and the circuit never opened.
    const key = circuitKeyFor("P4SyntheticMixed", "detail");
    await resetCircuit(key);

    const sequence = ["fail", "empty", "fail", "empty", "fail"] as const;
    for (const step of sequence) {
      await executeWithResilienceResult(
        key,
        "detail",
        async () =>
          step === "empty"
            ? emptyResult("no_detail", { received: 1, valid: 0, requests: 1, bytes: null })
            : failedResult("failed", { class: "SyntheticDetailFault" }, "exception"),
        1 // no retries: one outcome per call, so the arithmetic is unambiguous
      );
    }

    const row = await circuitRow(key);
    assert.ok(row, "three real failures must have created the row");
    assert.equal(row.failures, 3, `three real failures must count as three, got ${row.failures}`);
    assert.ok(row.open_until !== null, "reaching the threshold must open the circuit");
    await resetCircuit(key);
  }
);

await check("SRC-003: a real success still clears accumulated failures", async () => {
  const key = circuitKeyFor("P4SyntheticRecover", "detail");
  await resetCircuit(key);

  await executeWithResilienceResult(
    key,
    "detail",
    async () => failedResult("failed", { class: "SyntheticDetailFault" }, "exception"),
    1
  );
  assert.equal((await circuitRow(key))?.failures, 1);

  await executeWithResilienceResult(
    key,
    "detail",
    async () => successResult([{ description: "detalle sintético" }], { received: 1, valid: 1, requests: 1, bytes: null }),
    1
  );
  assert.equal((await circuitRow(key))?.failures, 0, "a genuine success clears the counter");
  await resetCircuit(key);
});

// ---------------------------------------------------------------------------
// SRC-004 — listing and detail circuits are independent
// ---------------------------------------------------------------------------

await check("SRC-004: opening the detail circuit leaves the listing circuit untouched", async () => {
  const source = "P4SyntheticIndependent";
  const listingKey = circuitKeyFor(source, "listing");
  const detailKey = circuitKeyFor(source, "detail");
  await resetCircuit(listingKey);
  await resetCircuit(detailKey);

  assert.notEqual(listingKey, detailKey, "the two stages must not share a row");

  const threshold = resolvePolicy(source, "detail").failureThreshold;
  for (let i = 0; i < threshold; i++) {
    await executeWithResilienceResult(
      detailKey,
      "detail",
      async () => failedResult("failed", { class: "SyntheticDetailFault" }, "exception"),
      1
    );
  }

  const detail = await circuitRow(detailKey);
  assert.ok(detail && detail.open_until !== null, "the detail circuit must be open");
  assert.equal(await circuitRow(listingKey), null, "the listing circuit must be untouched");

  // And the healthy listing still runs while detail is degraded.
  const listing = await executeWithResilienceResult(
    listingKey,
    "listing",
    async () => liftJobArray([{ jobId: "p4-listing-1" }]),
    1
  );
  assert.equal(listing.outcome, "success", "a healthy listing must not be blocked by its detail circuit");

  await resetCircuit(listingKey);
  await resetCircuit(detailKey);
});

await check("SRC-004: an open circuit reports 'circuit_open', never 'empty'", async () => {
  const key = circuitKeyFor("P4SyntheticOpen", "listing");
  await resetCircuit(key);
  const threshold = resolvePolicy("P4SyntheticOpen", "listing").failureThreshold;
  for (let i = 0; i < threshold; i++) {
    await executeWithResilienceResult(
      key,
      "listing",
      async () => failedResult("failed", { class: "SyntheticFault" }, "exception"),
      1
    );
  }

  const skipped = await executeWithResilienceResult(
    key,
    "listing",
    async () => liftJobArray([{ jobId: "never-reached" }]),
    1
  );
  assert.notEqual(skipped.outcome, "empty", "a skipped source is not an empty one");
  assert.equal(skipped.reason, "circuit_open");
  await resetCircuit(key);
});

// ---------------------------------------------------------------------------
// SRC-002 — the compatibility shim keeps unmigrated callers working
// ---------------------------------------------------------------------------

await check("SRC-002: executeWithResilience keeps its Job[] signature", async () => {
  const key = "P4SyntheticShim";
  await resetCircuit(key);
  const jobs = await executeWithResilience(key, async () => [{ jobId: "a" }, { jobId: "b" }], 1);
  assert.ok(Array.isArray(jobs), "the shim must still return a bare array");
  assert.equal(jobs.length, 2);

  // `recordSuccess` is an UPDATE, so a success on a source that has never
  // failed creates no row at all. That asymmetry with `recordFailure`
  // (an INSERT) is precisely what made the production diagnosis possible:
  // the ABSENCE of a `-detail` row proved recordFailure had never run there.
  assert.equal(await circuitRow(key), null, "a clean success creates no circuit row");

  // And when a row does exist, a success clears it.
  await executeWithResilienceResult(
    key,
    "listing",
    async () => failedResult("failed", { class: "SyntheticFault" }, "exception"),
    1
  );
  assert.equal((await circuitRow(key))?.failures, 1);
  await executeWithResilience(key, async () => [{ jobId: "c" }], 1);
  assert.equal((await circuitRow(key))?.failures, 0, "a real success resets as before");
  await resetCircuit(key);
});

await check("SRC-002: an empty array through the shim no longer resets the circuit", async () => {
  // The one behavior that necessarily differs, and the reason the phase
  // exists. Documented in resilient-fetch.ts rather than left as a surprise.
  const key = "P4SyntheticShimEmpty";
  await resetCircuit(key);

  await executeWithResilienceResult(
    key,
    "listing",
    async () => failedResult("failed", { class: "SyntheticFault" }, "exception"),
    1
  );
  assert.equal((await circuitRow(key))?.failures, 1);

  const jobs = await executeWithResilience(key, async () => [], 1);
  assert.deepEqual(jobs, [], "the shim still hands back an empty array");
  assert.equal(
    (await circuitRow(key))?.failures,
    1,
    "an empty array is neutral: it must neither clear nor increment the failure"
  );
  await resetCircuit(key);
});

await pool.end();
await appPool.end();

if (failures > 0) {
  console.error(`\n[P4] ${failures} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\n[P4] Todas las comprobaciones de integración pasaron.");
