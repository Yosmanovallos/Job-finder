import { emptyResumeFacts, newFactId, resumeFactsSchema, type ResumeFacts } from "../../lib/resume-studio.js";
import { buildQueue, tidyUserBullet, type Card } from "../../lib/resume-tailor/cards.js";
import { computeEvidence, factTexts, verifyCitations, type Citation, type FactText, type RequirementEvidence } from "../../lib/resume-tailor/evidence.js";
import { newClaims, validateProposal, type Claim } from "../../lib/resume-tailor/factuality.js";
import { acceptModelRequirements, analyzeJob, type JobAnalysis } from "../../lib/resume-tailor/requirements.js";
import { compatibilityScore, qualityScore } from "../../lib/resume-tailor/score.js";
import { findQuote, sliceBetween } from "../../lib/resume-tailor/text.js";
import { MAX_CHAT_TURNS } from "../../lib/resume-tailor/cards.js";
import type { CallContext, GatewayFailure, ResumeAiGateway } from "./gateway.js";
import { CARD_CHAT, CARD_DRAFT, CARD_HEADLINE, CARD_REWRITE, CARD_SUMMARY, CV_EXTRACT, EVIDENCE_MAP, JOB_REQUIREMENTS } from "./prompts.js";
import { minimizeCvText } from "./sensitive.js";

// AI Resume Studio R3 — the state machine's server steps (doc 11 §5.2):
// S1 requirements → S2 evidence → S3 score → S4 queue at start, then one
// call per card (S5) with the factuality validator on every proposal. The
// adaptation itself lives in the browser; this module is stateless.

const MONTH = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;
const month = (v: string) => (MONTH.test(v) ? v : "");

// R4c: CVs write «Jan 2023», «enero de 2023», «01/2023» — almost never
// «2023-01». A model date «AAAA-MM» is kept only if the CV shows that same
// year with that same month (name, abbreviation or number) next to it;
// otherwise it stays empty (never guessed). This is what lets «~X años»
// be computed from the CV's own dates.
const MONTH_NAMES: string[][] = [
  ["enero", "ene", "january", "jan"],
  ["febrero", "feb", "february"],
  ["marzo", "mar", "march"],
  ["abril", "abr", "april", "apr"],
  ["mayo", "may"],
  ["junio", "jun", "june"],
  ["julio", "jul", "july"],
  ["agosto", "ago", "august", "aug"],
  ["septiembre", "setiembre", "sep", "sept", "september"],
  ["octubre", "oct", "october"],
  ["noviembre", "nov", "november"],
  ["diciembre", "dic", "december", "dec"]
];
export function sourcedMonth(original: string, value: string): string {
  if (!MONTH.test(value)) return "";
  if (original.includes(value)) return value;
  const [year, mm] = value.split("-");
  const m = Number(mm);
  const text = original.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const names = MONTH_NAMES[m - 1].join("|");
  const nums = `0?${m}`;
  const patterns = [
    new RegExp(`\\b(${names})\\.?\\s*(de\\s+|del\\s+|,\\s*)?${year}\\b`),
    new RegExp(`\\b${nums}\\s*[/.-]\\s*${year}\\b`),
    new RegExp(`\\b${year}\\s*[/.-]\\s*${nums}\\b`)
  ];
  return patterns.some((re) => re.test(text)) ? value : "";
}

// ---------- CV extraction (doc 05 §2) ----------------------------------

export interface ExtractResult {
  facts: ResumeFacts;
  /** Fields whose quote wasn't found in the CV: dropped and asked to the user. */
  dropped: string[];
  /** Sensitive data found and left out (T-SENS). */
  removed: string[];
}

