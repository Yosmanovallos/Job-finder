import assert from "node:assert/strict";
import test from "node:test";
import { jobDateLabel } from "../src/lib/job-date-label.js";
import { parseDateText } from "../src/lib/source-date.js";

/**
 * Source age is captured once, but the label must keep aging after capture.
 */
const NOW = new Date("2026-10-21T12:00:00Z");

test("job date label: relative source text ages with its stored timestamp", () => {
  assert.equal(jobDateLabel({ dateText: "51 minutes ago", publishedAt: "2026-10-01T00:00:00Z" }, NOW), "hace 20 días");
  assert.equal(jobDateLabel({ dateText: "Fecha no indicada", publishedAt: "2026-10-21T11:30:00Z" }, NOW), "Fecha no indicada");
  assert.equal(jobDateLabel({ dateText: "", publishedAt: "2026-10-21T11:30:00Z" }, NOW), "hace 30 min");
  assert.equal(jobDateLabel({ dateText: "Hoy", publishedAt: "2026-10-21T11:30:00Z" }, NOW), "Hoy");
  assert.equal(jobDateLabel({ dateText: "Hoy", publishedAt: "2026-10-19T11:30:00Z" }, NOW), "hace 2 días");
  assert.equal(jobDateLabel({ publishedAt: "2026-10-21T02:00:00Z" }, NOW), "hace 10 h");
  assert.equal(jobDateLabel({ publishedAt: "2026-10-20T00:00:00.000Z" }, NOW), "hace 1 día");
  assert.equal(jobDateLabel({ publishedAt: "2026-10-15T00:00:00.000Z" }, NOW), "hace 6 días");
  assert.equal(jobDateLabel({ publishedAt: null }, NOW), "Fecha no indicada");
  assert.equal(jobDateLabel({ publishedAt: "not a date" }, NOW), "Fecha no indicada");
});

test("source date parser preserves minutes and rejects missing or unrecognized dates", () => {
  assert.deepEqual(parseDateText("Hace 37 minutos", 2, NOW), {
    date: "2026-10-21T11:23:00.000Z", valid: true
  });
  assert.deepEqual(parseDateText("51 minutes ago", 2, NOW), {
    date: "2026-10-21T11:09:00.000Z", valid: true
  });
  assert.equal(parseDateText("", 2, NOW).valid, false);
  assert.equal(parseDateText("Fecha no indicada", 2, NOW).valid, false);
  assert.equal(parseDateText("Hace 3 semanas", 2, NOW).valid, false);
});
