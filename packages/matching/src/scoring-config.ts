import { z } from "zod";
import { fromZodError, readYamlFile } from "@job-radar/domain";

/** Scoring weights per plan §13.2; overridable via config/scoring.local.yaml. */
export const ScoringConfigSchema = z
  .object({
    scoring_version: z.string().default("baseline-1"),
    weights: z
      .object({
        responsibilities: z.number().default(20),
        must_have_skills: z.number().default(20),
        preferred_skills: z.number().default(10),
        seniority: z.number().default(15),
        location: z.number().default(15),
        industry: z.number().default(5),
        compensation: z.number().default(5),
        language: z.number().default(5),
        freshness: z.number().default(3),
        data_quality: z.number().default(2)
      })
      .strict()
      .default({}),
    penalties: z
      .object({
        probable_blocker: z.number().default(40),
        possibly_closed: z.number().default(20),
        risk: z.number().default(30)
      })
      .strict()
      .default({}),
    thresholds: z
      .object({
        priority: z.number().default(70),
        consider: z.number().default(45)
      })
      .strict()
      .default({})
  })
  .strict();

export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;

export const DEFAULT_SCORING_PATH = "config/scoring.local.yaml";

export function defaultScoringConfig(): ScoringConfig {
  return ScoringConfigSchema.parse({});
}

export function loadScoringConfig(path = DEFAULT_SCORING_PATH): ScoringConfig {
  const raw = readYamlFile(
    path,
    "Copy config/scoring.example.yaml to config/scoring.local.yaml or omit --scoring to use defaults."
  );
  const result = ScoringConfigSchema.safeParse(raw);
  if (!result.success) {
    throw fromZodError(result.error, `Invalid scoring config in ${path}:`);
  }
  return result.data;
}