export async function extractCvFacts(gateway: ResumeAiGateway, ctx: CallContext, original: string): Promise<{ ok: true; result: ExtractResult } | { ok: false; code: GatewayFailure }> {
  const minimized = minimizeCvText(original);
  const call = await gateway.complete(CV_EXTRACT, { cvText: minimized.text }, ctx);
  if (!call.ok) return call;
  const out = call.data;
  const dropped: string[] = [];
  const facts = emptyResumeFacts();
  facts.basics.fullName = (minimized.name ?? "").slice(0, 80);
  facts.basics.email = minimized.emails[0]?.slice(0, 120) ?? "";
  facts.basics.phone = (minimized.phones[0] ?? "").replace(/[^0-9+()\-\s]/g, "").slice(0, 30);
  facts.basics.links = minimized.links.filter((l) => l.length <= 200).slice(0, 5);

  // cv_extract@3: every kept value is a fragment of the ORIGINAL text. Short
  // fields must be in it as they are (ignoring case, accents and spaces);
  // long texts are COPIED from it between two anchors, so the model can
  // locate text but never write it (doc 05 §2 step 3).
  const literal = (value: string) => {
    const s = value ? findQuote(original, value) : null;
    return s ? { text: original.slice(s.start, s.end).replace(/\s+/g, " ").trim(), span: s } : null;
  };
  const sliced = (label: string, anchors: { start: string; end: string }, maxChars: number) => {
    const r = sliceBetween(original, anchors.start, anchors.end, maxChars);
    if (!r) dropped.push(label);
    return r;
  };
  // A heading-like field (role, degree…) that isn't in the CV is reported, never kept.
  const short = (label: string, value: string) => {
    const v = literal(value);
    if (!v && value) dropped.push(label);
    return v;
  };

  if (out.headline) {
    const v = short("Título del perfil", out.headline.text);
    if (v) facts.basics.headline = v.text.slice(0, 120);
  }
  if (out.summary) {
    const v = sliced("Perfil", out.summary, 1200);
    if (v) facts.summary = v.text;
  }
  for (const e of out.experience) {
    const role = literal(e.role);
    const company = literal(e.company);
    const head = role ?? company;
    if (!head) {
      if (e.role || e.company) dropped.push(`Experiencia «${e.role || e.company}»`);
      continue;
    }
    const bullets = e.bullets
      .map((b) => {
        const bv = sliced(`Viñeta de «${role?.text ?? company?.text}»`, b, 300);
        return bv ? { id: newFactId("b"), source: "file" as const, sourceSpan: bv.span, text: bv.text } : null;
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
    facts.experience.push({
      id: newFactId("exp"),
      source: "file",
      sourceSpan: head.span,
      role: (role?.text ?? "").slice(0, 120),
      company: (company?.text ?? "").slice(0, 120),
      city: (literal(e.city)?.text ?? "").slice(0, 80),
      // Dates must be literally in the CV; unreadable → empty, asked later.
      startDate: sourcedMonth(original, e.startDate),
      endDate: sourcedMonth(original, e.endDate),
      current: e.current,
      bullets: bullets.slice(0, 8)
    });
    if (facts.experience.length >= 15) break;
  }
  for (const ed of out.education) {
    const degree = short(`Formación «${ed.degree}»`, ed.degree);
    const institution = literal(ed.institution);
    const head = degree ?? institution;
    if (!head) continue;
    facts.education.push({
      id: newFactId("edu"),
      source: "file",
      sourceSpan: head.span,
      degree: (degree?.text ?? institution?.text ?? "").slice(0, 120),
      institution: degree ? (institution?.text ?? "").slice(0, 120) : "",
      city: "",
      startDate: sourcedMonth(original, ed.startDate),
      endDate: sourcedMonth(original, ed.endDate)
    });
    if (facts.education.length >= 10) break;
  }
  for (const c of out.certifications) {
    const v = short(`Certificación «${c.name}»`, c.name);
    if (v) facts.certifications.push({ id: newFactId("cert"), source: "file", sourceSpan: v.span, name: v.text.slice(0, 120), issuer: (literal(c.issuer)?.text ?? "").slice(0, 120), date: sourcedMonth(original, c.date) });
    if (facts.certifications.length >= 15) break;
  }
  const seenSkills = new Set<string>();
  for (const s of out.skills) {
    const v = short(`Habilidad «${s}»`, s);
    if (v && !seenSkills.has(v.text.toLowerCase())) {
      seenSkills.add(v.text.toLowerCase());
      facts.skills.push({ id: newFactId("skill"), source: "file", sourceSpan: v.span, name: v.text.slice(0, 60) });
    }
    if (facts.skills.length >= 40) break;
  }
  for (const l of out.languages) {
    const v = short(`Idioma «${l.name}»`, l.name);
    if (v) facts.languages.push({ id: newFactId("lang"), source: "file", sourceSpan: v.span, name: v.text.slice(0, 40), level: (literal(l.level)?.text ?? "").slice(0, 40) });
    if (facts.languages.length >= 8) break;
  }
  const parsed = resumeFactsSchema.safeParse(facts);
  return { ok: true, result: { facts: parsed.success ? parsed.data : emptyResumeFacts(), dropped: dropped.slice(0, 30), removed: minimized.removed } };
}

// ---------- start: S1–S4 --------------------------------------------------

export interface TailorStart {
  job: JobAnalysis;
  citations: Record<string, Citation[]>;
  evidence: RequirementEvidence[];
  queue: Card[];
  scores: { compatibility: ReturnType<typeof compatibilityScore>; quality: ReturnType<typeof qualityScore> };
  aiAvailable: boolean;
  /** Why the AI isn't helping (off, budget), if so. */
  aiNotice: GatewayFailure | null;
}

export async function startTailor(gateway: ResumeAiGateway, ctx: Omit<CallContext, "purpose">, input: { facts: ResumeFacts; title: string; description: string }): Promise<TailorStart> {
  let job = analyzeJob({ title: input.title, description: input.description });
  let aiNotice: GatewayFailure | null = gateway.enabled ? null : "ai_off";

  if (!job.requirements.length && gateway.enabled) {
    const r = await gateway.complete(JOB_REQUIREMENTS, { title: input.title, description: input.description }, { ...ctx, purpose: "job_requirements" });
    if (r.ok) {
      const accepted = acceptModelRequirements(input.description, r.data.requirements);
      if (accepted.length) job = { ...job, requirements: accepted, source: "model" };
    } else aiNotice = r.code;
  }

  const citations: Record<string, Citation[]> = {};
  if (job.requirements.length && gateway.enabled && aiNotice === null) {
    const r = await gateway.complete(
      EVIDENCE_MAP,
      { requirements: job.requirements.map((q) => ({ id: q.id, text: q.text })), facts: citableFacts(input.facts) },
      { ...ctx, purpose: "evidence_map" }
    );
    if (r.ok) {
      const known = new Set(job.requirements.map((q) => q.id));
      for (const item of r.data.items) {
        if (!known.has(item.requirementId)) continue;
        const ok = verifyCitations(input.facts, item.citations);
        if (ok.length) citations[item.requirementId] = ok;
      }
    } else aiNotice = r.code;
  }

  const evidence = computeEvidence(job.requirements, input.facts, citations);
  const aiAvailable = gateway.enabled && (aiNotice === null || aiNotice === "invalid_output" || aiNotice === "provider_error");
  return {
    job,
    citations,
    evidence,
    queue: buildQueue({ job, evidence, facts: input.facts, aiEnabled: aiAvailable }),
    scores: { compatibility: compatibilityScore(job, evidence, input.facts), quality: qualityScore(input.facts) },
    aiAvailable,
    aiNotice
  };
}

/** What the model may see about the CV: no contact, no headline/summary duplication issues. */
export function citableFacts(facts: ResumeFacts): FactText[] {
  return factTexts(facts);
}

// ---------- S5: one card -------------------------------------------------

export type CardRequest =
  | { card: "headline"; jobTitle: string; facts: ResumeFacts }
  | { card: "summary"; jobTitle: string; tasks: string[]; facts: ResumeFacts }
  | { card: "rewrite"; requirement: string; facts: ResumeFacts; experienceId: string | null; answer: string }
  // R4c «Que la IA lo redacte»: no answer; only that experience's facts.
  | { card: "draft"; requirement: string; facts: ResumeFacts; experienceId: string }
  | { card: "chat"; cardType: "headline" | "summary" | "rewrite"; current: string; instruction: string; facts: ResumeFacts; experienceId: string | null; answer: string };

export type CardResult =
  | { status: "proposal"; text: string; why: string; supportingFactIds: string[]; byAi: boolean; reply?: string; ask?: string }
  | { status: "question"; claims: Claim[]; question: string; discardedText: string }
  | { status: "discarded"; claims: Claim[]; reason: "new_data" | "unknown_fact" | "empty" }
  | { status: "unavailable"; code: GatewayFailure };

/** The texts a card may draw from (doc 05 §5): cited facts and the user's own answer. */
export function cardSources(request: CardRequest): { sources: string[]; knownFactIds: string[] } {
  const all = factTexts(request.facts);
  const knownFactIds = all.map((f) => f.factId);
  if (request.card === "rewrite" || request.card === "draft" || (request.card === "chat" && request.cardType === "rewrite")) {
    const scoped = request.experienceId ? all.filter((f) => f.factId === request.experienceId || f.parentId === request.experienceId) : [];
    const answer = request.card === "draft" ? [] : [request.answer];
    return { sources: [...answer, ...scoped.map((f) => f.text)], knownFactIds };
  }
  // R4c: a chat on the headline/summary may use a fact the USER confirmed
  // (e.g. «~4 años», computed from the CV's dates and approved by them).
  const confirmed = request.card === "chat" && request.answer.trim() ? [request.answer] : [];
  return { sources: [...confirmed, ...all.map((f) => f.text)], knownFactIds };
}

function judge(text: string, why: string, supportingFactIds: string[], request: CardRequest, byAi: boolean, reply?: string, modelQuestion = ""): CardResult {
  const { sources, knownFactIds } = cardSources(request);
  // The model's own question is shown as a question, never applied. A question
  // with a link/HTML or other new data is replaced by a neutral one.
  // R4c: a question that leaks the prompt's own words («hechos», «instrucción»,
  // «[experience]», JSON…) is replaced by a plain one for the person.
  const internal = /\b(hechos?|instrucci[oó]n(es)?|prompt|json|formato|supportingFactIds)\b|\[[a-z_]+\]/i;
  const ask =
    modelQuestion && newClaims(modelQuestion, []).every((c) => c.kind !== "link")
      ? internal.test(modelQuestion)
        ? "Falta un dato que tu hoja de vida no dice. Puedes redactarlo solo con tu CV, escribirlo tú o dejar esto como está."
        : modelQuestion
      : "";
  if (!text.trim()) {
    return { status: "question", claims: [], question: ask || "Falta un dato para esta tarjeta. Escríbelo con tus palabras o sáltala.", discardedText: "" };
  }
  const headline = request.card === "headline" || (request.card === "chat" && request.cardType === "headline");
  const verdict = validateProposal({ after: text, sources, supportingFactIds, knownFactIds, strictWords: headline });
  if (verdict.verdict === "accept") return { status: "proposal", text, why, supportingFactIds, byAi, ...(reply ? { reply } : {}), ...(ask ? { ask } : {}) };
  if (verdict.verdict === "question") {
    const names = verdict.newClaims.map((c) => `«${c.value}»`);
    return {
      status: "question",
      claims: verdict.newClaims,
      question:
        `La propuesta incluía ${names.join(", ")}, que no está en tu hoja de vida ni en lo que nos contaste. ` +
        `Si es real, escríbelo tú con tus palabras (Editar); si no, omite esta tarjeta.${ask ? ` ${ask}` : ""}`,
      discardedText: text
    };
  }
  return { status: "discarded", claims: verdict.newClaims, reason: verdict.reason === "ok" ? "new_data" : verdict.reason };
}

export async function proposeCard(gateway: ResumeAiGateway, ctx: Omit<CallContext, "purpose" | "maxTurns">, request: CardRequest): Promise<CardResult> {
  if (request.card === "draft") {
    if (!gateway.enabled) return { status: "unavailable", code: "ai_off" };
    const experience = factTexts(request.facts).filter((f) => f.factId === request.experienceId || f.parentId === request.experienceId);
    // An experience with nothing written under it can't support a draft: ask, don't call.
    if (experience.length < 2) {
      return { status: "question", claims: [], question: "Esa experiencia no tiene viñetas en tu hoja de vida. Cuéntanos con tus palabras qué hiciste ahí.", discardedText: "" };
    }
    const r = await gateway.complete(CARD_DRAFT, { requirement: request.requirement, experience }, { ...ctx, purpose: "card_draft" });
    if (!r.ok) return { status: "unavailable", code: r.code };
    return judge(r.data.text, r.data.why, r.data.supportingFactIds, request, true, undefined, r.data.question);
  }
  if (request.card === "rewrite") {
    if (!gateway.enabled) {
      // AI off: the user's own words, tidied mechanically (still validated).
      return judge(tidyUserBullet(request.answer), "Tus palabras, con mayúscula inicial y punto final.", [], request, false);
    }
    const experience = request.experienceId ? factTexts(request.facts).filter((f) => f.factId === request.experienceId || f.parentId === request.experienceId) : [];
    const r = await gateway.complete(CARD_REWRITE, { requirement: request.requirement, experience, answer: request.answer }, { ...ctx, purpose: "card_rewrite" });
    if (!r.ok) return { status: "unavailable", code: r.code };
    return judge(r.data.text, r.data.why, r.data.supportingFactIds, request, true, undefined, r.data.question);
  }
  if (!gateway.enabled) return { status: "unavailable", code: "ai_off" };
  if (request.card === "headline") {
    const r = await gateway.complete(CARD_HEADLINE, { jobTitle: request.jobTitle, facts: citableFacts(request.facts) }, { ...ctx, purpose: "card_headline" });
    if (!r.ok) return { status: "unavailable", code: r.code };
    return judge(r.data.text, r.data.why, r.data.supportingFactIds, request, true, undefined, r.data.question);
  }
  if (request.card === "summary") {
    const r = await gateway.complete(CARD_SUMMARY, { jobTitle: request.jobTitle, tasks: request.tasks, facts: citableFacts(request.facts) }, { ...ctx, purpose: "card_summary" });
    if (!r.ok) return { status: "unavailable", code: r.code };
    return judge(r.data.text, r.data.why, r.data.supportingFactIds, request, true, undefined, r.data.question);
  }
  const { sources } = cardSources(request);
  const r = await gateway.complete(
    CARD_CHAT,
    { cardType: request.cardType, current: request.current, instruction: request.instruction, facts: citableFacts(request.facts).filter((f) => sources.includes(f.text)) },
    { ...ctx, purpose: "card_chat", maxTurns: MAX_CHAT_TURNS }
  );
  if (!r.ok) return { status: "unavailable", code: r.code };
  return r.data.text.trim() ? judge(r.data.text, "", r.data.supportingFactIds, request, true, r.data.reply) : judge("", "", [], request, true, undefined, r.data.reply);
}
