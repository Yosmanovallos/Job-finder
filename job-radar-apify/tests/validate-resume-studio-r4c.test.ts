import assert from "node:assert/strict";
import test from "node:test";
import { sliceBetween } from "../src/lib/resume-tailor/text.js";
import { newClaims } from "../src/lib/resume-tailor/factuality.js";
import { factTexts } from "../src/lib/resume-tailor/evidence.js";
import { parseResumeAiConfig } from "../src/resume-studio/ai/config.js";
import { createGateway, type CallInfo, type Transport } from "../src/resume-studio/ai/gateway.js";
import { MemoryLedger } from "../src/resume-studio/ai/ledger.js";
import { mockTransport } from "../src/resume-studio/ai/mock.js";
import { CV_EXTRACT, cvExtractOutput } from "../src/resume-studio/ai/prompts.js";
import { extractCvFacts } from "../src/resume-studio/ai/tailor-service.js";
import { adaptationIdFor } from "../src/resume-studio/ai/start-key.js";

// AI Resume Studio R4c — cv_extract@3 (anchors instead of copies), call
// diagnostics without content, and the idempotent /tailor/start id.
// Offline: synthetic CVs only, every transport is a fake or the mock.

const USER = "a0000000-0000-4000-8000-000000000001";
const ctx = { userId: USER, adaptationId: "b0000000-0000-4000-8000-000000000001", purpose: "cv_extract" };

function gatewayWith(transport: Transport, onCall?: (info: CallInfo) => void) {
  const config = parseResumeAiConfig({ RESUME_AI_PROVIDER: "mock" });
  return createGateway({ config, ledger: new MemoryLedger(), transport, onCall });
}

const CV = [
  "[NOMBRE]",
  "Analista de calidad de software",
  "PERFIL",
  "Analista con experiencia en pruebas funcionales y de regresión",
  "sobre aplicaciones web y móviles, documentación de casos y reporte de defectos.",
  "EXPERIENCIA",
  "Analista QA | Empresa Demo S.A.S. | Bogotá | 2021-03 – actual",
  "- Diseñé y ejecuté casos de prueba funcionales para la aplicación móvil de",
  "  clientes, con reporte de defectos en Jira.",
  "- Automaticé pruebas de regresión con Selenium y Java.",
  "Auxiliar de soporte | Servicios Ejemplo Ltda. | Medellín | 2019-01 – 2021-02",
  "- Atendí solicitudes de soporte de primer nivel.",
  "FORMACIÓN",
  "Ingeniería de sistemas | Universidad Demo | 2014-01 – 2019-12",
  "HABILIDADES",
  "Selenium, Java, Jira, SQL",
  "IDIOMAS",
  "Inglés B2"
].join("\n");

test("R4C-SLICE the text between two anchors is copied from the CV (wrapped lines joined)", () => {
  const r = sliceBetween(CV, "Diseñé y ejecuté casos de prueba", "con reporte de defectos en Jira.", 300);
  assert.equal(r?.text, "Diseñé y ejecuté casos de prueba funcionales para la aplicación móvil de clientes, con reporte de defectos en Jira.");
  // Accents/case/spaces in the anchors don't matter; the copy keeps the CV's own spelling.
  assert.equal(sliceBetween(CV, "automatice PRUEBAS de regresion", "selenium y java.", 300)?.text, "Automaticé pruebas de regresión con Selenium y Java.");
  // Start not in the CV → nothing.
  assert.equal(sliceBetween(CV, "Lideré un equipo de 12 personas", "12 personas", 300), null);
  // Invented end → the copy stops at the end of the line: nothing invented can come in.
  const fake = sliceBetween(CV, "Automaticé pruebas de regresión", "reduciendo los defectos un 40%", 300);
  assert.equal(fake?.text, "Automaticé pruebas de regresión con Selenium y Java.");
  // The cap ends on a whole word.
  const capped = sliceBetween(CV, "Analista con experiencia", "reporte de defectos.", 40);
  assert.ok(capped && capped.text.length <= 40 && !/\s$/.test(capped.text), capped?.text);
});

