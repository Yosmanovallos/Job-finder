import { z } from "zod";
import { fromZodError, readYamlFile } from "@job-radar/domain";

/**
 * File-based source configuration for Phase 2. The source_registry DB table
 * (plan section 7.3) arrives with persistence in Phase 3; until then the
 * config file is the only registry.
 */
export const SourceConfigSchema = z
  .object({
    id: z.string().min(1, "Must not be empty"),
    adapter: z.enum(["greenhouse"]),
    enabled: z.boolean().default(true),
    /** Company board token, e.g. the {board_token} in the Greenhouse API. */
    board_token: z.string().min(1, "Must not be empty"),
    /** Fallback display name when the API omits the company name. */
    company_name: z.string().min(1).optional(),
    rate_limit_per_minute: z.number().int().positive().default(30),
    concurrency: z.number().int().positive().default(1),
    notes: z.string().optional()
  })
  .strict();

export const SourcesFileSchema = z
  .object({
    sources: z.array(SourceConfigSchema).default([])
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.sources.forEach((source, i) => {
      if (seen.has(source.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sources", i, "id"],
          message: `Duplicate source id "${source.id}". Ids must be unique`
        });
      }
      seen.add(source.id);
    });
  });

export type SourceConfig = z.infer<typeof SourceConfigSchema>;
export type SourcesFile = z.infer<typeof SourcesFileSchema>;

export const DEFAULT_SOURCES_PATH = "config/sources.local.yaml";

const MISSING_SOURCES_HINT =
  "Copy config/sources.example.yaml to config/sources.local.yaml and list the boards you want to watch.";

export function loadSourcesConfig(path = DEFAULT_SOURCES_PATH): SourcesFile {
  const raw = readYamlFile(path, MISSING_SOURCES_HINT);
  const result = SourcesFileSchema.safeParse(raw);
  if (!result.success) {
    throw fromZodError(
      result.error,
      `Invalid sources config in ${path}. Fix the following and retry:`,
      "See config/sources.example.yaml for the expected structure."
    );
  }
  return result.data;
}
