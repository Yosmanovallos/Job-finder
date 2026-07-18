import { z } from "zod";
import { fromZodError, readYamlFile } from "@job-radar/domain";

/** Model routing config (plan §15.2). Aliases resolve here — never in code. */
export const ModelsConfigSchema = z
  .object({
    providers: z
      .object({
        anthropic: z.object({ enabled: z.boolean().default(true) }).strict().default({}),
        openai_compatible: z
          .object({
            enabled: z.boolean().default(false),
            base_url_env: z.string().optional()
          })
          .strict()
          .default({}),
        ollama: z
          .object({
            enabled: z.boolean().default(false),
            base_url: z.string().optional()
          })
          .strict()
          .default({})
      })
      .strict()
      .default({}),
    aliases: z.record(z.string(), z.string()).default({}),
    pricing: z
      .record(
        z.string(),
        z
          .object({
            input_per_mtok: z.number().nonnegative(),
            output_per_mtok: z.number().nonnegative()
          })
          .strict()
      )
      .default({}),
    tasks: z
      .record(
        z.string(),
        z
          .object({
            model_alias: z.string(),
            fallback_alias: z.string().optional(),
            max_output_tokens: z.number().int().positive().default(1000)
          })
          .strict()
      )
      .default({}),
    budgets: z
      .object({
        max_llm_jobs_per_run: z.number().int().positive().default(20),
        max_reasoning_high_calls_per_run: z.number().int().positive().default(3),
        max_daily_cloud_cost_usd: z.number().positive().default(1.0),
        stop_on_budget_exceeded: z.boolean().default(true)
      })
      .strict()
      .default({})
  })
  .strict();

export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

export const DEFAULT_MODELS_PATH = "config/models.local.yaml";

export function loadModelsConfig(path = DEFAULT_MODELS_PATH): ModelsConfig {
  const raw = readYamlFile(
    path,
    "Copy config/models.example.yaml to config/models.local.yaml to configure model routing."
  );
  const result = ModelsConfigSchema.safeParse(raw);
  if (!result.success) {
    throw fromZodError(result.error, `Invalid models config in ${path}:`);
  }
  return result.data;
}

export function resolveModel(config: ModelsConfig, task: string): {
  model: string;
  maxOutputTokens: number;
} {
  const taskConfig = config.tasks[task];
  if (!taskConfig) {
    throw new Error(`Task "${task}" is not configured in the models config`);
  }
  const model = config.aliases[taskConfig.model_alias];
  if (!model || model === "none") {
    const fallback = taskConfig.fallback_alias ? config.aliases[taskConfig.fallback_alias] : null;
    if (!fallback || fallback === "none") {
      throw new Error(
        `Alias "${taskConfig.model_alias}" for task "${task}" resolves to no model and has no usable fallback`
      );
    }
    return { model: fallback, maxOutputTokens: taskConfig.max_output_tokens };
  }
  return { model, maxOutputTokens: taskConfig.max_output_tokens };
}

export function costUsd(
  config: ModelsConfig,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = config.pricing[model];
  if (!pricing) {
    return 0;
  }
  return (
    (inputTokens / 1_000_000) * pricing.input_per_mtok +
    (outputTokens / 1_000_000) * pricing.output_per_mtok
  );
}
