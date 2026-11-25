import assert from "node:assert/strict";
import test from "node:test";
import { emptyResumeFacts, resumeFactsSchema, type ResumeFacts } from "../src/lib/resume-studio.js";
import { applyBullet, applySkills, buildQueue, MAX_MAPPING_CARDS, missingSkills, tidyUserBullet } from "../src/lib/resume-tailor/cards.js";
import { computeEvidence, verifyCitations } from "../src/lib/resume-tailor/evidence.js";
import { newClaims, validateProposal } from "../src/lib/resume-tailor/factuality.js";
import { acceptModelRequirements, analyzeJob } from "../src/lib/resume-tailor/requirements.js";
import { compatibilityScore, COMPATIBILITY_DISCLAIMER, qualityScore, startsWithVerb } from "../src/lib/resume-tailor/score.js";
import { findQuote, normalizeText } from "../src/lib/resume-tailor/text.js";

// AI Resume Studio R3 — deterministic core (doc 05 §4–5, doc 09 §2, doc 11
// §5.2). Offline, synthetic data only.

const VACANCY =
  "Analista de Marketing Digital Jr. — Cafetal Demo S.A.S., Bogotá, híbrido. Requisitos: experiencia en pauta en Meta Ads y TikTok Ads; " +
  "reportes de resultados en Looker Studio o GA4; gestión de calendario de contenidos. Deseable: pruebas A/B. Ofrecemos contrato a término indefinido.";

function laura(): ResumeFacts {
  const f = emptyResumeFacts();
  f.basics = { fullName: "Laura Méndez Ejemplo", headline: "Comunicadora social", email: "laura@ejemplo.test", phone: "300 000 0000", city: "Bogotá", links: [] };
  f.summary = "Comunicadora social con experiencia en redes sociales y eventos.";
  f.experience = [
    { id: "e1", source: "user", sourceSpan: null, role: "Community Manager (prácticas)", company: "Agencia Andina Demo S.A.S.", city: "", startDate: "2024-02", endDate: "2024-12", current: false, bullets: [
      { id: "b1", source: "user", sourceSpan: null, text: "Publicaciones diarias en Instagram y TikTok." },
      { id: "b2", source: "user", sourceSpan: null, text: "Respuesta a comentarios y mensajes directos." }
    ] },
    { id: "e2", source: "user", sourceSpan: null, role: "Auxiliar de mercadeo", company: "Tienda La 70 Demo S.A.S.", city: "", startDate: "2023-01", endDate: "2024-01", current: false, bullets: [
      { id: "b3", source: "user", sourceSpan: null, text: "Apoyo en campañas de temporada." },
      { id: "b4", source: "user", sourceSpan: null, text: "Informe semanal de ventas para la gerencia." }
    ] }
  ];
  f.skills = [
    { id: "s1", source: "user", sourceSpan: null, name: "GA4" },
    { id: "s2", source: "user", sourceSpan: null, name: "Canva" }
  ];
  return f;
}

test("RS3-TEXT normalize and literal quotes with offsets", () => {
  assert.equal(normalizeText("  Gestión   del 20 % de «ventas» "), "gestion del 20% de ventas");
  const original = "Comunicadora   Social\ncon experiencia en Redes";
  const span = findQuote(original, "social con experiencia");
  assert.ok(span);
  assert.equal(original.slice(span.start, span.end), "Social\ncon experiencia");
  assert.equal(findQuote(original, "con 10 años de experiencia"), null);
  assert.equal(findQuote(original, "a"), null, "1-char quotes are not citations");
});

