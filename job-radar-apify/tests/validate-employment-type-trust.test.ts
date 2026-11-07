/**
 * employment-type-trust (openspec/changes/employment-type-trust) — offline.
 *
 * Magneto's JobPosting employmentType is its contract term, not the schedule
 * (validation.md §2), so its value is never shown or emitted. Every other
 * source keeps exactly what it published.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { trustedEmploymentType } from "../src/lib/employment-type-trust.js";
import { extractJobPostingDetail } from "../src/lib/job-posting-jsonld.js";
import { buildJobMetaDescription, buildJobPageBody, buildJobPagePayload, buildJobPosting, type SeoJob } from "../src/lib/job-seo.js";
import { toPublicJob } from "../src/lib/public-jobs-api.js";
import { boardJob } from "./fixtures/job-page-blocks.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => fs.readFileSync(path.join(here, "fixtures", "detail", name), "utf8");

// A Google-ready page whose only difference is the source.
const page = (source: string, employmentType: string | undefined): SeoJob => ({ ...boardJob, source, employmentType });

test("ETT-001 the parser still stores Magneto's raw value (no data is dropped at ingest)", () => {
  const detail = extractJobPostingDetail(fixture("magneto-contract-term-synthetic.html"));
  assert.equal(detail?.employmentType, "Medio tiempo");
});

test("ETT-002 a Magneto PART_TIME from a contract term is not emitted, shown or described", () => {
  const job = page("Magneto", "Medio tiempo");
  const posting = buildJobPosting(job);
  assert.ok(posting, "the page stays Google-eligible");
  assert.equal("employmentType" in posting, false);
  assert.equal(buildJobPageBody(job).includes("Tipo de empleo"), false);
  assert.equal(buildJobMetaDescription(job).includes("Medio tiempo"), false);
  assert.equal(buildJobPagePayload(job).job.employmentType, undefined);
});

test("ETT-003 every Magneto value is dropped, FULL_TIME and TEMPORARY included", () => {
  for (const label of ["Tiempo completo", "Temporal", "Por día", "Prácticas"]) {
    assert.equal("employmentType" in (buildJobPosting(page("Magneto", label)) ?? {}), false, label);
  }
  assert.equal(trustedEmploymentType(" Magneto ", "Medio tiempo"), undefined);
});

test("ETT-007 Elempleo's contract-derived PER_DIEM/TEMPORARY/FULL_TIME is dropped the same way", () => {
  for (const label of ["Por día", "Temporal", "Tiempo completo"]) {
    const job = page("Elempleo", label);
    assert.equal("employmentType" in (buildJobPosting(job) ?? {}), false, label);
    assert.equal(buildJobPageBody(job).includes("Tipo de empleo"), false, label);
  }
});

test("ETT-004 the Magneto page keeps every other JobPosting field", () => {
  const withType = buildJobPosting(page("Computrabajo", "Medio tiempo")) as Record<string, unknown>;
  const magneto = buildJobPosting(page("Magneto", "Medio tiempo")) as Record<string, unknown>;
  const { employmentType: _dropped, ...rest } = withType;
  assert.deepEqual(magneto, rest);
});

test("ETT-005 other sources keep the value they published", () => {
  assert.equal(buildJobPosting(page("Computrabajo", "Tiempo completo"))?.employmentType, "FULL_TIME");
  assert.equal(buildJobPosting(page("LinkedIn", "Medio tiempo"))?.employmentType, "PART_TIME");
  assert.equal(buildJobPosting(page("Torre", "Medio tiempo"))?.employmentType, "PART_TIME");
  assert.ok(buildJobPageBody(page("Computrabajo", "Tiempo completo")).includes("Tipo de empleo: Tiempo completo"));
  assert.ok(buildJobMetaDescription(page("Computrabajo", "Tiempo completo")).includes("Tiempo completo."));
  assert.equal(trustedEmploymentType("Computrabajo", ""), undefined);
  assert.equal(trustedEmploymentType("Computrabajo", null), undefined);
});

test("ETT-006 the public API applies the same rule", () => {
  const base = { ...boardJob, publishedAt: boardJob.publishedAt };
  assert.equal(toPublicJob({ ...base, source: "Magneto", employmentType: "Medio tiempo" })?.employmentType, null);
  assert.equal(toPublicJob({ ...base, source: "Computrabajo", employmentType: "Tiempo completo" })?.employmentType, "Tiempo completo");
});
