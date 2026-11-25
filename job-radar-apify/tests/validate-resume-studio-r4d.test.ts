import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emptyResumeFacts, formatResumeRange, resumeSectionTitles, type ResumeFacts } from "../src/lib/resume-studio.js";
import { applyBullet, buildQueue, confirmSkill, MAX_TOOL_CARDS, missingSkills, requirementGaps, toolAnswer, toolCards } from "../src/lib/resume-tailor/cards.js";
import { asksForYears, evidenceFor, missingNotice, requirementTopic, yearsFit, yearsFromCv } from "../src/lib/resume-tailor/assist.js";
import { actionReducer, IDLE, outcomeFor, SLOW_AFTER_MS, type ActionState } from "../src/lib/resume-tailor/action-state.js";
import { cvLanguage, detectLanguage, languageMismatch } from "../src/lib/resume-tailor/language.js";
import { computeEvidence } from "../src/lib/resume-tailor/evidence.js";
import { acceptModelRequirements, analyzeJob, type JobAnalysis } from "../src/lib/resume-tailor/requirements.js";
import { findSkills, relatedSkills, skillKind, skillQuestion } from "../src/lib/resume-tailor/skills.js";
import { parseResumeAiConfig } from "../src/resume-studio/ai/config.js";
import { createGateway, type Transport } from "../src/resume-studio/ai/gateway.js";
import { MemoryLedger } from "../src/resume-studio/ai/ledger.js";
import { mockTransport } from "../src/resume-studio/ai/mock.js";
import { CARD_CHAT, CARD_DRAFT, CARD_HEADLINE, CARD_REWRITE, CARD_SUMMARY, CV_EXTRACT, EVIDENCE_MAP, JOB_REQUIREMENTS } from "../src/resume-studio/ai/prompts.js";
import { extractCvFacts, proposeCard } from "../src/resume-studio/ai/tailor-service.js";
import { buildResumeDocumentXml } from "../src/resume-studio/docx.js";

// AI Resume Studio R4d — the five P0 changes of the report «Adaptación de CV
// con IA»: missing tools asked one by one, AI buttons that never look dead,
// a plain «what's missing» message, computed figures only in context, and
// one fixed language. Offline: synthetic CVs and vacancies only.

const USER = "a0000000-0000-4000-8000-000000000001";
const ctx = { userId: USER, adaptationId: "b0000000-0000-4000-8000-000000000002" };

// A synthetic vacancy shaped like a QA posting on an English ATS (benefits included).
const JOB_TEXT = [
  "Technical Skills",
  "Experience with API testing (REST), using tools such as Postman or equivalent.",
  "Understanding of distributed systems and backend flows.",
  "Familiarity with test frameworks (Robot Framework, Python, Java) is a strong asset.",
  "Experience with Jenkins, Git, Splunk, or similar monitoring/automation tools.",
  "2+ years of experience in Quality Assurance or Software Testing.",
  "What we can offer you: Work hybrid at our Bogota office."
].join("\n");

function job(): JobAnalysis {
  const base = analyzeJob({ title: "QA Engineer", description: JOB_TEXT });
  const requirements = acceptModelRequirements(JOB_TEXT, [
    { text: "Experience with API testing (REST), using tools such as Postman or equivalent.", kind: "must" },
    { text: "Understanding of distributed systems and backend flows.", kind: "must" },
    { text: "Experience with Jenkins, Git, Splunk, or similar monitoring/automation tools.", kind: "must" },
    { text: "2+ years of experience in Quality Assurance or Software Testing.", kind: "must" },
    { text: "Familiarity with test frameworks (Robot Framework, Python, Java) is a strong asset.", kind: "nice" }
  ]);
  return { ...base, requirements, source: "model" };
}