test("RS3-REQ-1 rules: inline headings, must/nice, offers end the list", () => {
  const job = analyzeJob({ title: "Analista de Marketing Digital Jr.", description: VACANCY });
  assert.deepEqual(
    job.requirements.map((r) => [r.id, r.kind, r.text]),
    [
      ["r1", "must", "experiencia en pauta en Meta Ads y TikTok Ads"],
      ["r2", "must", "reportes de resultados en Looker Studio o GA4"],
      ["r3", "must", "gestión de calendario de contenidos"],
      ["r4", "nice", "pruebas A/B"]
    ]
  );
  assert.equal(job.source, "rules");
  assert.deepEqual(job.skills, ["Meta Ads", "TikTok Ads", "GA4", "Looker Studio", "Pruebas A/B", "Calendario de contenidos"]);
  assert.ok(job.titleTerms.includes("marketing"));
});

test("RS3-REQ-2 rules: bullet lists, keywords override the section, tasks kept apart", () => {
  const job = analyzeJob({
    title: "Contador",
    description: "Funciones:\n- Cierres contables mensuales\nRequisitos:\n- Mínimo 3 años en NIIF\n- Manejo de SAP (deseable)\n¿Qué ofrecemos?\n- Salario integral"
  });
  assert.deepEqual(job.requirements.map((r) => [r.kind, r.text]), [["must", "Mínimo 3 años en NIIF"], ["nice", "Manejo de SAP (deseable)"]]);
  assert.deepEqual(job.tasks, ["Cierres contables mensuales"]);
});

test("RS3-REQ-3 no headings → none; model requirements only when literally in the vacancy", () => {
  const description = "Buscamos una persona amable para atender clientes en tienda y apoyar el cierre de caja.";
  assert.equal(analyzeJob({ title: "Auxiliar", description }).source, "none");
  const accepted = acceptModelRequirements(description, [
    { text: "atender clientes en tienda", kind: "must" },
    { text: "10 años de experiencia en liderazgo", kind: "must" },
    { text: "apoyar el cierre de caja", kind: "nice" }
  ]);
  assert.deepEqual(accepted.map((r) => [r.id, r.text]), [["r1", "atender clientes en tienda"], ["r2", "apoyar el cierre de caja"]]);
});

test("RS3-EVID citations are verified by code and the level is computed, not taken from the model", () => {
  const facts = laura();
  assert.deepEqual(
    verifyCitations(facts, [
      { factId: "b4", quote: "informe semanal" },
      { factId: "b4", quote: "dashboard en Looker" },
      { factId: "no-existe", quote: "Apoyo" }
    ]),
    [{ factId: "b4", quote: "informe semanal" }]
  );
  const job = analyzeJob({ title: "Analista de Marketing Digital Jr.", description: VACANCY });
  const ev = computeEvidence(job.requirements, facts);
  assert.deepEqual(ev.map((e) => e.level), ["none", "partial", "none", "none"]);
  // A citation the model swears by but whose fact says nothing relevant changes nothing.
  const cited = computeEvidence(job.requirements, facts, { r1: [{ factId: "b3", quote: "campañas de temporada" }] });
  assert.equal(cited[0].level, ev[0].level);
});

test("RS3-SCORE-1 compatibility: doc 05 §4 weights, determinism, disclaimer", () => {
  const facts = laura();
  const job = analyzeJob({ title: "Analista de Marketing Digital Jr.", description: VACANCY });
  const ev = computeEvidence(job.requirements, facts);
  const a = compatibilityScore(job, ev, facts);
  assert.deepEqual(a.components.map((c) => [c.id, c.max]), [["must", 40], ["nice", 15], ["skills", 20], ["readability", 15], ["focus", 10]]);
  assert.deepEqual(compatibilityScore(job, ev, facts), a, "same input, same output");
  assert.equal(a.total, Math.round(a.components.reduce((s, c) => s + c.points, 0)));
  assert.match(COMPATIBILITY_DISCLAIMER, /No es el puntaje de ningún ATS/);

  // Approving the user's own bullets raises the number with no model involved.
  let next = applyBullet(facts, { experienceId: "e1" }, "Configuré 6 campañas pequeñas en Meta Ads y TikTok Ads con presupuesto limitado.");
  next = applyBullet(next, { experienceId: "e2" }, "Armé un reporte semanal en Looker Studio con datos de GA4.");
  next = applyBullet(next, { experienceId: "e1" }, "Llevé el calendario de contenidos mensual de 3 marcas.");
  next = applySkills(next, ["Meta Ads", "Looker Studio"], missingSkills(job, facts).missing);
  const b = compatibilityScore(job, computeEvidence(job.requirements, next), next);
  assert.ok(b.total >= a.total + 30, `${a.total} → ${b.total}`);
  assert.equal(b.components[0].points, 40, "the three musts are now shown");
});

