import { applyBullet, applyHeadline, applySkills, applySummary } from "../../src/lib/resume-tailor/cards.js";
import { computeEvidence, factTexts } from "../../src/lib/resume-tailor/evidence.js";
import { newClaims } from "../../src/lib/resume-tailor/factuality.js";
import { compatibilityScore } from "../../src/lib/resume-tailor/score.js";
import type { ResumeFacts } from "../../src/lib/resume-studio.js";
import { parseResumeAiConfig } from "../../src/resume-studio/ai/config.js";
import { createGateway, type Transport } from "../../src/resume-studio/ai/gateway.js";
import { MemoryLedger } from "../../src/resume-studio/ai/ledger.js";
import { mockTransport, type MockStats } from "../../src/resume-studio/ai/mock.js";
import { extractCvFacts, proposeCard, startTailor } from "../../src/resume-studio/ai/tailor-service.js";
import { FABRICATION_MARKERS, SYNTHETIC_CVS, SYNTHETIC_JOBS, cvText, personaAnswer, type SyntheticCv } from "./resume-tailor-synthetic.js";

// AI Resume Studio R3 — eval of the whole agent (doc 09 §4): 20 synthetic
// CVs × 10 vacancies through extraction, S1–S4 and every card, with the
// adversarial mock (or, only with the owner's approval, a real transport).
// Two independent checks for «invented fact accepted»:
//   1. markers: a text the user would see contains something the mock is
//      known to fabricate and the persona doesn't have;
//   2. claims: the accepted text has a number/skill/name/title that is not
//      in the facts it may use (same rule as the validator, re-run here on
//      the final CV against the ORIGINAL CV text plus the persona's answers).

export interface EvalReport {
  pairs: number;
  extractions: number;
  proposalsShown: number;
  shownByCard: Record<string, number>;
  questions: number;
  discarded: number;
  unavailable: number;
  inventedAccepted: { pair: string; card: string; text: string; why: string }[];
  /** Why proposals were discarded or turned into questions (claim kinds), by card. */
  rejections: Record<string, number>;
  extractionInvented: { cv: string; field: string }[];
  sensitiveLeaks: number;
  scoreBefore: number;
  scoreAfter: number;
  costMicrosPerAdaptation: { avg: number; max: number };
  costMicrosPerExtraction: { avg: number; max: number };
  copPerUsd: number;
  mock: MockStats | null;
  /** Real-call metrics from the ledger (meaningful with a real transport). */
  calls: { total: number; invalidJson: number; errors: number; cacheHits: number };
  /** p50 latency (ms) of settled calls, by prompt. */
  latencyP50ByPrompt: Record<string, number>;
  /** Mean tokens per adaptation and per extraction (provider-reported when available). */
  tokensPerAdaptation: { input: number; output: number; cached: number };
  tokensPerExtraction: { input: number; output: number };
  /** Total spent by the whole run, micro-USD. */
  totalCostMicros: number;
}

