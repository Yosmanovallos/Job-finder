import { z } from "zod";

/**
 * `CvFacts` — the fact vault a CV is ever allowed to draw from
 * (docs/CV-GENERATION-PLAN.md §3.1). Etapa A (Fase 2b) is the only writer;
 * every downstream stage may only cite ids that exist here, never invent
 * new ones (AGENTS.md regla 5).
 */
export const FactId = z.string().regex(/^[a-z][a-z0-9_-]*$/);

export const CvFactsSchema = z
  .object({
    contact: z
      .object({
        name: z.string(),
        email: z.string().email().nullable(),
        phone: z.string().nullable(),
        location: z.string().nullable(),
        linkedin: z.string().url().nullable()
      })
      .strict(),
    summary_raw: z.string().nullable(),
    experience: z.array(
      z
        .object({
          id: FactId,
          title: z.string(),
          company: z.string(),
          start_date: z.string().nullable(),
          end_date: z.string().nullable(),
          achievements: z.array(
            z
              .object({
                id: FactId,
                statement: z.string(),
                metric: z.string().nullable()
              })
              .strict()
          )
        })
        .strict()
    ),
    skills: z.array(z.object({ id: FactId, name: z.string(), category: z.string().nullable() }).strict()),
    education: z.array(
      z
        .object({
          id: FactId,
          institution: z.string(),
          degree: z.string(),
          end_date: z.string().nullable()
        })
        .strict()
    ),
    certifications: z.array(
      z
        .object({ id: FactId, name: z.string(), issuer: z.string().nullable(), date: z.string().nullable() })
        .strict()
    ),
    languages: z.array(z.object({ id: FactId, name: z.string(), level: z.string().nullable() }).strict())
  })
  .strict();

export type CvFacts = z.infer<typeof CvFactsSchema>;
