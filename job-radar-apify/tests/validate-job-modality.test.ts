import { test } from "node:test";
import assert from "node:assert/strict";
import type { Job } from "../src/sources/types.js";
import { applyJobFilters, getJobModalityLabel } from "../src/lib/job-filters.js";
import { classifyModality, sqlJobModality } from "../src/lib/job-modality.js";
import { MODALITY_CASES } from "./fixtures/modality-cases.js";

test("classifyModality: precedence fuente > título > ubicación, sin evidencia = unknown", () => {
  for (const [input, expected] of MODALITY_CASES) {
    assert.equal(classifyModality(input), expected, `${input.title} | ${input.location} | ${input.source}`);
  }
});

test("la etiqueta nunca dice Presencial sin evidencia", () => {
  assert.equal(getJobModalityLabel({ source: "LinkedIn", title: "Senior AI Engineer", location: "Colombia" }), "Sin especificar");
  assert.equal(getJobModalityLabel({ source: "Workana", title: "Logo", location: "México" }), "Freelance · proyecto remoto");
  assert.equal(getJobModalityLabel({ source: "LinkedIn", title: "AI Engineer (Remote, Cali)", location: "Colombia" }), "Remoto");
});

test("el filtro en memoria usa el mismo clasificador que la etiqueta", () => {
  const jobs: Job[] = MODALITY_CASES.map(([input], index) => ({
    jobId: `m${index}`,
    title: input.title ?? "",
    company: "ZzModality",
    location: input.location ?? "",
    url: `https://example.com/${index}`,
    dateText: "",
    source: input.source ?? "LinkedIn",
    remoteType: (input.remoteType ?? undefined) as Job["remoteType"]
  }));
  for (const modality of ["remoto", "hibrido", "presencial"] as const) {
    const expected = MODALITY_CASES.flatMap(([, kind], index) => (kind === modality ? [`m${index}`] : []));
    const got = applyJobFilters(jobs, { modality }).map((job) => job.jobId);
    assert.deepEqual(got, expected, modality);
  }
  // "Presencial" no longer swallows the jobs without evidence nor Workana.
  const presencial = applyJobFilters(jobs, { modality: "presencial" });
  assert.ok(presencial.every((job) => job.source !== "Workana"));
  assert.ok(!presencial.some((job) => job.title === "Senior AI Engineer"));
  assert.equal(applyJobFilters(jobs, { modality: "all" }).length, jobs.length);
});

test("el SQL generado no lleva parámetros y cubre cada regla", () => {
  const sql = sqlJobModality();
  assert.ok(!/\$\d/.test(sql), "sin parámetros posicionales");
  for (const kind of ["freelance", "remoto", "hibrido", "presencial", "unknown"]) assert.ok(sql.includes(`'${kind}'`), kind);
  assert.ok(sql.includes("remote_type = 'fully_remote'"));
  assert.ok(sql.includes("'% remote sensing %'"));
});
