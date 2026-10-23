import assert from "node:assert/strict";
import test from "node:test";
import { clipVarchar } from "../src/lib/varchar.js";

test("clipVarchar: short values, null and undefined pass through", () => {
  assert.equal(clipVarchar("Bogotá"), "Bogotá");
  assert.equal(clipVarchar("x".repeat(255)), "x".repeat(255));
  assert.equal(clipVarchar(null), null);
  assert.equal(clipVarchar(undefined), undefined);
});

test("clipVarchar: an over-long city list fits VARCHAR(255) with an ellipsis", () => {
  const cities = Array.from({ length: 60 }, (_, i) => `Ciudad ${i}`).join(", ");
  const clipped = clipVarchar(cities);
  assert.equal(Array.from(clipped).length, 255);
  assert.ok(clipped.endsWith("…"));
  assert.ok(cities.startsWith(clipped.slice(0, -1)));
});

test("clipVarchar: cuts on code points, never inside an emoji", () => {
  const clipped = clipVarchar("😀".repeat(300), 10);
  assert.equal(clipped, "😀".repeat(9) + "…");
});