test("RS3-SCORE-2 redistribution without requirements, and forbidden variables don't count", () => {
  const facts = laura();
  const job = analyzeJob({ title: "Auxiliar de tienda", description: "Atender clientes en tienda." });
  const s = compatibilityScore(job, [], facts);
  const must = s.components.find((c) => c.id === "must")!;
  assert.equal(must.available, false);
  assert.equal(must.max, 0);
  assert.equal(Math.round(s.components.reduce((acc, c) => acc + c.max, 0)), 100);
  assert.equal(s.notices.length, 1);
  // Name, e-mail, phone and city content never move the number: only whether contact is filled.
  const other = structuredClone(facts);
  other.basics = { ...other.basics, fullName: "Otra Persona Demo", email: "otra@ejemplo.test", phone: "300 000 0001", city: "Cali" };
  const full = analyzeJob({ title: "Analista de Marketing Digital Jr.", description: VACANCY });
  assert.equal(compatibilityScore(full, computeEvidence(full.requirements, other), other).total, compatibilityScore(full, computeEvidence(full.requirements, facts), facts).total);
});

test("RS3-SCORE-3 quality score (structure only) and verb detection", () => {
  assert.equal(startsWithVerb("Configuré 6 campañas"), true);
  assert.equal(startsWithVerb("Organizó la feria"), true);
  assert.equal(startsWithVerb("Apoyo en campañas"), true);
  assert.equal(startsWithVerb("Publicaciones diarias en Instagram"), false);
  assert.equal(startsWithVerb("Informe semanal de ventas"), false);
  const q = qualityScore(laura());
  assert.equal(q.checks.length, 10);
  assert.equal(q.total, Math.round((q.checks.filter((c) => c.ok).length / 10) * 100));
  assert.equal(qualityScore(emptyResumeFacts()).total, 0);
});

// ---- factuality: 40 cases (doc 09 §2) ------------------------------------

