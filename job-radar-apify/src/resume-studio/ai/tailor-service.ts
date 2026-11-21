import { emptyResumeFacts, newFactId, resumeFactsSchema, type ResumeFacts } from "../../lib/resume-studio.js";
import { buildQueue, tidyUserBullet, type Card } from "../../lib/resume-tailor/cards.js";
import { computeEvidence, factTexts, verifyCitations, type Citation, type FactText, type RequirementEvidence } from "../../lib/resume-tailor/evidence.js";
import { newClaims, validateProposal, type Claim } from "../../lib/resume-tailor/factuality.js";
import { acceptModelRequirements, analyzeJob, type JobAnalysis } from "../../lib/resume-tailor/requirements.js";
import { compatibilityScore, qualityScore } from "../../lib/resume-tailor/score.js";
import { findQuote } from "../../lib/resume-tailor/text.js";
import { MAX_CHAT_TURNS } from "../../lib/resume-tailor/cards.js";
import type { CallContext, GatewayFailure, ResumeAiGateway } from "./gateway.js";
import { CARD_CHAT, CARD_HEADLINE, CARD_REWRITE, CARD_SUMMARY, CV_EXTRACT, EVIDENCE_MAP, JOB_REQUIREMENTS } from "./prompts.js";
import { minimizeCvText } from "./sensitive.js";

// AI Resume Studio R3 — the state machine's server steps (doc 11 §5.2):
// S1 requirements → S2 evidence → S3 score → S4 queue at start, then one
// call per card (S5) with the factuality validator on every proposal. The
// adaptation itself lives in the browser; this module is stateless.