/** An English CV: QA roles with dates, Playwright and GitHub Actions, no Jenkins/Splunk/Robot Framework. */
function englishCv(): ResumeFacts {
  const f = emptyResumeFacts();
  f.basics.fullName = "Test Person";
  f.basics.headline = "QA Automation Engineer";
  f.summary = "QA engineer with experience in functional and regression testing of web applications and the automation of test suites.";
  f.experience = [
    {
      id: "exp-1",
      source: "file",
      sourceSpan: null,
      role: "QA Automation Engineer",
      company: "Demo Corp",
      city: "",
      startDate: "2021-03",
      endDate: "",
      current: true,
      bullets: [
        { id: "b-1", source: "file", sourceSpan: null, text: "Automated end-to-end regression tests with Playwright and TypeScript for the customer web app." },
        { id: "b-2", source: "file", sourceSpan: null, text: "Ran the test pipeline on GitHub Actions and reported defects in Jira." }
      ]
    },
    {
      id: "exp-2",
      source: "file",
      sourceSpan: null,
      role: "Software Tester",
      company: "Example Ltd",
      city: "",
      startDate: "2019-01",
      endDate: "2021-02",
      current: false,
      bullets: [{ id: "b-3", source: "file", sourceSpan: null, text: "Executed manual test cases for the mobile app and documented the results." }]
    },
    {
      id: "exp-3",
      source: "file",
      sourceSpan: null,
      role: "Sales assistant",
      company: "Shop",
      city: "",
      startDate: "2015-01",
      endDate: "2017-12",
      current: false,
      bullets: [{ id: "b-4", source: "file", sourceSpan: null, text: "Served customers at the store and handled the cash register." }]
    }
  ];
  f.skills = ["Playwright", "TypeScript", "GitHub Actions", "Jira", "Python", "SQL"].map((name, i) => ({ id: `s-${i}`, source: "file" as const, sourceSpan: null, name }));
  return f;
}

// ---------- P0-1: missing tools, one question each ----------------------

test("R4D-VOCAB Splunk and Robot Framework are known; «our Bogota office» is not the Office suite", () => {
  const found = findSkills(JOB_TEXT);
  for (const s of ["Jenkins", "Git", "Splunk", "Robot Framework", "Postman", "Python", "Java"]) assert.ok(found.includes(s), s);
  assert.equal(found.includes("Office"), false, "benefits prose is not a skill");
  assert.ok(findSkills("Manejo de Office y Excel avanzado").includes("Office"));
  assert.ok(findSkills("Microsoft Office").includes("Office"));
  assert.ok(findSkills("Dominio de ofimática").includes("Office"));
  assert.ok(findSkills("Conocimientos en Office 365").includes("Office"));
  assert.equal(findSkills("Reports to the head office in Madrid").includes("Office"), false);
});

test("R4D-QUEUE every missing tool gets its own card, first, in the vacancy's order; nothing from the benefits", () => {
  const j = job();
  const cv = englishCv();
  const queue = buildQueue({ job: j, evidence: computeEvidence(j.requirements, cv), facts: cv, aiEnabled: true });
  const tools = queue.filter((c) => c.type === "tool");
  assert.deepEqual(
    tools.map((c) => (c.type === "tool" ? c.skill : "")),
    ["Postman", "Jenkins", "Git", "Splunk", "Robot Framework", "Java"],
    "must requirements first, then nice; Python is already in the CV"
  );
  // The tool cards come BEFORE any card that writes.
  assert.ok(queue.findIndex((c) => c.type !== "tool") === tools.length, queue.map((c) => c.type).join(","));
  assert.equal(queue[tools.length].type, "headline");
  assert.equal(tools.length <= MAX_TOOL_CARDS, true);
  const jenkins = tools.find((c) => c.type === "tool" && c.skill === "Jenkins");
  assert.ok(jenkins && jenkins.type === "tool");
  assert.equal(jenkins.question, "¿Has usado Jenkins?");
  assert.equal(jenkins.kind, "tool");
  assert.match(jenkins.requirement ?? "", /Jenkins, Git, Splunk/);
  assert.deepEqual(jenkins.related, ["GitHub Actions"], "«Algo parecido» only offers tools the CV shows");
  assert.deepEqual(jenkins.options.map((o) => o.experienceId), ["exp-1", "exp-2", "exp-3"]);
  assert.equal(`${jenkins.n}/${jenkins.m}`, `2/${tools.length}`);
  assert.equal(tools.some((c) => c.type === "tool" && c.skill === "Office"), false);
  // AI off: still asked (no model needed).
  const off = buildQueue({ job: j, evidence: computeEvidence(j.requirements, cv), facts: cv, aiEnabled: false });
  assert.equal(off.filter((c) => c.type === "tool").length, tools.length);
  // Without requirements, the whole vacancy's skills (rule-based fallback).
  const bare = { ...j, requirements: [] };
  assert.ok(toolCards(bare, cv).some((c) => c.skill === "Jenkins"));
  // A confirmed tool is no longer missing.
  assert.equal(missingSkills(j, confirmSkill(cv, "Jenkins")).missing.includes("Jenkins"), false);
});