const SRC = [
  "Configuré 6 campañas pequeñas en Meta Ads y TikTok Ads con presupuesto limitado y analicé los resultados.",
  "Auxiliar de mercadeo · Tienda La 70 Demo S.A.S.",
  "Informe semanal de ventas para la gerencia en Excel.",
  "Atendí 60 llamadas por turno en 2023 con un 95 % de satisfacción."
];
const CASES: [string, "accept" | "question" | "discard"][] = [
  ["Configuré 6 campañas en Meta Ads y TikTok Ads con presupuesto limitado.", "accept"],
  ["Analicé los resultados de 6 campañas en Meta Ads.", "accept"],
  ["Elaboré el informe semanal de ventas en Excel para la gerencia.", "accept"],
  ["Atendí 60 llamadas por turno con 95% de satisfacción.", "accept"],
  ["Atendí sesenta llamadas por turno.", "accept"],
  ["En 2023 atendí 60 llamadas por turno.", "accept"],
  ["Configuré seis campañas en TikTok Ads.", "accept"],
  ["Apoyé a la gerencia con un informe semanal de ventas.", "accept"],
  ["Gestioné campañas con presupuesto limitado.", "accept"],
  ["Trabajé en Tienda La 70 Demo S.A.S. como auxiliar de mercadeo.", "accept"],
  ["Configuré 8 campañas en Meta Ads.", "question"],
  ["Configuré 6 campañas y aumenté las ventas un 35%.", "question"],
  ["Atendí 60 llamadas por turno con 98 % de satisfacción.", "question"],
  ["En 2021 atendí 60 llamadas por turno.", "question"],
  ["Desde enero atendí 60 llamadas por turno.", "question"],
  ["Configuré campañas para Bancolombia en Meta Ads.", "discard"],
  ["Trabajé en Rappi Demo como auxiliar.", "discard"],
  ["Lideré como Gerente las campañas en Meta Ads.", "discard"],
  ["Especialista senior en campañas de Meta Ads.", "discard"],
  ["Experto certificado en Meta Ads.", "discard"],
  ["Con 10 años de experiencia en campañas.", "question"],
  ["Lideré un equipo de 12 personas.", "question"],
  ["Gestioné un presupuesto de 500 millones.", "question"],
  ["Configuré campañas en Google Ads.", "question"],
  ["Configuré 6 campañas usando Salesforce.", "question"],
  ["Analicé los resultados con Python y SQL.", "question"],
  ["Hice el informe semanal en Power BI.", "question"],
  ["Hice el informe semanal en Looker Studio.", "question"],
  ["Configuré campañas en Meta Ads con HubSpot.", "question"],
  ["Armé reportes en GA4.", "question"],
  ["Configuré 6 campañas en Google Ads y aumenté 40% las ventas.", "question"],
  ["Configuré campañas con Salesforce en Bancolombia.", "discard"],
  ["Gerente de mercadeo con Python.", "discard"],
  ["", "discard"],
  ["Analicé los resultados de las campañas para la gerencia.", "accept"],
  ["Respondí 60 llamadas por turno.", "accept"],
  ["Atendí 60 llamadas por turno (2023).", "accept"],
  ["Configuré campañas en Meta Ads, TikTok Ads y Excel.", "accept"],
  ["Coordinadora de campañas en Meta Ads.", "discard"],
  ["Logré un 95 % de satisfacción en 2024.", "question"]
];

test("RS3-FACT 40 cases: new names, titles and links discard; new figures, dates, tools and results become a question (never applied)", () => {
  assert.equal(CASES.length, 40);
  for (const [after, expected] of CASES) {
    const got = validateProposal({ after, sources: SRC });
    assert.equal(got.verdict, expected, `${after} → ${got.verdict} ${JSON.stringify(got.newClaims)}`);
  }
});

test("RS3-FACT-2 number-free result, scope and leadership claims are never accepted; headlines reuse CV words only", () => {
  const src = ["Configuré 6 campañas pequeñas en Meta Ads y TikTok Ads con presupuesto limitado.", "Comunicadora social con experiencia en redes sociales y eventos."];
  for (const after of [
    "Configuré 6 campañas en Meta Ads, duplicando las ventas.",
    "Lideré las campañas en Meta Ads.",
    "Dirigí las campañas de Meta Ads.",
    "Configuré campañas en Meta Ads para clientes a nivel nacional.",
    "Configuré campañas en Meta Ads para clientes internacionales.",
    "Comunicadora social con amplia experiencia en redes sociales.",
    "Configuré campañas exitosas en Meta Ads.",
    "Configuré campañas en Meta Ads y aumenté las ventas.",
    "Comunicadora social · Marketing digital"
  ]) {
    // Never accepted: a result only the user can confirm is asked, a new name is discarded.
    assert.notEqual(validateProposal({ after, sources: src }).verdict, "accept", after);
  }
  assert.equal(validateProposal({ after: "Comunicadora social · Marketing digital", sources: src }).verdict, "discard");
  assert.equal(validateProposal({ after: "Lideré las campañas en Meta Ads.", sources: src }).verdict, "question");
  // Supported when the source says it.
  assert.equal(validateProposal({ after: "Lideré 6 campañas en Meta Ads.", sources: ["Lideré 6 campañas pequeñas en Meta Ads."] }).verdict, "accept");
  // Headline: every content word must already be in the CV.
  assert.equal(validateProposal({ after: "Comunicadora social · Redes sociales y eventos", sources: src, strictWords: true }).verdict, "accept");
  const strict = validateProposal({ after: "Comunicadora social y analista de pauta digital", sources: src, strictWords: true });
  assert.equal(strict.verdict, "discard");
  assert.ok(strict.newClaims.some((c) => c.kind === "new_word"));
});

