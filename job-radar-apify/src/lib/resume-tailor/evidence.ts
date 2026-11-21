import type { ResumeFacts } from "../resume-studio.js";
import type { Requirement } from "./requirements.js";
import { textMentionsSkill } from "./skills.js";
import { contentTerms, findQuote } from "./text.js";

// AI Resume Studio R3 — S2 «evidencia» (doc 05 §1, doc 11 §5.2). The model
// may only PROPOSE citations; the code checks each one exists, and the
// level (demostrado / parcial / no) is computed here from term coverage, so
// the score never depends on the model's opinion (doc 05 §4).

export type EvidenceLevel = "full" | "partial" | "none";

export interface FactText {
  factId: string;
  /** Which section the fact belongs to. */
  section: "experience" | "bullet" | "education" | "certification" | "skill" | "language" | "summary" | "headline";
  text: string;
  /** For bullets: the experience they belong to. */
  parentId?: string;
}

/** Every citable fact of a CV as plain text. Contact data is never included. */
export function factTexts(facts: ResumeFacts): FactText[] {
  const out: FactText[] = [];
  if (facts.basics.headline.trim()) out.push({ factId: "headline", section: "headline", text: facts.basics.headline });
  if (facts.summary.trim()) out.push({ factId: "summary", section: "summary", text: facts.summary });
  for (const e of facts.experience) {
    out.push({ factId: e.id, section: "experience", text: [e.role, e.company].filter(Boolean).join(" · ") });
    for (const b of e.bullets) if (b.text.trim()) out.push({ factId: b.id, section: "bullet", text: b.text, parentId: e.id });
  }
  for (const ed of facts.education) out.push({ factId: ed.id, section: "education", text: [ed.degree, ed.institution].filter(Boolean).join(" · ") });
  for (const c of facts.certifications) out.push({ factId: c.id, section: "certification", text: [c.name, c.issuer].filter(Boolean).join(" · ") });
  for (const s of facts.skills) if (s.name.trim()) out.push({ factId: s.id, section: "skill", text: s.name });
  for (const l of facts.languages) out.push({ factId: l.id, section: "language", text: [l.name, l.level].filter(Boolean).join(" ") });
  return out;
}

export interface Citation {
  factId: string;
  quote: string;
}

export interface RequirementEvidence {
  requirementId: string;
  level: EvidenceLevel;
  /** Facts that back the level (verified citations or term matches). */
  factIds: string[];
}

/** Keeps only citations whose fact exists and whose quote is in that fact's text. */
export function verifyCitations(facts: ResumeFacts, citations: Citation[]): Citation[] {
  const byId = new Map(factTexts(facts).map((f) => [f.factId, f.text]));
  return citations.filter((c) => {
    const text = byId.get(c.factId);
    return typeof text === "string" && typeof c.quote === "string" && findQuote(text, c.quote) !== null;
  });
}

function coverage(req: Requirement, text: string): number {
  const skillHits = req.skills.filter((s) => textMentionsSkill(text, s)).length;
  const terms = new Set(contentTerms(text));
  const termHits = req.terms.filter((t) => terms.has(t)).length;
  const skillShare = req.skills.length ? skillHits / req.skills.length : null;
  const termShare = req.terms.length ? termHits / req.terms.length : 0;
  return skillShare === null ? termShare : Math.max(skillShare, termShare);
}

/**
 * Level per requirement. Facts considered: verified citations from the model
 * (if any) plus any fact whose own text covers the requirement's skills or
 * terms. Full ≥ 0.6 coverage, partial ≥ 0.3.
 */
export function computeEvidence(requirements: Requirement[], facts: ResumeFacts, citations: Record<string, Citation[]> = {}): RequirementEvidence[] {
  const all = factTexts(facts).filter((f) => f.section !== "headline" && f.section !== "summary");
  return requirements.map((req) => {
    const verified = verifyCitations(facts, citations[req.id] ?? []).map((c) => c.factId);
    const candidates = new Set<string>(verified);
    let best = 0;
    const scored: { id: string; c: number }[] = [];
    for (const f of all) {
      const c = coverage(req, f.text);
      if (c > 0) scored.push({ id: f.factId, c });
    }
    // Cited facts count together with their parent experience text.
    const joined = all.filter((f) => candidates.has(f.factId)).map((f) => f.text).join(" \n ");
    if (joined) best = coverage(req, joined);
    for (const s of scored) {
      if (s.c > best) best = s.c;
      if (s.c >= 0.3) candidates.add(s.id);
    }
    const level: EvidenceLevel = best >= 0.6 ? "full" : best >= 0.3 ? "partial" : "none";
    return { requirementId: req.id, level, factIds: level === "none" ? [] : [...candidates].slice(0, 5) };
  });
}
