import { test } from "node:test";
import assert from "node:assert/strict";
import { formatFaultClasses } from "../src/queue/detail-enrichment.js";

test("fault classes print most frequent first, ties alphabetically", () => {
  assert.equal(formatFaultClasses({ timeout: 1, rate_limited: 3, HTTP_403: 1 }), "rate_limited×3, HTTP_403×1, timeout×1");
});

test("no faults print nothing", () => {
  assert.equal(formatFaultClasses({}), "");
});