test("R4C-EXTRACT v3 answers: literal bullets, invented fields dropped, nothing new accepted", async () => {
  const answer = {
    headline: { text: "Analista de calidad de software" },
    summary: { start: "Analista con experiencia en pruebas", end: "y reporte de defectos." },
    experience: [
      {
        role: "Analista QA",
        company: "Empresa Demo S.A.S.",
        city: "Bogotá",
        startDate: "2021-03",
        endDate: "",
        current: true,
        bullets: [
          { start: "Diseñé y ejecuté casos de prueba", end: "defectos en Jira." },
          // Real start, invented end (the attack short anchors open).
          { start: "Automaticé pruebas de regresión", end: "reduciendo los defectos un 40% en 6 meses" },
          // Invented bullet.
          { start: "Lideré un equipo de 12 personas", end: "personas" }
        ]
      },
      { role: "Gerente general", company: "Empresa Inventada S.A.", city: "", startDate: "2015-01", endDate: "", current: true, bullets: [] }
    ],
    education: [{ degree: "Ingeniería de sistemas", institution: "Universidad Demo", startDate: "2014-01", endDate: "2019-12" }],
    certifications: [{ name: "ISTQB Advanced", issuer: "ISTQB", date: "2022-01" }],
    skills: ["Selenium", "Java", "Python", "Jira"],
    languages: [{ name: "Inglés", level: "B2" }]
  };
  const g = gatewayWith(async () => ({ content: JSON.stringify(answer), usage: null }));
  const out = await extractCvFacts(g, ctx, CV);
  assert.ok(out.ok);
  const facts = out.ok ? out.result.facts : null!;
  assert.equal(facts.summary, "Analista con experiencia en pruebas funcionales y de regresión sobre aplicaciones web y móviles, documentación de casos y reporte de defectos.");
  assert.equal(facts.experience.length, 1);
  assert.deepEqual(
    facts.experience[0].bullets.map((b) => b.text),
    [
      "Diseñé y ejecuté casos de prueba funcionales para la aplicación móvil de clientes, con reporte de defectos en Jira.",
      "Automaticé pruebas de regresión con Selenium y Java."
    ]
  );
  assert.deepEqual(facts.skills.map((s) => s.name), ["Selenium", "Java", "Jira"]);
  assert.equal(facts.certifications.length, 0);
  assert.deepEqual([facts.languages[0].name, facts.languages[0].level], ["Inglés", "B2"]);
  for (const label of ["Experiencia «Gerente general»", "Habilidad «Python»", "Certificación «ISTQB Advanced»"]) {
    assert.ok(out.ok && out.result.dropped.includes(label), label);
  }
  // 0 invented: every text that reached the facts says nothing the CV doesn't.
  const invented = factTexts(facts).flatMap((f) => newClaims(f.text, [CV]));
  assert.deepEqual(invented, []);
});

test("R4C-EXTRACT old-shape answers ({text, quote}) still parse; the text comes from the CV", async () => {
  const old = {
    headline: null,
    summary: null,
    experience: [
      {
        role: "Analista QA",
        company: "Empresa Demo S.A.S.",
        city: "",
        startDate: "",
        endDate: "",
        current: true,
        quote: "Analista QA",
        bullets: [{ text: "Automaticé pruebas de regresión con Selenium, Java y Python, mejorando la cobertura.", quote: "Automaticé pruebas de regresión" }]
      }
    ],
    education: [],
    certifications: [],
    skills: [{ name: "SQL", quote: "SQL" }],
    languages: []
  };
  const parsed = cvExtractOutput.safeParse(old);
  assert.ok(parsed.success);
  const g = gatewayWith(async () => ({ content: JSON.stringify(old), usage: null }));
  const out = await extractCvFacts(g, ctx, CV);
  assert.ok(out.ok);
  assert.deepEqual(out.ok && out.result.facts.experience[0].bullets.map((b) => b.text), ["Automaticé pruebas de regresión con Selenium y Java."]);
});