const MONTH = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;
const month = (v: string) => (MONTH.test(v) ? v : "");

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

  // A field is kept only if its quote is in the ORIGINAL text, and its text
  // says nothing its quote doesn't (else the quote itself is used).
  const verified = (label: string, text: string, quote: string): { text: string; span: { start: number; end: number } } | null => {
    const span = findQuote(original, quote);
    if (!span) {
      dropped.push(label);
      return null;
    }
    const literal = original.slice(span.start, span.end);
    return { text: newClaims(text, [literal]).length ? literal : text, span };
  };

  if (out.headline) {
    const v = verified("Título del perfil", out.headline.text, out.headline.quote);
    if (v) facts.basics.headline = v.text.slice(0, 120);
  }
  if (out.summary) {
    const v = verified("Perfil", out.summary.text, out.summary.quote);
    if (v) facts.summary = v.text.slice(0, 1200);
  }
  for (const e of out.experience) {
    const v = verified(`Experiencia «${e.role || e.company}»`, `${e.role} ${e.company}`, e.quote);
    if (!v) continue;
    const bullets = e.bullets
      .map((b) => {
        const bv = verified(`Viñeta de «${e.role}»`, b.text, b.quote);
        return bv ? { id: newFactId("b"), source: "file" as const, sourceSpan: bv.span, text: bv.text.slice(0, 300) } : null;
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
    const sourced = (value: string) => (value && findQuote(original, value) ? value : "");
    facts.experience.push({
      id: newFactId("exp"),
      source: "file",
      sourceSpan: v.span,
      role: sourced(e.role).slice(0, 120),
      company: sourced(e.company).slice(0, 120),
      city: sourced(e.city).slice(0, 80),
      // Dates must be literally in the CV; unreadable → empty, asked later.
      startDate: original.includes(e.startDate) ? month(e.startDate) : "",
      endDate: original.includes(e.endDate) ? month(e.endDate) : "",
      current: e.current,
      bullets: bullets.slice(0, 8)
    });
    if (facts.experience.length >= 15) break;
  }
  for (const ed of out.education) {
    const v = verified(`Formación «${ed.degree}»`, `${ed.degree} ${ed.institution}`, ed.quote);
    if (!v) continue;
    const sourced = (value: string) => (value && findQuote(original, value) ? value : "");
    facts.education.push({
      id: newFactId("edu"),
      source: "file",
      sourceSpan: v.span,
      degree: (sourced(ed.degree) || v.text).slice(0, 120),
      institution: sourced(ed.institution).slice(0, 120),
      city: "",
      startDate: original.includes(ed.startDate) ? month(ed.startDate) : "",
      endDate: original.includes(ed.endDate) ? month(ed.endDate) : ""
    });
    if (facts.education.length >= 10) break;
  }
  for (const c of out.certifications) {
    const v = verified(`Certificación «${c.name}»`, c.name, c.quote);
    if (v) facts.certifications.push({ id: newFactId("cert"), source: "file", sourceSpan: v.span, name: v.text.slice(0, 120), issuer: findQuote(original, c.issuer || "~~") ? c.issuer.slice(0, 120) : "", date: original.includes(c.date) ? month(c.date) : "" });
    if (facts.certifications.length >= 15) break;
  }
  for (const s of out.skills) {
    const v = verified(`Habilidad «${s.name}»`, s.name, s.quote);
    if (v) facts.skills.push({ id: newFactId("skill"), source: "file", sourceSpan: v.span, name: v.text.slice(0, 60) });
    if (facts.skills.length >= 40) break;
  }
  for (const l of out.languages) {
    const v = verified(`Idioma «${l.name}»`, `${l.name} ${l.level}`, l.quote);
    if (v) facts.languages.push({ id: newFactId("lang"), source: "file", sourceSpan: v.span, name: l.name.slice(0, 40), level: findQuote(original, l.level || "~~") ? l.level.slice(0, 40) : "" });
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
  | { card: "chat"; cardType: "headline" | "summary" | "rewrite"; current: string; instruction: string; facts: ResumeFacts; experienceId: string | null; answer: string };

export type CardResult =
  | { status: "proposal"; text: string; why: string; supportingFactIds: string[]; byAi: boolean; reply?: string }
  | { status: "question"; claims: Claim[]; question: string; discardedText: string }
  | { status: "discarded"; claims: Claim[]; reason: "new_data" | "unknown_fact" | "empty" }
  | { status: "unavailable"; code: GatewayFailure };

/** The texts a card may draw from (doc 05 §5): cited facts and the user's own answer. */
export function cardSources(request: CardRequest): { sources: string[]; knownFactIds: string[] } {
  const all = factTexts(request.facts);
  const knownFactIds = all.map((f) => f.factId);
  if (request.card === "rewrite" || (request.card === "chat" && request.cardType === "rewrite")) {
    const scoped = request.experienceId ? all.filter((f) => f.factId === request.experienceId || f.parentId === request.experienceId) : [];
    return { sources: [request.answer, ...scoped.map((f) => f.text)], knownFactIds };
  }
  return { sources: all.map((f) => f.text), knownFactIds };
}

function judge(text: string, why: string, supportingFactIds: string[], request: CardRequest, byAi: boolean, reply?: string): CardResult {
  const { sources, knownFactIds } = cardSources(request);
  const verdict = validateProposal({ after: text, sources, supportingFactIds, knownFactIds });
  if (verdict.verdict === "accept") return { status: "proposal", text, why, supportingFactIds, byAi, ...(reply ? { reply } : {}) };
  if (verdict.verdict === "question") {
    const names = verdict.newClaims.map((c) => c.value);
    return {
      status: "question",
      claims: verdict.newClaims,
      question: `La propuesta menciona ${names.join(", ")}, que no está en tu hoja de vida. ¿Lo usaste de verdad? Si es así, agrégalo con tus palabras.`,
      discardedText: text
    };
  }
  return { status: "discarded", claims: verdict.newClaims, reason: verdict.reason === "ok" ? "new_data" : verdict.reason };
}

export async function proposeCard(gateway: ResumeAiGateway, ctx: Omit<CallContext, "purpose" | "maxTurns">, request: CardRequest): Promise<CardResult> {
  if (request.card === "rewrite") {
    if (!gateway.enabled) {
      // AI off: the user's own words, tidied mechanically (still validated).
      return judge(tidyUserBullet(request.answer), "Tus palabras, con mayúscula inicial y punto final.", [], request, false);
    }
    const experience = request.experienceId ? factTexts(request.facts).filter((f) => f.factId === request.experienceId || f.parentId === request.experienceId) : [];
    const r = await gateway.complete(CARD_REWRITE, { requirement: request.requirement, experience, answer: request.answer }, { ...ctx, purpose: "card_rewrite" });
    if (!r.ok) return { status: "unavailable", code: r.code };
    return judge(r.data.text, r.data.why, r.data.supportingFactIds, request, true);
  }
  if (!gateway.enabled) return { status: "unavailable", code: "ai_off" };
  if (request.card === "headline") {
    const r = await gateway.complete(CARD_HEADLINE, { jobTitle: request.jobTitle, facts: citableFacts(request.facts) }, { ...ctx, purpose: "card_headline" });
    if (!r.ok) return { status: "unavailable", code: r.code };
    return judge(r.data.text, r.data.why, r.data.supportingFactIds, request, true);
  }
  if (request.card === "summary") {
    const r = await gateway.complete(CARD_SUMMARY, { jobTitle: request.jobTitle, tasks: request.tasks, facts: citableFacts(request.facts) }, { ...ctx, purpose: "card_summary" });
    if (!r.ok) return { status: "unavailable", code: r.code };
    return judge(r.data.text, r.data.why, r.data.supportingFactIds, request, true);
  }
  const { sources } = cardSources(request);
  const r = await gateway.complete(
    CARD_CHAT,
    { cardType: request.cardType, current: request.current, instruction: request.instruction, facts: citableFacts(request.facts).filter((f) => sources.includes(f.text)) },
    { ...ctx, purpose: "card_chat", maxTurns: MAX_CHAT_TURNS }
  );
  if (!r.ok) return { status: "unavailable", code: r.code };
  return judge(r.data.text, "", r.data.supportingFactIds, request, true, r.data.reply);
}
