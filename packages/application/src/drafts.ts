import { z } from "zod";

const FactIdSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/);

/**
 * A claim is any generated sentence that asserts something about the
 * candidate. Every claim MUST cite the authorized facts backing it (D07:
 * "toda frase generada debe incluir supporting_fact_ids internamente").
 */
export const ClaimSchema = z
  .object({
    text: z.string().min(1),
    supporting_fact_ids: z.array(FactIdSchema)
  })
  .strict();
export type Claim = z.infer<typeof ClaimSchema>;

/** Structured CV patch per plan §20.8 — never a free-form rewritten CV. */
export const CvPatchSchema = z
  .object({
    summary_revision: ClaimSchema,
    /** Fact ids of skills, reordered by relevance to the job. */
    reordered_skills: z.array(FactIdSchema),
    bullet_rewrites: z.array(
      z
        .object({
          original_id: FactIdSchema,
          revised_text: z.string().min(1),
          supporting_fact_ids: z.array(FactIdSchema).min(1)
        })
        .strict()
    ),
    omitted_irrelevant_items: z.array(FactIdSchema),
    /** Requirements the candidate does NOT meet; must never be claimed. */
    gaps_not_to_claim: z.array(z.string())
  })
  .strict();
export type CvPatch = z.infer<typeof CvPatchSchema>;

export const CoverLetterSchema = z
  .object({
    paragraphs: z.array(ClaimSchema).min(1),
    tone: z.string(),
    word_count: z.number().int().positive()
  })
  .strict();
export type CoverLetter = z.infer<typeof CoverLetterSchema>;

export const ApplicationAnswerSchema = z
  .object({
    question: z.string().min(1),
    /** Exactly one of answer / needs_user_input (plan §20.10). */
    answer: ClaimSchema.nullable(),
    needs_user_input: z.boolean()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.needs_user_input === (value.answer !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either an evidence-backed answer or needs_user_input, never both/neither"
      });
    }
  });
export type ApplicationAnswer = z.infer<typeof ApplicationAnswerSchema>;

export const ApplicationAnswersSchema = z
  .object({ answers: z.array(ApplicationAnswerSchema) })
  .strict();
export type ApplicationAnswers = z.infer<typeof ApplicationAnswersSchema>;
