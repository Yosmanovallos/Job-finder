import { z } from "zod";
import { LanguageLevelSchema } from "../profile/profile-schema.js";

const NonEmptyString = z.string().min(1, "Must not be empty");

/** Stable identifier used for cross-references, e.g. experience_001. */
const FactIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/, "Must be a lowercase identifier like experience_001");

const YearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Must be a year-month date like 2023-01");

const AchievementSchema = z
  .object({
    id: FactIdSchema,
    statement: NonEmptyString,
    metric: NonEmptyString.optional()
  })
  .strict();

const ExperienceSchema = z
  .object({
    id: FactIdSchema,
    company: NonEmptyString,
    title: NonEmptyString,
    start_date: YearMonthSchema,
    /** null means the position is current. */
    end_date: YearMonthSchema.nullable().default(null),
    responsibilities: z.array(NonEmptyString).default([]),
    achievements: z.array(AchievementSchema).default([])
  })
  .strict();

const FactSkillSchema = z
  .object({
    id: FactIdSchema,
    name: NonEmptyString,
    /** Ids of experience/education/certification entries backing this skill. */
    evidence: z.array(FactIdSchema).default([])
  })
  .strict();

const EducationSchema = z
  .object({
    id: FactIdSchema,
    institution: NonEmptyString,
    program: NonEmptyString,
    start_date: YearMonthSchema.optional(),
    end_date: YearMonthSchema.nullable().optional()
  })
  .strict();

const CertificationSchema = z
  .object({
    id: FactIdSchema,
    name: NonEmptyString,
    issuer: NonEmptyString.optional(),
    issued_date: YearMonthSchema.optional()
  })
  .strict();

const FactLanguageSchema = z
  .object({
    language: NonEmptyString,
    level: LanguageLevelSchema
  })
  .strict();

const LinkSchema = z
  .object({
    label: NonEmptyString,
    url: z.string().url("Must be a valid URL")
  })
  .strict();

/**
 * Authorized CV facts vault (private/cv/facts.yaml). Everything the AI may
 * ever claim about the candidate must come from this file; anything absent
 * is a gap to be declared, never invented. No field has an invented default.
 */
export const CvFactsSchema = z
  .object({
    experience: z.array(ExperienceSchema).default([]),
    skills: z.array(FactSkillSchema).default([]),
    education: z.array(EducationSchema).default([]),
    certifications: z.array(CertificationSchema).default([]),
    languages: z.array(FactLanguageSchema).default([]),
    links: z.array(LinkSchema).default([]),
    constraints: z.array(NonEmptyString).default([])
  })
  .strict()
  .superRefine((facts, ctx) => {
    const seen = new Map<string, string>();
    const register = (id: string, where: (string | number)[]) => {
      const previous = seen.get(id);
      if (previous !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: where,
          message: `Duplicate id "${id}" (already used at ${previous}). Ids must be unique across the whole file`
        });
        return;
      }
      seen.set(id, where.join("."));
    };

    facts.experience.forEach((experience, i) => {
      register(experience.id, ["experience", i, "id"]);
      experience.achievements.forEach((achievement, j) => {
        register(achievement.id, ["experience", i, "achievements", j, "id"]);
      });
      if (experience.end_date !== null && experience.start_date > experience.end_date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["experience", i, "end_date"],
          message: "end_date must not be earlier than start_date"
        });
      }
    });
    facts.education.forEach((education, i) => register(education.id, ["education", i, "id"]));
    facts.certifications.forEach((certification, i) =>
      register(certification.id, ["certifications", i, "id"])
    );
    facts.skills.forEach((skill, i) => register(skill.id, ["skills", i, "id"]));

    facts.skills.forEach((skill, i) => {
      skill.evidence.forEach((evidenceId, j) => {
        if (!seen.has(evidenceId) || evidenceId === skill.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["skills", i, "evidence", j],
            message: `Evidence id "${evidenceId}" does not match any experience, education or certification entry`
          });
        }
      });
    });
  });

export type CvFacts = z.infer<typeof CvFactsSchema>;
