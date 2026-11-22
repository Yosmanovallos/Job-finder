import assert from "node:assert/strict";
import test from "node:test";
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  applicationCreateSchema,
  applicationUpdateSchema,
  canonicalApplicationUrl,
  isAppliedOrLater
} from "../src/lib/resume-applications.js";
import { emptyResumeFacts } from "../src/lib/resume-studio.js";

// AI Resume Studio R4b (offline): «Mis postulaciones» validation. Strict
// bodies (no user_id smuggling), only http(s) links, bounded note and
// scores, five statuses with Spanish labels. No database, no network.

test("five statuses, in board order, with labels", () => {
  assert.deepEqual([...APPLICATION_STATUSES], ["saved", "applied", "interview", "offer", "discarded"]);
  assert.deepEqual(APPLICATION_STATUSES.map((s) => APPLICATION_STATUS_LABELS[s]), ["Guardada", "Postulé", "Entrevista", "Oferta", "Descartada"]);
  assert.deepEqual(APPLICATION_STATUSES.filter(isAppliedOrLater), ["applied", "interview", "offer"]);
});

test("create: minimal and full bodies are accepted", () => {
  assert.ok(applicationCreateSchema.safeParse({ job: { title: "Analista" } }).success);
  const full = applicationCreateSchema.safeParse({
    job: { title: "  Analista\nde datos ", company: "Empresa", url: "https://example.com/vacante/1" },
    status: "applied",
    note: "Llamar el lunes",
    adaptationId: "4e540000-0000-4000-8000-00000000000a",
    resumeId: null,
    resumeVersionNo: 3,
    scoreBefore: 28,
    scoreAfter: 70,
    facts: emptyResumeFacts()
  });
  assert.ok(full.success);
  assert.equal(full.data.job.title, "Analista de datos", "control characters and runs of spaces collapse");
});

test("create: rejects smuggled fields, bad links, bad scores, empty title", () => {
  const bad: unknown[] = [
    { job: { title: "X" }, userId: "4e540000-0000-4000-8000-00000000000b" },
    { job: { title: "X", userId: "4e540000-0000-4000-8000-00000000000b" } },
    { job: { title: "" } },
    { job: { title: "   " } },
    { job: { title: "X", url: "javascript:alert(1)" } },
    { job: { title: "X", url: "data:text/html,hi" } },
    { job: { title: "X", url: "https://user:pw@example.com/" } },
    { job: { title: "X", url: `https://example.com/${"a".repeat(2100)}` } },
    { job: { title: "X" }, scoreAfter: 101 },
    { job: { title: "X" }, scoreBefore: -1 },
    { job: { title: "X" }, scoreAfter: 50.5 },
    { job: { title: "X" }, status: "hired" },
    { job: { title: "X" }, adaptationId: "not-a-uuid" },
    { job: { title: "X" }, note: "a".repeat(281) },
    { job: { title: "X" }, facts: { nope: true } }
  ];
  for (const body of bad) assert.equal(applicationCreateSchema.safeParse(body).success, false, JSON.stringify(body).slice(0, 80));
});

test("update: status and/or note, nothing else, never empty", () => {
  assert.ok(applicationUpdateSchema.safeParse({ status: "interview" }).success);
  assert.ok(applicationUpdateSchema.safeParse({ note: "" }).success);
  assert.ok(applicationUpdateSchema.safeParse({ status: "offer", note: "Ronda 2" }).success);
  assert.equal(applicationUpdateSchema.safeParse({}).success, false);
  assert.equal(applicationUpdateSchema.safeParse({ status: "interview", jobTitle: "X" }).success, false);
  assert.equal(applicationUpdateSchema.safeParse({ status: "interview", userId: "x" }).success, false);
});

test("canonical URL: same vacancy, same card", () => {
  assert.equal(canonicalApplicationUrl("https://EXAMPLE.com/a/b/#apply"), "https://example.com/a/b");
  assert.equal(canonicalApplicationUrl("https://example.com/a/b"), "https://example.com/a/b");
  assert.equal(canonicalApplicationUrl("https://example.com/"), "https://example.com/");
  assert.equal(canonicalApplicationUrl("https://example.com/a?id=1"), "https://example.com/a?id=1");
});