test("R4D-TOOL-ANSWER «Sí» writes only what the user confirmed; «No» writes nothing; the question fits the kind", () => {
  const cv = englishCv();
  const once = confirmSkill(confirmSkill(cv, "Jenkins"), "Jenkins");
  assert.equal(once.skills.filter((s) => s.name === "Jenkins").length, 1);
  assert.equal(once.skills.at(-1)?.source, "user", "told by the user, not from the file");
  assert.deepEqual(cv.skills.map((s) => s.name).includes("Jenkins"), false, "the base is never touched");
  assert.equal(toolAnswer("Jenkins", "ran the nightly regression jobs"), "Jenkins: ran the nightly regression jobs");
  assert.equal(toolAnswer("Jenkins", "Configured Jenkins jobs for the API suite"), "Configured Jenkins jobs for the API suite");
  assert.equal(skillQuestion("Jenkins"), "¿Has usado Jenkins?");
  assert.equal(skillQuestion("Inglés"), "¿Hablas inglés?");
  assert.equal(skillQuestion("Servicio al cliente"), "¿Tienes experiencia en servicio al cliente?");
  assert.equal(skillKind("Splunk"), "tool");
  assert.equal(skillKind("Siigo"), "tool");
  assert.equal(skillKind("Nómina"), "area");
  assert.deepEqual(relatedSkills("Splunk", ["Grafana", "Kibana", "Excel"]), ["Kibana", "Grafana"]);
  assert.deepEqual(relatedSkills("Splunk", ["Excel"]), []);
});

test("R4D-GAPS a mapping card says which tools of its requirement the CV doesn't show", () => {
  const cv = englishCv();
  const req = "Experience with Jenkins, Git, Splunk, or similar monitoring/automation tools.";
  assert.deepEqual(requirementGaps(req, cv), ["Jenkins", "Git", "Splunk"]);
  assert.deepEqual(requirementGaps(req, confirmSkill(cv, "Jenkins")), ["Git", "Splunk"]);
  assert.deepEqual(requirementGaps("Experience with Playwright", cv), []);
});

// ---------- P0-2: AI buttons never look dead ----------------------------