test("RS3-FACT unknown supporting fact ids discard the proposal", () => {
  const r = validateProposal({ after: "Configuré 6 campañas en Meta Ads.", sources: SRC, supportingFactIds: ["e1", "inventado"], knownFactIds: ["e1", "b1"] });
  assert.deepEqual(r, { verdict: "discard", newClaims: [], reason: "unknown_fact" });
  assert.deepEqual(newClaims("Configuré 6 campañas.", SRC), []);
});

test("RS3-CARDS queue order is fixed by code; max 5 mappings; AI off drops AI cards", () => {
  const facts = laura();
  const job = analyzeJob({ title: "Analista de Marketing Digital Jr.", description: VACANCY });
  const ev = computeEvidence(job.requirements, facts);
  const queue = buildQueue({ job, evidence: ev, facts, aiEnabled: true });
  // R4d: the «skills» checklist became one «tool» card per missing skill, asked first.
  const tools = queue.filter((c) => c.type === "tool").length;
  assert.ok(tools >= 1);
  assert.deepEqual(queue.slice(tools).map((c) => c.type), ["headline", "requirement_mapping", "requirement_mapping", "requirement_mapping", "requirement_mapping", "summary"]);
  const maps = queue.filter((c) => c.type === "requirement_mapping");
  assert.deepEqual(maps.map((c) => (c.type === "requirement_mapping" ? `${c.n}/${c.m}` : "")), ["1/4", "2/4", "3/4", "4/4"]);
  const off = buildQueue({ job, evidence: ev, facts, aiEnabled: false });
  assert.ok(off.every((c) => !c.needsAi));

  const many = analyzeJob({ title: "x", description: `Requisitos:\n${Array.from({ length: 9 }, (_, i) => `- Requisito número ${i} de prueba`).join("\n")}` });
  const q2 = buildQueue({ job: many, evidence: computeEvidence(many.requirements, facts), facts, aiEnabled: false });
  assert.equal(q2.filter((c) => c.type === "requirement_mapping").length, MAX_MAPPING_CARDS);
});

test("RS3-CARDS skills: only offered ones, one by one (no «añadir todo» from outside); bullets", () => {
  const facts = laura();
  const next = applySkills(facts, ["Meta Ads", "Python", "GA4"], ["Meta Ads", "Looker Studio"]);
  assert.deepEqual(next.skills.map((s) => s.name), ["GA4", "Canva", "Meta Ads"]);
  assert.equal(facts.skills.length, 2, "the base is never modified");
  const withBullet = applyBullet(facts, { experienceId: "e2" }, "Armé un reporte semanal.");
  assert.equal(withBullet.experience[1].bullets[0].text, "Armé un reporte semanal.");
  const elsewhere = applyBullet(facts, { elsewhere: "Proyecto personal" }, "Diseñé un blog.");
  assert.equal(elsewhere.experience.at(-1)?.role, "Proyecto personal");
  assert.equal(elsewhere.experience.at(-1)?.startDate, "", "dates are never invented");
  assert.equal(tidyUserBullet("  configuré campañas  "), "Configuré campañas.");
  assert.ok(resumeFactsSchema.safeParse(elsewhere).success);
});

test("RS3-SCHEMA source is additive: R1 rows (\"user\") and R3 extractions (\"file\") parse", () => {
  const f = laura();
  assert.ok(resumeFactsSchema.safeParse(f).success);
  f.skills[0] = { ...f.skills[0], source: "file", sourceSpan: { start: 0, end: 3 } };
  assert.ok(resumeFactsSchema.safeParse(f).success);
  const bad = structuredClone(f) as any;
  bad.skills[0].source = "model";
  assert.equal(resumeFactsSchema.safeParse(bad).success, false);
});
