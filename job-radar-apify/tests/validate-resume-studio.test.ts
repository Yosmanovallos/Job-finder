import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONSENT_ITEMS,
  RESUME_TEMPLATE_IDS,
  emptyResumeFacts,
  formatResumeRange,
  parseResumeStudioFlag,
  resumeFactsSchema,
  resumeInputSchema
} from "../src/lib/resume-studio.js";
import { consentTextHash, isResumeStudioPath } from "../src/server/routes/resume.js";

// AI Resume Studio R1 (ADR 0017) — deterministic rules, no database.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const valid = () => ({ title: "Mi hoja de vida", templateId: "clasica", facts: emptyResumeFacts() });

test("RS-001 the flag is strict: only the literal \"true\" turns the module on", () => {
  assert.equal(parseResumeStudioFlag("true"), true);
  for (const value of [undefined, "", "false", "TRUE", "1", "yes", " true"]) assert.equal(parseResumeStudioFlag(value), false, String(value));
});

test("RS-002 the server reads the flag inline with the same rule and imports the module lazily", async () => {
  const server = await readFile(path.join(root, "src", "server.ts"), "utf8");
  assert.match(server, /const RESUME_STUDIO_ENABLED = process\.env\.RESUME_STUDIO_ENABLED === "true";/);
  assert.doesNotMatch(server, /^import .*routes\/resume\.js/m, "server.ts must not import the module statically");
  assert.match(server, /RESUME_STUDIO_ENABLED &&[\s\S]{0,200}await import\("\.\/server\/routes\/resume\.js"\)/);
  const app = await readFile(path.join(root, "src", "App.tsx"), "utf8");
  assert.match(app, /lazy\(\(\) => import\("\.\/sections\/ResumeStudio\.js"\)\)/, "the page is its own chunk");
  assert.doesNotMatch(app, /^import .*(resume-studio|ResumeStudio)/m, "no static import into the main bundle");
});

test("RS-003 module paths", () => {
  for (const p of ["/hoja-de-vida", "/hoja-de-vida/editar", "/api/resume/consent", "/api/resume/resumes/x"]) assert.ok(isResumeStudioPath(p), p);
  for (const p of ["/hoja-de-vidas", "/api/resumes", "/empleos/hoja-de-vida", "/api/me"]) assert.ok(!isResumeStudioPath(p), p);
});

test("RS-004 three consent boxes: two required, storage optional, none pre-checked by the schema", () => {
  assert.deepEqual(CONSENT_ITEMS.map((i) => [i.purpose, i.required]), [
    ["cv_processing", true],
    ["terms", true],
    ["cloud_storage", false]
  ]);
  for (const item of CONSENT_ITEMS) {
    assert.ok(item.text.length > 100, `${item.purpose}: full text behind the link`);
    assert.match(consentTextHash(item.text), /^[0-9a-f]{64}$/);
  }
  assert.notEqual(consentTextHash(CONSENT_ITEMS[0].text), consentTextHash(CONSENT_ITEMS[0].text + " "));
  const processing = CONSENT_ITEMS[0].text;
  for (const needed of ["Estados Unidos", "30 días", "revocar", "Ley 1581", "/legal/privacidad"]) assert.ok(processing.includes(needed), needed);
});

test("RS-005 three one-column templates", () => {
  assert.deepEqual(RESUME_TEMPLATE_IDS, ["clasica", "moderna", "compacta"]);
  assert.equal(resumeInputSchema.safeParse({ ...valid(), templateId: "dos-columnas" }).success, false);
});

test("RS-006 strict facts: sensitive or unknown fields are rejected, not stored (doc 09 P10)", () => {
  assert.equal(resumeInputSchema.safeParse(valid()).success, true);
  for (const extra of [{ photo: "data:image/png;base64,AA" }, { cedula: "1234567" }, { estadoCivil: "soltera" }]) {
    const input = valid();
    assert.equal(resumeInputSchema.safeParse({ ...input, facts: { ...input.facts, basics: { ...input.facts.basics, ...extra } } }).success, false);
    assert.equal(resumeInputSchema.safeParse({ ...input, facts: { ...input.facts, ...extra } }).success, false);
  }
  assert.equal(resumeInputSchema.safeParse({ ...valid(), userId: "someone-else" }).success, false, "no client-sent user id");
});

test("RS-007 limits, dates and links", () => {
  const facts = emptyResumeFacts();
  const exp = (startDate: string) => ({ id: "exp-1", source: "user", sourceSpan: null, role: "R", company: "C", city: "", startDate, endDate: "", current: true, bullets: [] });
  assert.equal(resumeFactsSchema.safeParse({ ...facts, experience: [exp("2024-03")] }).success, true);
  for (const bad of ["2024-13", "03/2024", "2024", "1890-01"]) {
    assert.equal(resumeFactsSchema.safeParse({ ...facts, experience: [exp(bad)] }).success, false, bad);
  }
  assert.equal(resumeFactsSchema.safeParse({ ...facts, summary: "x".repeat(1201) }).success, false);
  assert.equal(resumeFactsSchema.safeParse({ ...facts, skills: Array.from({ length: 41 }, (_, i) => ({ id: `s-${i}`, name: "x" })) }).success, false);
  const withLink = (link: string) => resumeFactsSchema.safeParse({ ...facts, basics: { ...facts.basics, links: [link] } }).success;
  assert.equal(withLink("https://www.linkedin.com/in/ejemplo"), true);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "https://user:pass@example.com", "no es url"]) assert.equal(withLink(bad), false, bad);
  assert.equal(resumeFactsSchema.safeParse({ ...facts, basics: { ...facts.basics, email: "no-es-correo" } }).success, false);
  assert.equal(resumeFactsSchema.safeParse({ ...facts, experience: [{ ...exp("2024-01"), id: "Bad Id!" }] }).success, false);
});

test("RS-008 facts default to source \"user\" with no span; only \"user\" is accepted in R1", () => {
  const parsed = resumeFactsSchema.parse({ ...emptyResumeFacts(), skills: [{ id: "sk-1", name: "Excel" }] });
  assert.deepEqual(parsed.skills[0], { id: "sk-1", source: "user", sourceSpan: null, name: "Excel" });
  assert.equal(resumeFactsSchema.safeParse({ ...emptyResumeFacts(), skills: [{ id: "sk-1", name: "Excel", source: "ai" }] }).success, false);
});

test("RS-009 date ranges", () => {
  assert.equal(formatResumeRange("2022-01", "", true), "ene. 2022 – actual");
  assert.equal(formatResumeRange("2020-05", "2021-12"), "may. 2020 – dic. 2021");
  assert.equal(formatResumeRange("", ""), "");
});

test("RS-010 the migration refuses remote databases until R5", async () => {
  const script = await readFile(path.join(root, "scripts", "migrate-resume-studio.ts"), "utf8");
  assert.match(script, /--allow-remote-db"\)\) \{\s*throw new Error\("Bloqueado hasta R5/);
  const runner = await readFile(path.join(root, "scripts", "run-isolated-tests.ts"), "utf8");
  assert.doesNotMatch(runner, /BEGIN resume-studio/, "the runner must not pre-apply the block: production doesn't have it");
});