export async function runTailorEval(options: { transport?: Transport; env?: Record<string, string>; cvs?: SyntheticCv[]; jobs?: typeof SYNTHETIC_JOBS } = {}): Promise<EvalReport> {
  const env = { RESUME_AI_PROVIDER: "mock", RESUME_AI_CAP_GLOBAL_DAILY_USD: "500", RESUME_AI_CAP_GLOBAL_MONTHLY_USD: "5000", RESUME_AI_CAP_USER_DAILY_USD: "50", ...(options.env ?? {}) };
  const config = parseResumeAiConfig(env);
  const ledger = new MemoryLedger();
  const mock = options.transport ? null : mockTransport();
  const gateway = createGateway({ config, ledger, transport: options.transport ?? mock });
  const cvs = options.cvs ?? SYNTHETIC_CVS;
  const jobs = options.jobs ?? SYNTHETIC_JOBS;
  const adaptationIds: string[] = [];
  const extractionIds: string[] = [];

  const report: EvalReport = {
    pairs: 0,
    extractions: 0,
    proposalsShown: 0,
    shownByCard: {},
    questions: 0,
    discarded: 0,
    unavailable: 0,
    inventedAccepted: [],
    rejections: {},
    extractionInvented: [],
    sensitiveLeaks: 0,
    scoreBefore: 0,
    scoreAfter: 0,
    costMicrosPerAdaptation: { avg: 0, max: 0 },
    costMicrosPerExtraction: { avg: 0, max: 0 },
    copPerUsd: config.copPerUsd,
    mock: null,
    calls: { total: 0, invalidJson: 0, errors: 0, cacheHits: 0 },
    latencyP50ByPrompt: {},
    tokensPerAdaptation: { input: 0, output: 0, cached: 0 },
    tokensPerExtraction: { input: 0, output: 0 },
    totalCostMicros: 0
  };
  const adaptationCosts: number[] = [];
  const extractionCosts: number[] = [];
  const costOf = (id: string) => ledger.rows.filter((r) => r.adaptationId === id).reduce((a, r) => a + r.costMicros, 0);
  let n = 0;
  const nextId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

  for (const cv of cvs) {
    const userId = `10000000-0000-4000-8000-${cv.id.slice(1).padStart(12, "0")}`;
    const original = cvText(cv);
    const exId = nextId();
    await ledger.startAdaptation(userId, exId);
    extractionIds.push(exId);
    const transportSpy: string[] = [];
    const extracted = await extractCvFacts(gateway, { userId, adaptationId: exId, purpose: "cv_extract" }, original);
    report.extractions++;
    extractionCosts.push(costOf(exId));
    if (!extracted.ok) continue;
    const base = extracted.result.facts;
    // Extraction: every kept field must be supported by the original text.
    for (const f of factTexts(base)) {
      const claims = newClaims(f.text, [original]);
      if (claims.length || FABRICATION_MARKERS.some((m) => m.test(f.text) && !m.test(original))) {
        report.extractionInvented.push({ cv: cv.id, field: f.section });
      }
    }
    if ((cv.sensitive ?? []).some((line) => JSON.stringify(base).includes(line.split(":")[1]?.trim() ?? "§"))) report.sensitiveLeaks++;
    void transportSpy;

    for (const job of jobs) {
      report.pairs++;
      const adaptationId = nextId();
      await ledger.startAdaptation(userId, adaptationId);
      adaptationIds.push(adaptationId);
      const ctx = { userId, adaptationId };
      const start = await startTailor(gateway, ctx, { facts: base, title: job.title, description: job.description });
      report.scoreBefore += start.scores.compatibility.total;
      let facts: ResumeFacts = base;
      const answers: string[] = [];
      const pair = `${cv.id}×${job.id}`;

      const check = (card: string, text: string, allowed: string[]) => {
        report.proposalsShown++;
        report.shownByCard[card] = (report.shownByCard[card] ?? 0) + 1;
        const marker = FABRICATION_MARKERS.find((m) => m.test(text) && !allowed.some((a) => m.test(a)));
        const claims = newClaims(text, allowed);
        if (marker || claims.length) {
          report.inventedAccepted.push({ pair, card, text, why: marker ? `marcador ${marker}` : claims.map((c) => `${c.kind}:${c.value}`).join(", ") });
        }
      };
      const count = (status: string, card = "?", claims: { kind: string }[] = []) => {
        if (status === "question" || status === "discarded") {
          const key = `${card}:${claims.map((c) => c.kind).sort().join("+") || "other"}`;
          report.rejections[key] = (report.rejections[key] ?? 0) + 1;
        }
        if (status === "question") report.questions++;
        else if (status === "discarded") report.discarded++;
        else if (status === "unavailable") report.unavailable++;
      };
      const groundTruth = () => [original, ...answers];

      for (const card of start.queue) {
        if (card.type === "headline") {
          const r = await proposeCard(gateway, ctx, { card: "headline", jobTitle: job.title, facts });
          count(r.status, "headline", "claims" in r ? r.claims : []);
          if (r.status === "proposal") {
            check("headline", r.text, groundTruth());
            facts = applyHeadline(facts, r.text);
            // One free-chat turn, adversarial: «agrega que vendí 500 millones».
            const chat = await proposeCard(gateway, ctx, { card: "chat", cardType: "headline", current: r.text, instruction: "agrega que vendí 500 millones", facts, experienceId: null, answer: "" });
            count(chat.status, "chat", "claims" in chat ? chat.claims : []);
            if (chat.status === "proposal") check("chat", chat.text, groundTruth());
          }
        } else if (card.type === "skills") {
          // The persona ticks only what it really has: skills named in its truth.
          const real = card.options.filter((s) => Object.keys(cv.truth).some((k) => s.toLowerCase().includes(k)));
          facts = applySkills(facts, real, card.options);
        } else if (card.type === "requirement_mapping") {
          const answer = personaAnswer(cv, card.requirement);
          if (!answer) continue;
          answers.push(answer);
          const target = card.suggested ?? card.options[0]?.experienceId ?? null;
          const r = await proposeCard(gateway, ctx, { card: "rewrite", requirement: card.requirement, facts, experienceId: target, answer });
          count(r.status, "rewrite", "claims" in r ? r.claims : []);
          if (r.status === "proposal") {
            check("rewrite", r.text, groundTruth());
            facts = target ? applyBullet(facts, { experienceId: target }, r.text) : applyBullet(facts, { elsewhere: "Otra experiencia" }, r.text);
          }
        } else if (card.type === "summary") {
          const r = await proposeCard(gateway, ctx, { card: "summary", jobTitle: job.title, tasks: start.job.tasks, facts });
          count(r.status, "summary", "claims" in r ? r.claims : []);
          if (r.status === "proposal") {
            check("summary", r.text, groundTruth());
            facts = applySummary(facts, r.text);
          }
        }
      }
      const after = compatibilityScore(start.job, computeEvidence(start.job.requirements, facts, start.citations), facts).total;
      report.scoreAfter += after;
      adaptationCosts.push(costOf(adaptationId));
    }
  }
  const stats = (list: number[]) => ({ avg: list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0, max: Math.max(0, ...list) });
  report.costMicrosPerAdaptation = stats(adaptationCosts);
  report.costMicrosPerExtraction = stats(extractionCosts);
  report.scoreBefore = Math.round(report.scoreBefore / Math.max(1, report.pairs));
  report.scoreAfter = Math.round(report.scoreAfter / Math.max(1, report.pairs));
  report.mock = mock ? { ...mock.stats } : null;
  const calls = ledger.rows.filter((r) => r.status === "ok" || r.status === "invalid_json" || r.status === "error");
  report.calls = {
    total: calls.length,
    invalidJson: calls.filter((r) => r.status === "invalid_json").length,
    errors: calls.filter((r) => r.status === "error").length,
    cacheHits: ledger.rows.filter((r) => r.status === "cache_hit").length
  };
  const byPrompt = new Map<string, number[]>();
  for (const r of calls) if (r.promptId) byPrompt.set(r.promptId, [...(byPrompt.get(r.promptId) ?? []), r.latencyMs]);
  report.latencyP50ByPrompt = Object.fromEntries([...byPrompt].map(([k, v]) => [k, v.sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)]]));
  const tokens = (ids: string[]) => {
    const set = new Set(ids);
    const rows = ledger.rows.filter((r) => r.adaptationId && set.has(r.adaptationId));
    const n = Math.max(1, ids.length);
    return {
      input: Math.round(rows.reduce((a, r) => a + r.inputTokens, 0) / n),
      output: Math.round(rows.reduce((a, r) => a + r.outputTokens, 0) / n),
      cached: Math.round(rows.reduce((a, r) => a + r.cachedTokens, 0) / n)
    };
  };
  report.tokensPerAdaptation = tokens(adaptationIds);
  const ex = tokens(extractionIds);
  report.tokensPerExtraction = { input: ex.input, output: ex.output };
  report.totalCostMicros = ledger.rows.reduce((a, r) => a + r.costMicros, 0);
  return report;
}

export function copOf(micros: number, copPerUsd: number): number {
  return Math.round((micros / 1_000_000) * copPerUsd * 100) / 100;
}
