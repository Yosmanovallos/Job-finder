import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { StaleWhileRevalidateCache } from "../src/lib/stale-while-revalidate-cache.js";

interface Value {
  version: number;
  items: string[];
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("returns isolated fresh copies and coalesces a cold load", async () => {
  let now = 0;
  let loads = 0;
  const firstLoad = deferred<Value>();
  const cache = new StaleWhileRevalidateCache<string, Value>({
    freshForMs: 10,
    staleForMs: 20,
    maxEntries: 2,
    now: () => now,
    clone: (value) => ({ ...value, items: [...value.items] })
  });

  const one = cache.get("jobs", async () => {
    loads++;
    return firstLoad.promise;
  });
  const two = cache.get("jobs", async () => {
    loads++;
    return { version: 99, items: [] };
  });
  firstLoad.resolve({ version: 1, items: ["original"] });

  const [first, second] = await Promise.all([one, two]);
  assert.equal(loads, 1);
  assert.deepEqual(first, second);
  first.items.push("caller mutation");

  const fresh = await cache.get("jobs", async () => {
    loads++;
    return { version: 2, items: [] };
  });
  assert.deepEqual(fresh, { version: 1, items: ["original"] });
  assert.equal(loads, 1);
  now++;
});

test("serves stale immediately while one background refresh runs", async () => {
  let now = 0;
  let loads = 0;
  const refresh = deferred<Value>();
  const errors: unknown[] = [];
  const cache = new StaleWhileRevalidateCache<string, Value>({
    freshForMs: 10,
    staleForMs: 20,
    maxEntries: 2,
    now: () => now,
    clone: (value) => ({ ...value, items: [...value.items] }),
    onBackgroundRefreshError: (error) => errors.push(error)
  });

  await cache.get("jobs", async () => {
    loads++;
    return { version: 1, items: ["old"] };
  });
  now = 11;

  const staleOne = await cache.get("jobs", async () => {
    loads++;
    return refresh.promise;
  });
  const staleTwo = await cache.get("jobs", async () => {
    loads++;
    return { version: 99, items: [] };
  });
  assert.equal(loads, 2);
  assert.equal(staleOne.version, 1);
  assert.equal(staleTwo.version, 1);

  refresh.resolve({ version: 2, items: ["new"] });
  await nextTurn();
  const updated = await cache.get("jobs", async () => {
    loads++;
    return { version: 3, items: [] };
  });
  assert.equal(updated.version, 2);
  assert.equal(loads, 2);
  assert.deepEqual(errors, []);
});

test("blocks again after the stale window and propagates loader failures", async () => {
  let now = 0;
  const cache = new StaleWhileRevalidateCache<string, Value>({
    freshForMs: 10,
    staleForMs: 20,
    maxEntries: 1,
    now: () => now,
    clone: (value) => ({ ...value, items: [...value.items] })
  });

  await cache.get("jobs", async () => ({ version: 1, items: [] }));
  now = 31;
  await assert.rejects(
    cache.get("jobs", async () => {
      throw new Error("database unavailable");
    }),
    /database unavailable/
  );
});
