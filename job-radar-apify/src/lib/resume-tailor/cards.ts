import { normalizeText } from "./text.js";
import { newFactId, type ResumeFacts } from "../resume-studio.js";
import { factTexts, type RequirementEvidence } from "./evidence.js";
import type { JobAnalysis } from "./requirements.js";
import { findSkills } from "./skills.js";

// AI Resume Studio R3 — S4 «guion»: the card queue (doc 11 §1.1 and §5.2).
// The CODE decides the steps and their order:
//   headline → skills → requirement_mapping × N (máx. 5) → summary
// The model only drafts inside a card. Cards that need the model are left
// out when the AI is off (RESUME_AI_PROVIDER=none or budget reached): the
// user can still map requirements and write the bullet themselves.

export const MAX_MAPPING_CARDS = 5;
export const MAX_CHAT_TURNS = 8;

export interface ExperienceOption {
  experienceId: string;
  label: string;
}

export type Card =
  | { id: "headline"; type: "headline"; needsAi: true }
  | { id: "skills"; type: "skills"; needsAi: false; options: string[]; present: string[] }
  | {
      id: string;
      type: "requirement_mapping";
      needsAi: false;
      requirementId: string;
      requirement: string;
      kind: "must" | "nice";
      n: number;
      m: number;
      options: ExperienceOption[];
      /** Pre-selected experience when the CV already shows something (the user can change it). */
      suggested: string | null;
    }
  | { id: "summary"; type: "summary"; needsAi: true };

export function experienceOptions(facts: ResumeFacts): ExperienceOption[] {
  return facts.experience.map((e) => ({
    experienceId: e.id,
    label: [e.role, e.company].filter(Boolean).join(" · ") || "Experiencia sin nombre"
  }));
}

/** Skills the vacancy names that the CV doesn't show yet (offered one by one, never «añadir todo»). */
export function missingSkills(job: JobAnalysis, facts: ResumeFacts): { missing: string[]; present: string[] } {
  const cv = new Set(findSkills(factTexts(facts).map((f) => f.text).join("\n")));
  return { missing: job.skills.filter((s) => !cv.has(s)), present: job.skills.filter((s) => cv.has(s)) };
}

export function buildQueue(input: { job: JobAnalysis; evidence: RequirementEvidence[]; facts: ResumeFacts; aiEnabled: boolean }): Card[] {
  const { job, evidence, facts, aiEnabled } = input;
  const queue: Card[] = [];
  if (aiEnabled) queue.push({ id: "headline", type: "headline", needsAi: true });

  const skills = missingSkills(job, facts);
  if (skills.missing.length) queue.push({ id: "skills", type: "skills", needsAi: false, options: skills.missing.slice(0, 12), present: skills.present });

  const level = new Map(evidence.map((e) => [e.requirementId, e]));
  const pending = job.requirements.filter((r) => level.get(r.id)?.level !== "full").slice(0, MAX_MAPPING_CARDS);
  const options = experienceOptions(facts);
  const parentOf = new Map(factTexts(facts).filter((f) => f.parentId).map((f) => [f.factId, f.parentId as string]));
  pending.forEach((r, i) => {
    const ev = level.get(r.id);
    const suggested =
      ev?.factIds.map((id) => (options.some((o) => o.experienceId === id) ? id : parentOf.get(id))).find((id): id is string => Boolean(id)) ?? null;
    queue.push({
      id: `map-${r.id}`,
      type: "requirement_mapping",
      needsAi: false,
      requirementId: r.id,
      requirement: r.text,
      kind: r.kind,
      n: i + 1,
      m: pending.length,
      options,
      suggested
    });
  });

  if (aiEnabled) queue.push({ id: "summary", type: "summary", needsAi: true });
  return queue;
}

// ---------- applying approved changes (never to the stored base) ----------

export function applyHeadline(facts: ResumeFacts, text: string): ResumeFacts {
  const next = structuredClone(facts);
  next.basics.headline = text.trim().slice(0, 120);
  return next;
}

export function applySummary(facts: ResumeFacts, text: string): ResumeFacts {
  const next = structuredClone(facts);
  next.summary = text.trim().slice(0, 1200);
  return next;
}

/** Adds only skills from `offered`; anything else is ignored (no «añadir todo» from the outside either). */
export function applySkills(facts: ResumeFacts, picked: string[], offered: string[]): ResumeFacts {
  const allowed = new Set(offered);
  const next = structuredClone(facts);
  const have = new Set(next.skills.map((s) => s.name.toLowerCase()));
  for (const name of picked) {
    if (!allowed.has(name) || have.has(name.toLowerCase()) || next.skills.length >= 40) continue;
    next.skills.push({ id: newFactId("skill"), source: "user", sourceSpan: null, name });
    have.add(name.toLowerCase());
  }
  return next;
}

/**
 * Puts the approved bullet first in that experience («es un requisito, por
 * eso va primero»). With `elsewhere`, a new experience entry is created
 * with the label the user typed (dates left empty: never invented).
 */
export function applyBullet(facts: ResumeFacts, target: { experienceId: string } | { elsewhere: string }, text: string): ResumeFacts {
  const next = structuredClone(facts);
  const bullet = { id: newFactId("b"), source: "user" as const, sourceSpan: null, text: text.trim().slice(0, 300) };
  if ("experienceId" in target) {
    const exp = next.experience.find((e) => e.id === target.experienceId);
    if (!exp) return next;
    // R4c: the same text already in that experience moves up instead of being duplicated.
    const same = exp.bullets.findIndex((b) => normalizeText(b.text).replace(/[.;]$/, "") === normalizeText(bullet.text).replace(/[.;]$/, ""));
    if (same >= 0) {
      const [kept] = exp.bullets.splice(same, 1);
      exp.bullets = [kept, ...exp.bullets];
      return next;
    }
    exp.bullets = [bullet, ...exp.bullets].slice(0, 8);
    return next;
  }
  if (next.experience.length >= 15) return next;
  next.experience.push({
    id: newFactId("exp"),
    source: "user",
    sourceSpan: null,
    role: target.elsewhere.trim().slice(0, 120) || "Otra experiencia",
    company: "",
    city: "",
    startDate: "",
    endDate: "",
    current: false,
    bullets: [bullet]
  });
  return next;
}

/** Mechanical clean-up used when the AI is off: the user's own words, capitalized and with a period. */
export function tidyUserBullet(text: string): string {
  const s = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!s) return s;
  const upper = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(upper) ? upper : `${upper}.`;
}
