import assert from "node:assert/strict";
import test from "node:test";
import { jobDateLabel } from "../src/lib/job-date-label.js";

/**
 * The posting-age label on cards and detail pages: the source's own text
 * wins; a date-only source (company portals, Magneto) gets a relative label
 * instead of the raw ISO timestamp (found in the F5 visual check, 2026-10-21).
 */
const NOW = new Date("2026-10-21T12:00:00Z");

test("job date label: source text first, then a relative label from publishedAt, never a raw timestamp", () => {
  assert.equal(jobDateLabel({ dateText: "51 minutes ago", publishedAt: "2026-10-01T00:00:00Z" }, NOW), "51 minutes ago");
  assert.equal(jobDateLabel({ dateText: "Fecha no indicada", publishedAt: "2026-10-21T11:30:00Z" }, NOW), "Fecha no indicada");
  assert.equal(jobDateLabel({ dateText: "", publishedAt: "2026-10-21T11:30:00Z" }, NOW), "hace menos de 1 h");
  assert.equal(jobDateLabel({ publishedAt: "2026-10-21T02:00:00Z" }, NOW), "hace 10 h");
  assert.equal(jobDateLabel({ publishedAt: "2026-10-20T00:00:00.000Z" }, NOW), "hace 1 día");
  assert.equal(jobDateLabel({ publishedAt: "2026-10-15T00:00:00.000Z" }, NOW), "hace 6 días");
  assert.equal(jobDateLabel({ publishedAt: null }, NOW), "Reciente");
  assert.equal(jobDateLabel({ publishedAt: "not a date" }, NOW), "Reciente");
});
