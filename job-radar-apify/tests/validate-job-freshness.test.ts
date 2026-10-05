import assert from "node:assert/strict";
import test from "node:test";
import { jobStaleReason, liveJobSql, MAX_JOB_AGE_DAYS } from "../src/lib/job-freshness.js";
import { validateJobs } from "../src/db/job-validator.js";
import { isGoogleReadyNow, seoReadySql } from "../src/lib/google-job-readiness.js";
import type { Job } from "../src/sources/types.js";

/**
 * Job freshness (bug 2026-10-04: postings older than a month, or already
 * expired at the source, were still live). Offline only.
 */

const NOW = new Date("2026-10-04T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

test("the age limit is one month", () => {
  assert.equal(MAX_JOB_AGE_DAYS, 30);
});

test("jobStaleReason: older than 30 days or past validThrough is stale, everything else is live", () => {
  assert.equal(jobStaleReason(daysAgo(29), null, NOW), null);
  assert.match(jobStaleReason(daysAgo(31), null, NOW) ?? "", /30 días/);
  // The reported Torre posting: created 2026-09-10, deadline 2026-09-25.
  assert.match(jobStaleReason("2026-09-10T19:34:58Z", "2026-09-25T17:53:09Z", NOW) ?? "", /validThrough/);
  assert.equal(jobStaleReason(daysAgo(1), "2026-12-01T00:00:00Z", NOW), null);
  // No date at all is no evidence of expiry.
  assert.equal(jobStaleReason(undefined, undefined, NOW), null);
  assert.equal(jobStaleReason("not a date", "not a date", NOW), null);
});

test("liveJobSql is one predicate on published_at and valid_through, aliased or not", () => {
  assert.equal(
    liveJobSql(),
    "(published_at >= NOW() - INTERVAL '30 days' AND (valid_through IS NULL OR valid_through > NOW()))"
  );
  assert.equal(
    liveJobSql("j"),
    "(j.published_at >= NOW() - INTERVAL '30 days' AND (j.valid_through IS NULL OR j.valid_through > NOW()))"
  );
});

test("a posting that is no longer shown is never ready for Google either", () => {
  const ready = { seoReady: true, isActive: true };
  assert.equal(isGoogleReadyNow({ ...ready, publishedAt: daysAgo(2) }, NOW), true);
  assert.equal(isGoogleReadyNow({ ...ready, publishedAt: daysAgo(31) }, NOW), false);
  assert.equal(isGoogleReadyNow({ ...ready, publishedAt: daysAgo(2), validThrough: daysAgo(1) }, NOW), false);
  assert.match(seoReadySql("j"), /j\.published_at >= NOW\(\) - INTERVAL '30 days'/);
});

function job(overrides: Partial<Job>): Job {
  return {
    jobId: "1",
    title: "Analista de datos",
    company: "Empresa",
    location: "Bogotá",
    url: "https://example.com/job/1",
    dateText: "Hoy",
    source: "LinkedIn",
    publishedAt: new Date().toISOString(),
    ...overrides
  };
}

test("validateJobs never lets an expired posting reach the database", () => {
  const fresh = job({ url: "https://example.com/fresh" });
  const old = job({ url: "https://example.com/old", publishedAt: new Date(Date.now() - 45 * 86_400_000).toISOString() });
  const expired = job({ url: "https://example.com/expired", validThrough: new Date(Date.now() - 60_000).toISOString() });
  const { valid, discarded } = validateJobs([fresh, old, expired]);
  assert.deepEqual(valid.map((j) => j.url), ["https://example.com/fresh"]);
  assert.deepEqual(discarded.map((d) => d.job.url).sort(), ["https://example.com/expired", "https://example.com/old"]);
});