test("R4C-SIZE a long CV fits: the v3 answer is a fraction of the CV, under max_tokens", async () => {
  const blocks: string[] = ["Analista de calidad de software", "PERFIL", "Analista con experiencia en pruebas funcionales, de regresión y de aceptación sobre aplicaciones web y móviles.", "EXPERIENCIA"];
  for (let i = 0; i < 8; i++) {
    blocks.push(`Analista QA ${i + 1} | Empresa ${i + 1} S.A.S. | Bogotá | 20${10 + i}-01 – 20${11 + i}-01`);
    for (let j = 0; j < 6; j++) blocks.push(`- Ejecuté el plan de pruebas número ${j + 1} del proyecto ${i + 1}, con casos documentados, evidencias y reporte de defectos al equipo de desarrollo.`);
  }
  const cv = blocks.join("\n");
  assert.ok(cv.length > 6000, `${cv.length}`);
  let content = "";
  const mock = mockTransport({ fabricationRate: 0, invalidJsonRate: 0 });
  const g = gatewayWith(async (req) => {
    const r = await mock(req);
    content = r.content;
    return r;
  });
  const out = await extractCvFacts(g, ctx, cv);
  assert.ok(out.ok);
  // v1/v2 repeated every text twice (text + quote ≈ 2× the CV); v3 stays under 1×.
  assert.ok(content.length < cv.length, `answer ${content.length} vs CV ${cv.length}`);
  assert.ok(content.length / 3 < CV_EXTRACT.maxOutputTokens, "estimated tokens under max_tokens");
  const facts = out.ok ? out.result.facts : null!;
  assert.equal(facts.experience.length, 8);
  // Bullets are whole (not cut to the anchor).
  assert.ok(facts.experience.every((e) => e.bullets.length === 6 && e.bullets.every((b) => b.text.endsWith("al equipo de desarrollo."))));
});

test("R4C-DIAG every call reports finish_reason and sizes, never content", async () => {
  const infos: CallInfo[] = [];
  const cut = JSON.stringify({ headline: { text: "Analista de calidad" }, summary: null, experience: [{ role: "Analista QA" }] }).slice(0, 60);
  let n = 0;
  const g = gatewayWith(
    async () => {
      n++;
      return n === 1
        ? { content: cut, usage: { promptTokens: 100, completionTokens: 4000, cachedTokens: 0 }, finishReason: "length" }
        : { content: JSON.stringify({ headline: { text: "Analista de calidad de software" } }), usage: { promptTokens: 100, completionTokens: 20, cachedTokens: 0 }, finishReason: "stop" };
    },
    (info) => infos.push(info)
  );
  const out = await extractCvFacts(g, ctx, CV);
  assert.ok(out.ok);
  assert.deepEqual(
    infos.map((i) => [i.promptId, i.promptVersion, i.attempt, i.outcome, i.finishReason, i.completionTokens, i.invalidKind ?? null]),
    [
      ["cv_extract", 3, 1, "invalid", "length", 4000, "truncated"],
      ["cv_extract", 3, 2, "ok", "stop", 20, null]
    ]
  );
  assert.equal(infos[0].contentChars, cut.length);
  const logged = JSON.stringify(infos);
  for (const needle of ["Analista", "Empresa", "Selenium"]) assert.equal(logged.includes(needle), false, needle);
});

test("R4C-START adaptation id per (user, client key): stable, valid UUID, different per user", () => {
  const key = "c0000000-0000-4000-8000-000000000001";
  const a = adaptationIdFor(USER, key);
  assert.equal(a, adaptationIdFor(USER, key.toUpperCase()));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, adaptationIdFor("a0000000-0000-4000-8000-000000000002", key));
  assert.notEqual(a, adaptationIdFor(USER, "c0000000-0000-4000-8000-000000000002"));
});