test("R4D-BUSY click → working at once; 10 s → slow + Cancelar; the answer replaces the button", () => {
  let s: ActionState = IDLE;
  s = actionReducer(s, { type: "start", action: "redraft", at: 1000 });
  assert.equal(s.kind, "working");
  assert.equal(s.kind === "working" && s.slow, false);
  // A second click while working is ignored (one call per card).
  assert.equal(actionReducer(s, { type: "start", action: "years", at: 1500 }), s);
  assert.equal(actionReducer(s, { type: "tick", at: 1000 + SLOW_AFTER_MS - 1 }), s, "not slow before 10 s");
  const slow = actionReducer(s, { type: "tick", at: 1000 + SLOW_AFTER_MS });
  assert.ok(slow.kind === "working" && slow.slow);
  assert.equal(SLOW_AFTER_MS, 10_000);
  const cancelled = actionReducer(slow, { type: "cancel" });
  assert.ok(cancelled.kind === "result" && cancelled.action === "redraft" && cancelled.next.includes("retry"));
  // A late answer after Cancelar changes nothing.
  assert.equal(actionReducer(cancelled, { type: "done", outcome: null }), cancelled);
  // A proposal clears the slot (the card shows the new before/after).
  assert.deepEqual(actionReducer(s, { type: "done", outcome: null }), IDLE);
  // «No evidence» comes back as a result in the button's place, with next steps.
  const r = actionReducer(s, { type: "done", outcome: outcomeFor({ status: "question", claims: [], question: "" }, "Understanding of distributed systems.") });
  assert.ok(r.kind === "result" && r.action === "redraft");
  assert.deepEqual(r.kind === "result" && r.next, ["back", "tell", "skip"]);
});

