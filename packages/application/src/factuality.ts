import type { CanonicalJob } from "@job-radar/domain";
import type { CvFacts } from "@job-radar/domain";
import { SKILL_SYNONYMS } from "@job-radar/matching";
import type { ApplicationAnswers, Claim, CoverLetter, CvPatch } from "./drafts.js";

export interface FactualityViolation {
  where: string;
  kind:
    | "unknown_fact_id"
    | "missing_evidence"
    | "claims_missing_skill"
    | "gap_not_declared";
  detail: string;
}

export interface FactualityReport {
  ok: boolean;
  violations: FactualityViolation[];
  /** Job requirements with no backing fact — allowed only as declared gaps. */
  gaps: string[];
}

/** Every id the vault authorizes a claim to cite. */
export function collectFactIds(facts: CvFacts): Set<string> {
  const ids = new Set<string>();
  for (const experience of facts.experience) {
    ids.add(experience.id);
    for (const achievement of experience.achievements) {
      ids.add(achievement.id);
    }
  }
  for (const skill of facts.skills) ids.add(skill.id);
  for (const education of facts.education) ids.add(education.id);
  for (const certification of facts.certifications) ids.add(certification.id);
  return ids;
}

function normalizeSkill(name: string): string {
  const lower = name.trim().toLowerCase();
  for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
    if (canonical === lower || synonyms.includes(lower)) {
      return canonical;
    }
  }
  return lower;
}

/** Job-required skills the facts vault cannot back. These are gaps. */
export function missingSkills(facts: CvFacts, job: CanonicalJob): string[] {
  const known = new Set(facts.skills.map((skill) => normalizeSkill(skill.name)));
  return job.requiredSkills.filter((skill) => !known.has(normalizeSkill(skill)));
}

function checkClaim(
  claim: Claim,
  where: string,
  authorized: Set<string>,
  gaps: string[],
  violations: FactualityViolation[]
): void {
  if (claim.supporting_fact_ids.length === 0) {
    violations.push({
      where,
      kind: "missing_evidence",
      detail: "claim cites no supporting_fact_ids"
    });
  }
  for (const id of claim.supporting_fact_ids) {
    if (!authorized.has(id)) {
      violations.push({
        where,
        kind: "unknown_fact_id",
        detail: `fact id "${id}" does not exist in the authorized vault`
      });
    }
  }
  const text = claim.text.toLowerCase();
  for (const gap of gaps) {
    if (text.includes(gap.toLowerCase())) {
      violations.push({
        where,
        kind: "claims_missing_skill",
        detail: `text mentions "${gap}" but the vault has no fact backing that skill`
      });
    }
  }
}

/**
 * Deterministic factuality gate (D07). Blocks — never rewrites — any draft
 * where a claim lacks evidence, cites unknown facts, or asserts a skill the
 * vault cannot back. Gaps must be declared, not silently omitted.
 */
export function validateCvPatch(
  patch: CvPatch,
  facts: CvFacts,
  job: CanonicalJob
): FactualityReport {
  const authorized = collectFactIds(facts);
  const gaps = missingSkills(facts, job);
  const violations: FactualityViolation[] = [];

  checkClaim(patch.summary_revision, "summary_revision", authorized, gaps, violations);
  patch.bullet_rewrites.forEach((bullet, index) => {
    checkClaim(
      { text: bullet.revised_text, supporting_fact_ids: bullet.supporting_fact_ids },
      `bullet_rewrites[${index}]`,
      authorized,
      gaps,
      violations
    );
    if (!authorized.has(bullet.original_id)) {
      violations.push({
        where: `bullet_rewrites[${index}]`,
        kind: "unknown_fact_id",
        detail: `original_id "${bullet.original_id}" does not exist in the vault`
      });
    }
  });
  for (const skillId of patch.reordered_skills) {
    if (!authorized.has(skillId)) {
      violations.push({
        where: "reordered_skills",
        kind: "unknown_fact_id",
        detail: `skill id "${skillId}" does not exist in the vault`
      });
    }
  }
  const declared = new Set(patch.gaps_not_to_claim.map((gap) => gap.toLowerCase()));
  for (const gap of gaps) {
    if (!declared.has(gap.toLowerCase())) {
      violations.push({
        where: "gaps_not_to_claim",
        kind: "gap_not_declared",
        detail: `"${gap}" is required by the job, unbacked by facts, and not declared as a gap`
      });
    }
  }
  return { ok: violations.length === 0, violations, gaps };
}

export function validateCoverLetter(
  letter: CoverLetter,
  facts: CvFacts,
  job: CanonicalJob
): FactualityReport {
  const authorized = collectFactIds(facts);
  const gaps = missingSkills(facts, job);
  const violations: FactualityViolation[] = [];
  letter.paragraphs.forEach((paragraph, index) => {
    checkClaim(paragraph, `paragraphs[${index}]`, authorized, gaps, violations);
  });
  return { ok: violations.length === 0, violations, gaps };
}

export function validateAnswers(
  answers: ApplicationAnswers,
  facts: CvFacts,
  job: CanonicalJob
): FactualityReport {
  const authorized = collectFactIds(facts);
  const gaps = missingSkills(facts, job);
  const violations: FactualityViolation[] = [];
  answers.answers.forEach((entry, index) => {
    if (entry.answer) {
      checkClaim(entry.answer, `answers[${index}]`, authorized, gaps, violations);
    }
  });
  return { ok: violations.length === 0, violations, gaps };
}