test("R4C-START the ledger claim is once per id; a refused start can be undone", async () => {
  const ledger = new MemoryLedger();
  const id = adaptationIdFor(USER, "c0000000-0000-4000-8000-000000000003");
  assert.equal(await ledger.claimAdaptation(USER, id), true);
  assert.equal(await ledger.claimAdaptation(USER, id), false);
  assert.equal(await ledger.ownsAdaptation(USER, id), true);
  await ledger.unclaimAdaptation(USER, id);
  assert.equal(await ledger.ownsAdaptation(USER, id), false);
  assert.equal(await ledger.claimAdaptation(USER, id), true);
});

test("R4C-SLICE wrapped PDF lines are followed to the end of the sentence; the next bullet is never swallowed", () => {
  const pdf = [
    "QA Specialist (Hybrid) | Provana",
    "● Collaborate with cross-functional teams on testability, defect triage, user stories",
    "and the definition of done while improving release quality.",
    "● Apply artificial intelligence to test design.",
    "Executed functional and automated testing using Python. ● Performed API testing with Postman."
  ].join("\n");
  // End anchor the model got slightly wrong → follow the wrapped line to the period.
  assert.equal(
    sliceBetween(pdf, "Collaborate with cross-functional teams", "release quality!!", 300)?.text,
    "Collaborate with cross-functional teams on testability, defect triage, user stories and the definition of done while improving release quality."
  );
  // End anchor found but PAST the next bullet mark (inline ●) → cut at the mark.
  assert.equal(
    sliceBetween(pdf, "Executed functional and automated testing", "API testing with Postman.", 300)?.text,
    "Executed functional and automated testing using Python."
  );
  // A line-start bullet also ends the text.
  assert.equal(sliceBetween(pdf, "and the definition of done", "Apply artificial intelligence to test design.", 300)?.text, "and the definition of done while improving release quality.");
});

test("R4C-DRAFT «Que la IA lo redacte» only rephrases that experience's facts; anything new is not applied", async () => {
  const facts = {
    schemaVersion: 1 as const,
    basics: { fullName: "", headline: "", email: "", phone: "", city: "", links: [] },
    summary: "",
    experience: [
      { id: "e1", source: "user" as const, sourceSpan: null, role: "Analista QA", company: "Empresa Demo", city: "", startDate: "", endDate: "", current: true,
        bullets: [{ id: "b1", source: "user" as const, sourceSpan: null, text: "Automaticé pruebas de regresión con Selenium y Java." }] },
      { id: "e2", source: "user" as const, sourceSpan: null, role: "Auxiliar", company: "Otra", city: "", startDate: "", endDate: "", current: false, bullets: [] }
    ],
    education: [], certifications: [], skills: [], languages: []
  };
  const { proposeCard } = await import("../src/resume-studio/ai/tailor-service.js");
  const honest = gatewayWith(mockTransport({ fabricationRate: 0, invalidJsonRate: 0 }));
  const ok = await proposeCard(honest, ctx, { card: "draft", requirement: "Automatización de pruebas con Selenium", facts, experienceId: "e1" });
  assert.equal(ok.status, "proposal", JSON.stringify(ok));
  // A model that adds a figure or a tool never gets applied.
  for (let i = 0; i < 6; i++) {
    const g = gatewayWith(mockTransport({ fabricationRate: 1, invalidJsonRate: 0 }));
    const r = await proposeCard(g, ctx, { card: "draft", requirement: `Automatización ${i}`, facts, experienceId: "e1" });
    assert.notEqual(r.status, "proposal", JSON.stringify(r));
  }
  // An experience with no bullets can't support a draft: a question, and no model call.
  let calls = 0;
  const counting = gatewayWith(async (req) => {
    calls++;
    return mockTransport({ fabricationRate: 0, invalidJsonRate: 0 })(req);
  });
  const empty = await proposeCard(counting, ctx, { card: "draft", requirement: "Soporte", facts, experienceId: "e2" });
  assert.equal(empty.status, "question");
  assert.equal(calls, 0);
});
