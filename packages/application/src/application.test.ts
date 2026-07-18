import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { CanonicalJob, CvFacts } from "@job-radar/domain";
import { CvFactsSchema } from "@job-radar/domain";
import { buildAnswers, buildCoverLetter, buildCvPatch } from "./generate.js";
import {
  missingSkills,
  validateAnswers,
  validateCoverLetter,
  validateCvPatch
} from "./factuality.js";
import { CvPatchSchema, CoverLetterSchema, ApplicationAnswersSchema } from "./drafts.js";
import { renderApplicationMarkdown } from "./export.js";

const facts: CvFacts = CvFactsSchema.parse({
  experience: [
    {
      id: "experience_001",
      company: "Acme",
      title: "Data Analyst",
      start_date: "2022-03",
      end_date: null,
      responsibilities: ["Construir dashboards"],
      achievements: [
        { id: "achievement_001", statement: "Automaticé reportes mensuales", metric: "-20 horas/mes" }
      ]
    }
  ],
  skills: [
    { id: "skill_sql", name: "SQL", evidence: ["experience_001"] },
    { id: "skill_excel", name: "Excel", evidence: ["experience_001"] }
  ],
  education: [],
  certifications: [],
  languages: [{ language: "es", level: "native" }],
  links: [],
  constraints: []
});

function job(overrides: Partial<CanonicalJob> = {}): CanonicalJob {
  const now = new Date("2026-07-18T00:00:00.000Z").toISOString();
  const id = overrides.id ?? randomUUID();
  return {
    id,
    sourceId: "greenhouse:acme",
    sourceJobId: "1",
    sourceUrl: `https://boards.example.test/${id}`,
    canonicalUrl: `https://boards.example.test/${id}`,
    applyUrl: null,
    titleRaw: "Data Analyst",
    titleNormalized: "data analyst",
    titleFamily: null,
    seniority: "unknown",
    companyNameRaw: "Acme",
    companyId: null,
    companyNameNormalized: "acme",
    companyDomain: null,
    descriptionText: "SQL y dashboards.",
    responsibilities: [],
    requiredSkills: ["SQL"],
    preferredSkills: [],
    requiredExperienceYears: null,
    educationRequirements: [],
    languageRequirements: [],
    locations: [],
    workMode: "remote",
    remoteRegion: null,
    employmentTypes: [],
    compensation: { min: null, max: null, currency: null, period: null, source: "unknown" },
    visaSponsorship: "unknown",
    publishedAt: null,
    expiresAt: null,
    firstSeenAt: now,
    lastSeenAt: now,
    lastVerifiedAt: null,
    status: "active",
    extractionMethod: "api",
    extractionConfidence: 0.9,
    contentHash: "h",
    evidence: [],
    ...overrides
  };
}

describe("deterministic generation + factuality (D07)", () => {
  it("generates a valid, evidence-backed CV patch for a matching job", () => {
    const j = job();
    const patch = CvPatchSchema.parse(buildCvPatch(facts, j));
    const report = validateCvPatch(patch, facts, j);
    expect(report.ok).toBe(true);
    expect(report.gaps).toEqual([]);
    expect(patch.summary_revision.supporting_fact_ids).toContain("experience_001");
  });

  it("NEVER claims a skill the candidate lacks: it becomes a declared gap", () => {
    const j = job({ requiredSkills: ["SQL", "Terraform"] });
    const patch = buildCvPatch(facts, j);
    expect(patch.gaps_not_to_claim).toEqual(["Terraform"]);
    const allText = [
      patch.summary_revision.text,
      ...patch.bullet_rewrites.map((bullet) => bullet.revised_text)
    ]
      .join(" ")
      .toLowerCase();
    expect(allText).not.toContain("terraform");
    expect(validateCvPatch(patch, facts, j).ok).toBe(true);

    const letter = buildCoverLetter(facts, j);
    const letterText = letter.paragraphs.map((paragraph) => paragraph.text).join(" ").toLowerCase();
    expect(letterText).not.toContain("terraform");
    expect(validateCoverLetter(letter, facts, j).ok).toBe(true);
  });

  it("blocks drafts that mention a gap skill", () => {
    const j = job({ requiredSkills: ["SQL", "Terraform"] });
    const patch = buildCvPatch(facts, j);
    patch.summary_revision.text += " Experto en Terraform.";
    const report = validateCvPatch(patch, facts, j);
    expect(report.ok).toBe(false);
    expect(report.violations.some((violation) => violation.kind === "claims_missing_skill")).toBe(
      true
    );
  });

  it("blocks claims citing unknown fact ids or no evidence at all", () => {
    const j = job();
    const patch = buildCvPatch(facts, j);
    patch.summary_revision.supporting_fact_ids = ["invented_fact"];
    let report = validateCvPatch(patch, facts, j);
    expect(report.violations.some((violation) => violation.kind === "unknown_fact_id")).toBe(true);

    const letter = buildCoverLetter(facts, j);
    letter.paragraphs[0]!.supporting_fact_ids = [];
    report = validateCoverLetter(letter, facts, j);
    expect(report.violations.some((violation) => violation.kind === "missing_evidence")).toBe(true);
  });

  it("blocks when a gap exists but is not declared", () => {
    const j = job({ requiredSkills: ["Terraform"] });
    const patch = buildCvPatch(facts, j);
    patch.gaps_not_to_claim = [];
    const report = validateCvPatch(patch, facts, j);
    expect(report.ok).toBe(false);
    expect(report.violations.some((violation) => violation.kind === "gap_not_declared")).toBe(true);
  });

  it("answers only questions covered by facts; everything else needs the user", () => {
    const answers = ApplicationAnswersSchema.parse(
      buildAnswers(
        ["¿Tienes experiencia con SQL?", "¿Cuál es tu expectativa salarial?"],
        facts
      )
    );
    expect(answers.answers[0]!.needs_user_input).toBe(false);
    expect(answers.answers[0]!.answer?.supporting_fact_ids).toEqual(["skill_sql"]);
    expect(answers.answers[1]!.needs_user_input).toBe(true);
    expect(answers.answers[1]!.answer).toBeNull();
    expect(validateAnswers(answers, facts, job()).ok).toBe(true);
  });

  it("missingSkills honors taxonomy synonyms (postgres counts as SQL)", () => {
    const j = job({ requiredSkills: ["PostgreSQL"] });
    expect(missingSkills(facts, j)).toEqual([]);
  });

  it("cover letter respects the word budget", () => {
    const letter = CoverLetterSchema.parse(buildCoverLetter(facts, job(), 12));
    expect(letter.word_count).toBeLessThanOrEqual(12 + 20);
    expect(letter.paragraphs.length).toBeGreaterThan(0);
  });
});

describe("markdown export", () => {
  it("renders gaps and manual-submission warning; never an auto-apply path", () => {
    const j = job({ requiredSkills: ["SQL", "Terraform"] });
    const patch = buildCvPatch(facts, j);
    const letter = buildCoverLetter(facts, j);
    const answers = buildAnswers(["¿Salario?"], facts);
    const markdown = renderApplicationMarkdown({
      job: j,
      cvPatch: patch,
      coverLetter: letter,
      answers,
      reports: {
        cvPatch: validateCvPatch(patch, facts, j),
        coverLetter: validateCoverLetter(letter, facts, j),
        answers: validateAnswers(answers, facts, j)
      }
    });
    expect(markdown).toContain("Brechas que NO se deben afirmar");
    expect(markdown).toContain("Terraform");
    expect(markdown).toContain("no envía candidaturas");
    expect(markdown.toLowerCase()).not.toContain("auto_apply activado");
  });
});
