import { readFileSync } from "node:fs";
import { z } from "zod";
import { parse as parseYaml } from "yaml";

/**
 * Model routing config for the CV-generation gateway
 * (docs/CV-GENERATION-PLAN.md §6.1). Same shape/spirit as the root
 * project's `packages/models/src/model-config.ts`, adapted for a
 * multi-tenant live server instead of a single-user batch script:
 *
 * - No `max_llm_jobs_per_run`/`max_reasoning_high_calls_per_run` — those
 *   are "per script execution" concepts from a batch tool; a persistent
 *   HTTP server has no equivalent "run" boundary. The protection those
 *   gave (bounding how much a single invocation can spend) is instead
 *   provided by the per-user credit reservation (§6.2) plus the daily $
 *   circuit breaker below.
 * - `max_daily_cloud_cost_usd` is THIS subproject's own number, sized for
 *   its real multi-tenant volume — never copy the root project's
 *   example value of $1.00 (that's a single-user MVP budget, see the
 *   explicit warning in docs/CV-GENERATION-PLAN.md §6.1).
 */
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
        max_daily_cloud_cost_usd: z.number().positive(),
        stop_on_budget_exceeded: z.boolean().default(true)
      })
      .strict()
  })
  .strict();

export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

// config/models.local.yaml is gitignored (real keys/aliases for this
// deploy); config/models.dev.yaml (§5.1) points every alias at
// free/local models for prompt-tuning. Neither is required to exist yet
// in Fase 1 — callers construct a ModelsConfig object directly until
// Fase 2/3 populate real tasks/prompts.
export const DEFAULT_MODELS_PATH = "config/models.local.yaml";

export function loadModelsConfig(path = DEFAULT_MODELS_PATH): ModelsConfig {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, "utf8"));
  } catch (err: any) {
    throw new Error(
      `No se pudo leer/parsear ${path}: ${err.message}. ` +
        "Copia config/models.dev.yaml (modelos gratuitos) o config/models.example.yaml a ese path para configurar el routing de modelos."
    );
  }
  const result = ModelsConfigSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Config de modelos inválida en ${path}: ${detail}`);
  }
  return result.data;
}

export function resolveModel(
  config: ModelsConfig,
  task: string
): {
  model: string;
  maxOutputTokens: number;
} {
  const taskConfig = config.tasks[task];
  if (!taskConfig) {
    throw new Error(`Task "${task}" no está configurada en la config de modelos`);
  }
  const model = config.aliases[taskConfig.model_alias];
  if (!model || model === "none") {
    const fallback = taskConfig.fallback_alias ? config.aliases[taskConfig.fallback_alias] : null;
    if (!fallback || fallback === "none") {
      throw new Error(
        `El alias "${taskConfig.model_alias}" del task "${task}" no resuelve a ningún modelo y no tiene fallback usable`
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