test("R4D-UI-SOURCE every AI button goes through the in-place slot; no grey footer reply, no window.confirm", () => {
  const src = readFileSync(new URL("../src/components/resume/TailorAgent.tsx", import.meta.url), "utf8");
  assert.equal(src.includes("window.confirm"), false);
  assert.equal(src.includes("Sin evidencia en tu CV"), false, "old message replaced");
  assert.equal(/setReply\(/.test(src), false, "no more grey reply line");
  const calls = [...src.matchAll(/void runAi\(\s*"([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ["chat", "improve", "redraft", "years", "years-add"]);
  for (const id of calls) assert.match(src, new RegExp(`slot\\(\\s*"${id}",\\s*"[^"]+…"`), `${id} shows a working label in its own slot`);
});

// ---------- P0-3: what's missing, why, what to do ------------------------

test("R4D-NOTICE says what is missing, that we don't invent it, and asks a question with actions", () => {
  const tool = outcomeFor({ status: "question", claims: [{ kind: "skill", value: "Jenkins" }], question: "La propuesta incluía «Jenkins»…" }, "Experience with Jenkins");
  assert.ok(tool);
  assert.equal(tool.text, "Tu hoja de vida no menciona «Jenkins», así que no lo escribimos por ti. ¿Trabajaste con eso en algún empleo?");
  assert.deepEqual(tool.next, ["back", "tell", "skip"]);
  const topic = outcomeFor({ status: "question", claims: [], question: "" }, "Understanding of distributed systems and backend flows. (obligatorio)");
  assert.match(topic?.text ?? "", /no menciona «distributed systems and backend flows»/);
  const figure = missingNotice({ claims: [{ kind: "number", value: "40%" }], requirement: "x" });
  assert.equal(figure.missing, "40%");
  assert.match(figure.ask, /dato real/);
  // The model's own (already sanitized) question is used when nothing specific was flagged.
  assert.equal(missingNotice({ claims: [], requirement: "Shopping flows", question: "¿Trabajaste con flujos de reserva?" }).ask, "¿Trabajaste con flujos de reserva?");
  assert.equal(requirementTopic("Experiencia en atención al cliente."), "atención al cliente");
  assert.equal(outcomeFor({ status: "proposal" }, "x"), null);
  assert.equal(outcomeFor({ status: "error", error: "El proveedor de IA no respondió." }, "x")?.tone, "error");
  for (const o of [tool, topic]) assert.equal(/error|sin evidencia/i.test(`${o?.title} ${o?.text}`), false, "neutral, never «error»");
});

test("R4D-PROVENANCE only facts the proposal CITED are backing; overlap is a guess", () => {
  const cv = englishCv();
  const cited = evidenceFor(cv, "Automated regression tests with Playwright.", ["b-1"]);
  assert.deepEqual(cited.map((e) => [e.factId, e.cited]), [["b-1", true]]);
  const guessed = evidenceFor(cv, "Automated regression tests with Playwright.", []);
  assert.ok(guessed.length > 0 && guessed.every((e) => e.cited === false));
});

// ---------- P0-4: computed figures only when they answer the card --------

test("R4D-YEARS «~X años» only for a years question that the CV's dates answer", () => {
  const cv = englishCv();
  assert.equal(asksForYears("Understanding of distributed systems and backend flows."), false);
  assert.equal(asksForYears("¿Tienes experiencia con sistemas distribuidos?"), false, "«experiencia» alone is not «years»");
  assert.equal(asksForYears("2+ years of experience in Quality Assurance or Software Testing."), true);
  assert.equal(asksForYears("Mínimo 3 años de experiencia en ventas"), true);
  assert.equal(asksForYears("¿Cuántos años de experiencia tienes?"), true);
  const qa = yearsFromCv(cv, "2+ years of experience in Quality Assurance or Software Testing.", new Date("2026-11-01T00:00:00Z"));
  assert.ok(qa && qa.focused, "QA roles answer «Quality Assurance»");
  assert.equal(qa.count, 2, "the sales job doesn't count");
  assert.equal(yearsFit({ requirement: "2+ years of experience in Quality Assurance or Software Testing.", question: "", allowQuestion: false, focused: true }), true);
  // Distributed systems: hidden even if the model asks about years in it.
  assert.equal(yearsFit({ requirement: "Understanding of distributed systems and backend flows.", question: "", allowQuestion: false, focused: false }), false);
  assert.equal(yearsFit({ requirement: "Understanding of distributed systems.", question: "¿Cuántos años con sistemas distribuidos?", allowQuestion: false, focused: false }), false);
  // A domain the figure wasn't computed for: hidden.
  assert.equal(yearsFit({ requirement: "3+ years of experience with Kubernetes", question: "", allowQuestion: false, focused: false }), false);
  // Profile cards: a plain «how many years» question is answered by the total.
  assert.equal(yearsFit({ requirement: "Perfil para «QA Engineer»", question: "¿Cuántos años de experiencia tienes?", allowQuestion: true, focused: false }), true);
  assert.equal(yearsFit({ requirement: "Perfil para «QA Engineer»", question: "¿Cuántos años de experiencia tienes?", allowQuestion: false, focused: false }), false);
});

// ---------- P0-5: one language, fixed by code ----------------------------

test("R4D-LANG detector: English/Spanish prose; tools and short headlines don't decide", () => {
  assert.equal(detectLanguage("Performed functional testing of the REST APIs using Postman and analyzed the logs of the backend services."), "en");
  assert.equal(detectLanguage("Realicé pruebas funcionales de las APIs REST con Postman y analicé los registros de los servicios."), "es");
  assert.equal(detectLanguage("QA Engineer · Test Automation"), null);
  assert.equal(detectLanguage("Jenkins, Git, Splunk, Robot Framework, Python"), null);
  assert.equal(detectLanguage(""), null);
  assert.equal(cvLanguage(englishCv()), "en");
  const es = emptyResumeFacts();
  es.summary = "Analista de calidad con experiencia en pruebas funcionales y de regresión de aplicaciones web y móviles, y en la documentación de los casos.";
  assert.equal(cvLanguage(es), "es");
  assert.equal(languageMismatch("Diseñé y ejecuté los casos de prueba de la aplicación móvil para los clientes.", "en"), true);
  assert.equal(languageMismatch("Designed and executed the test cases of the mobile app for the customers.", "en"), false);
  assert.equal(languageMismatch("QA Automation Engineer", "es"), false, "unknown never blocks");
  assert.equal(languageMismatch("anything at all in any language", null), false);
});

test("R4D-PROMPTS the five writing prompts carry the CV's language from code and were bumped; the others are untouched", () => {
  assert.deepEqual(
    [CARD_HEADLINE, CARD_REWRITE, CARD_DRAFT, CARD_SUMMARY, CARD_CHAT].map((p) => `${p.id}@${p.version}`),
    ["card_headline@3", "card_rewrite@3", "card_draft@3", "card_summary@5", "card_chat@4"]
  );
  assert.deepEqual([CV_EXTRACT, JOB_REQUIREMENTS, EVIDENCE_MAP].map((p) => `${p.id}@${p.version}`), ["cv_extract@3", "job_requirements@2", "evidence_map@2"]);
  const facts = [{ factId: "b1", section: "bullet" as const, text: "Automated regression tests with Playwright." }];
  const en = CARD_DRAFT.render({ requirement: "Experience with Jenkins", experience: facts, language: { lang: "en" } });
  assert.match(en.system, /IDIOMA OBLIGATORIO: el campo "text" va SIEMPRE en INGLÉS \(English\), el idioma de la hoja de vida/);
  assert.equal(en.system.includes("Escribes en español neutro"), false, "the old Spanish-only rule is gone from writing prompts");
  assert.match(en.system, /"why", "question" y "reply" van en español/);
  assert.equal(en.system.includes("tu respuesta anterior salió en otro idioma"), false);
  assert.match(CARD_DRAFT.render({ requirement: "x", experience: facts, language: { lang: "en", retry: true } }).system, /tu respuesta anterior salió en otro idioma/);
  assert.match(CARD_SUMMARY.render({ jobTitle: "x", tasks: [], facts, language: { lang: "es" } }).system, /SIEMPRE en ESPAÑOL/);
  assert.match(CARD_CHAT.render({ cardType: "rewrite", current: "x", instruction: "y", facts, language: { lang: null } }).system, /SIEMPRE en el MISMO idioma de los hechos del CV/);
  // The language never travels inside a fenced data block.
  assert.equal(/<<<[A-Z_]+>>>[^]*INGLÉS[^]*<<<FIN_/.test(en.user), false);
  // Non-writing prompts keep their rules (and version).
  assert.match(CV_EXTRACT.render({ cvText: "x".repeat(50) }).system, /Escribes en español neutro/);
});

function gatewayWith(transport: Transport, ledger = new MemoryLedger()) {
  const config = parseResumeAiConfig({ RESUME_AI_PROVIDER: "mock" });
  return { gateway: createGateway({ config, ledger, transport }), ledger };
}
const answer = (text: string, supportingFactIds: string[] = []) => ({
  content: JSON.stringify({ text, supportingFactIds, why: "Muestra el requisito.", question: "", reply: "" }),
  usage: { promptTokens: 100, completionTokens: 30, cachedTokens: 0 },
  finishReason: "stop"
});

test("R4D-LANG-RETRY a bullet in the wrong language is retried once (own purpose, not a chat turn) and never applied", async () => {
  const cv = englishCv();
  const systems: string[] = [];
  const { gateway, ledger } = gatewayWith(async (req) => {
    systems.push(req.system);
    return systems.length === 1
      ? answer("Automaticé pruebas de regresión con Playwright y TypeScript para la aplicación web de los clientes.", ["b-1"])
      : answer("Automated end-to-end regression tests with Playwright and TypeScript for the customer web app.", ["b-1"]);
  });
  const r = await proposeCard(gateway, ctx, { card: "draft", requirement: "Experience with test automation", facts: cv, experienceId: "exp-1" });
  assert.equal(r.status, "proposal");
  assert.ok(r.status === "proposal" && detectLanguage(r.text) === "en");
  assert.equal(systems.length, 2);
  assert.match(systems[1], /tu respuesta anterior salió en otro idioma/);
  assert.deepEqual(ledger.rows.filter((x) => x.status !== "start").map((x) => x.purpose), ["card_draft", "card_draft_lang"]);

  // Still Spanish after the retry → discarded, nothing to apply.
  const stubborn = gatewayWith(async () => answer("Automaticé pruebas de regresión con Playwright y TypeScript para la aplicación web de los clientes.", ["b-1"]));
  const bad = await proposeCard(stubborn.gateway, ctx, { card: "draft", requirement: "Experience with test automation", facts: cv, experienceId: "exp-1" });
  assert.deepEqual(bad, { status: "discarded", claims: [], reason: "language", language: "en" });

  // Chat: the retry doesn't use up the user's chat turns.
  const chat = gatewayWith(async (req) =>
    /anterior salió/.test(req.system)
      ? answer("Automated regression tests with Playwright for the customer web app.", ["b-1"])
      : answer("Automaticé pruebas de regresión con Playwright para la aplicación web de los clientes.", ["b-1"])
  );
  const c = await proposeCard(chat.gateway, ctx, { card: "chat", cardType: "rewrite", current: "x", instruction: "más corto", facts: cv, experienceId: "exp-1", answer: "" });
  assert.equal(c.status, "proposal");
  assert.equal(chat.ledger.rows.filter((x) => x.purpose === "card_chat").length, 1);

  // AI off: the user's own words in the other language aren't put in as they are.
  const off = createGateway({ config: parseResumeAiConfig({ RESUME_AI_PROVIDER: "none" }), ledger: new MemoryLedger(), transport: async () => answer("") });
  const own = await proposeCard(off, ctx, { card: "rewrite", requirement: "x", facts: cv, experienceId: "exp-1", answer: "Configuré los trabajos de Jenkins para la suite de pruebas de la API del equipo." });
  assert.equal(own.status, "discarded");
});

test("R4D-LANG-EXTRACT /extract returns the CV's language, decided by code", async () => {
  const cvText = [
    "[NOMBRE]",
    "QA Automation Engineer",
    "PROFILE",
    "QA engineer with experience in functional and regression testing of web applications",
    "and the automation of the test suites for the delivery teams.",
    "EXPERIENCE",
    "QA Engineer | Demo Corp | Bogotá | 2021-03 – actual",
    "- Automated the regression tests of the web app with Playwright and TypeScript.",
    "SKILLS",
    "Playwright, TypeScript, Jira"
  ].join("\n");
  const { gateway } = gatewayWith(mockTransport({ fabricationRate: 0, invalidJsonRate: 0 }));
  const out = await extractCvFacts(gateway, { ...ctx, purpose: "cv_extract" }, cvText);
  assert.ok(out.ok);
  assert.equal(out.ok && out.result.language, "en");
});

test("R4D-TEMPLATE an English CV gets English headings and dates (preview and DOCX); Spanish stays Spanish", () => {
  assert.equal(formatResumeRange("2021-03", "", true, "en"), "Mar 2021 – Present");
  assert.equal(formatResumeRange("2021-03", "", true), "mar. 2021 – actual");
  assert.equal(resumeSectionTitles("en").experience, "Experience");
  assert.equal(resumeSectionTitles(null).experience, "Experiencia");
  const xml = buildResumeDocumentXml(englishCv(), "clasica");
  assert.ok(xml.includes("EXPERIENCE") && xml.includes("SKILLS") && !xml.includes("EXPERIENCIA"));
  assert.ok(xml.includes("Mar 2021 – Present"));
  const es = emptyResumeFacts();
  es.summary = "Analista de calidad con experiencia en pruebas funcionales y de regresión de aplicaciones web y móviles, y en la documentación de los casos.";
  assert.ok(buildResumeDocumentXml(es, "clasica").includes("PERFIL"));
  // A new experience entry without a name is labeled in the CV's language.
  const next = applyBullet(englishCv(), { elsewhere: "" }, "Built a small test harness with Pytest.");
  assert.equal(next.experience.at(-1)?.role, "Other experience");
});
