import { test } from "node:test";
import assert from "node:assert/strict";
import type { Job } from "../src/sources/types.js";
import { applyJobFilters, getJobModalityLabel } from "../src/lib/job-filters.js";
import { classifyModality, sqlJobModality } from "../src/lib/job-modality.js";
import { MODALITY_CASES } from "./fixtures/modality-cases.js";
import { buildLocationLabel } from "../src/countries/index.js";

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

test("Workana: el país es el del cliente, no el lugar de trabajo", () => {
  assert.equal(buildLocationLabel({ source: "Workana", location: "España", country: null }, "CO"), "Cliente en España");
  assert.equal(buildLocationLabel({ source: "Workana", location: "", country: null }, "CO"), "Cliente sin país indicado");
  assert.equal(buildLocationLabel({ source: "LinkedIn", location: "Bogotá", country: "CO" }, "CO"), "Bogotá");
  // The job page keeps the server's label (rule E parity with the SSR body).
  assert.equal(buildLocationLabel({ source: "Workana", location: "España", locationLabel: "España" }), "España");
});

test("búsqueda por cargo: proyectos freelance detrás de los empleos del mismo rango", () => {
  const base = { company: "ZzCorp", dateText: "", url: "https://example.com/x" };
  const jobs: Job[] = [
    { ...base, jobId: "w1", title: "Community manager para marca de ropa", location: "España", source: "Workana" },
    { ...base, jobId: "w2", title: "Community Manager y edición de video", location: "Argentina", source: "Workana" },
    { ...base, jobId: "l1", title: "Community Manager", location: "Bogotá", source: "LinkedIn" },
    { ...base, jobId: "m1", title: "COMMUNITY MANAGER", location: "Remoto", source: "Magneto" }
  ];
  const ids = applyJobFilters(jobs, { search: "community manager" }).map((job) => job.jobId);
  assert.deepEqual(ids, ["l1", "m1", "w1", "w2"]);
  // Not a hidden result: every project is still there.
  assert.equal(ids.length, jobs.length);
  // Without a search the order is untouched.
  assert.deepEqual(applyJobFilters(jobs, {}).map((job) => job.jobId), ["w1", "w2", "l1", "m1"]);
});
