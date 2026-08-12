import type { CvFacts } from "./cv-facts-schema.js";
import type { Claim, CvDocument } from "./cv-document-schema.js";

/**
 * Deterministic factuality gate (docs/CV-GENERATION-PLAN.md §3.3) — port
 * of packages/application/src/factuality.ts's spirit, NOT its full check
 * list. Blocks, never rewrites.
 *
 * Only 2 of the 3 checks described in §3.3 are portable to this
 * subproject:
 * - `unknown_fact_id`: any cited id that isn't in the vault → violation.
 * - `missing_evidence`: any Claim with empty `supporting_fact_ids` → violation.
 *
 * `gap_not_declared` is NOT implemented here. The root project computes
 * it by diffing `CanonicalJob.requiredSkills` (a structured list, built
 * by its own job-parsing pipeline) against `CvFacts.skills`, normalized
 * through a `SKILL_SYNONYMS` taxonomy — none of that infrastructure
 * exists in job-radar-apify (`Job` has no structured requirements field,
 * verified against src/sources/types.ts). Building it would mean adding a
 * whole requirements-extraction step this plan never scoped. Until that
 * exists, undeclared-gap detection rests entirely on Etapa D's
 * adversarial critique (point 2 of its system prompt, §4) — an LLM
 * check, weaker than a code check, and a known limitation, not an
 * oversight.
 */

export interface FactualityViolation {
  where: string;
  kind: "unknown_fact_id" | "missing_evidence";
  detail: string;
}

export interface FactualityReport {
  ok: boolean;
  violations: FactualityViolation[];
}

/** Every id the vault authorizes a claim to cite. */
export function collectFactIds(facts: CvFacts): Set<string> {
  const ids = new Set<string>();
  for (const experience of facts.experience) {
    ids.add(experience.id);
    for (const achievement of experience.achievements) ids.add(achievement.id);
  }
  for (const skill of facts.skills) ids.add(skill.id);
  for (const education of facts.education) ids.add(education.id);
  for (const certification of facts.certifications) ids.add(certification.id);
  for (const language of facts.languages) ids.add(language.id);
  return ids;
}

function checkClaim(claim: Claim, where: string, authorized: Set<string>, violations: FactualityViolation[]): void {
  if (claim.supporting_fact_ids.length === 0) {
    violations.push({ where, kind: "missing_evidence", detail: "claim cites no supporting_fact_ids" });
  }
  for (const id of claim.supporting_fact_ids) {
    checkId(id, where, authorized, violations);
  }
}

function checkId(id: string, where: string, authorized: Set<string>, violations: FactualityViolation[]): void {
  if (!authorized.has(id)) {
    violations.push({ where, kind: "unknown_fact_id", detail: `fact id "${id}" does not exist in the authorized vault` });
  }
}

export function validateCvDocument(doc: CvDocument, facts: CvFacts): FactualityReport {
  const authorized = collectFactIds(facts);
  const violations: FactualityViolation[] = [];

  checkClaim(doc.headline, "headline", authorized, violations);
  checkClaim(doc.summary, "summary", authorized, violations);

  doc.experience.forEach((exp, i) => {
    checkId(exp.source_id, `experience[${i}].source_id`, authorized, violations);
    exp.bullets.forEach((bullet, j) => checkClaim(bullet, `experience[${i}].bullets[${j}]`, authorized, violations));
  });

  doc.reordered_skill_ids.forEach((id, i) => checkId(id, `reordered_skill_ids[${i}]`, authorized, violations));
  doc.reordered_education_ids.forEach((id, i) => checkId(id, `reordered_education_ids[${i}]`, authorized, violations));
  doc.reordered_certification_ids.forEach((id, i) => checkId(id, `reordered_certification_ids[${i}]`, authorized, violations));
  doc.omitted_fact_ids.forEach((id, i) => checkId(id, `omitted_fact_ids[${i}]`, authorized, violations));

  return { ok: violations.length === 0, violations };
}
