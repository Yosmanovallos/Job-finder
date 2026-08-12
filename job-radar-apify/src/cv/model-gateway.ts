import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { z } from "zod";
import type { ModelClient } from "./model-client.js";
import { costUsd, resolveModel, type ModelsConfig } from "./model-config.js";
import type { ProviderRegistry } from "../ai-gateway/registry.js";

/**
 * Versioned prompt contract (AGENTS.md regla 11): every prompt has a
 * version, an output schema, a token budget (via its task's
 * max_output_tokens) and an activation flag. Prompts ship inactive until
 * they pass their evaluation gates (docs/CV-GENERATION-PLAN.md Fase 8).
 */
export interface PromptDefinition<TInput, TOutput> {
  name: string;
  version: string;
  task: string;
  /** Inactive prompts refuse to run unless explicitly allowed (evals). */
  active: boolean;
  schema: z.ZodType<TOutput>;
  render(input: TInput): { system: string; user: string };
}

/** Attribution for the usage ledger — both optional (e.g. eval runs have neither). */
export interface RunContext {
  userId?: string;
  cvGenerationId?: string;
  /**
   * Fase 2 de docs/RESUME-STUDIO-PLAN.md — de dónde sale la credencial que
   * paga esta llamada. Ausente, o `"operator_fallback"`, mantiene el
   * comportamiento de siempre: cache global compartida entre todos los
   * usuarios (el operador financia por igual, compartir la respuesta a un
   * prompt idéntico solo ahorra dinero, nunca filtra nada). `"user_byok"`
   * fuerza la cache a scoping por `userId`+`providerId` — NUNCA compartida
   * entre usuarios, incluso si prompt/modelo/texto son idénticos, porque la
   * respuesta la pagó una key que no es del operador. Ningún caller real
   * pasa `"user_byok"` todavía (BYOK llega en Fase 4/5) — este campo existe
   * desde ahora para que el fix esté listo ANTES de que el primer proveedor
   * BYOK se conecte, no después (el bug que arregla: sin esto, una
   * respuesta pagada con la key de un usuario podría servirse a otro).
   */
  credentialSource?: "user_byok" | "operator_fallback";
  /** Requerido cuando `credentialSource === "user_byok"` — id del proveedor
   * (`"google"`, `"anthropic"`, etc.) cuya key financió la llamada. */
  providerId?: string;
  /**
   * Fase 4 de docs/RESUME-STUDIO-PLAN.md — enrutamiento explícito vía el
   * `ProviderRegistry` en vez del alias YAML de siempre. Los TRES campos
   * (`providerId`, `modelId`, `apiKey`) deben venir juntos o ninguno —
   * `run()` solo activa el camino de registry cuando los tres están
   * presentes; con cualquiera ausente, resuelve exactamente igual que
   * hoy (`resolveModel()` sobre `config/models.*.yaml`, el único cliente
   * inyectado en el constructor). Ningún caller real de este proyecto
   * pasa estos dos campos todavía — Fase 5 es quien resuelve una
   * credencial real y se los pasa por primera vez.
   */
  modelId?: string;
  /** Ya descifrada — quien arma este `RunContext` (Fase 5,
   * `credential-resolver.ts`) es responsable de descifrarla antes; el
   * gateway nunca toca `credential-crypto.ts` directamente. */
  apiKey?: string;
}

export class BudgetExceededError extends Error {
  constructor(detail: string) {
    super(`LLM budget exceeded: ${detail}`);
    this.name = "BudgetExceededError";
  }
}

export class PromptOutputError extends Error {
  constructor(prompt: string, detail: string) {
    super(`Prompt ${prompt} produced invalid output: ${detail}`);
    this.name = "PromptOutputError";
  }
}

export class InactivePromptError extends Error {
  constructor(prompt: string) {
    super(
      `Prompt ${prompt} is not active: it has not passed its evaluation gates yet. ` +
        "Run it only through evals (allowInactive) until gates pass."
    );
    this.name = "InactivePromptError";
  }
}

export interface GatewayOptions {
  config: ModelsConfig;
  client: ModelClient;
  /** `pg` pool — cache and ledger live in Postgres, not on disk (Render
   * free tier's disk is ephemeral, see docs/CV-GENERATION-PLAN.md §6.1). */
  pool: Pool;
  /** Evals may run inactive prompts; production never sets this. */
  allowInactive?: boolean;
  now?: () => Date;
  /** Fase 4 de docs/RESUME-STUDIO-PLAN.md — opcional, solo lo necesitan
   * los callers que alguna vez pasen `RunContext.providerId`/`modelId`/
   * `apiKey` a `run()`. Ausente = el gateway se comporta exactamente
   * igual que antes de esta fase (nunca intenta resolver un registry que
   * no existe). */
  providerRegistry?: ProviderRegistry;
}

export interface RunStats {
  calls: number;
  cacheHits: number;
  costUsd: number;
}

/**
 * Native model gateway for job-radar-apify (docs/CV-GENERATION-PLAN.md
 * §6.1) — port of the root project's `packages/models/src/gateway.ts`
 * (alias resolution, per-hash cache, daily budget, schema-validated JSON
 * outputs, cost logging), adapted to Postgres-backed cache/ledger tables
 * (`llm_response_cache`, `llm_usage_ledger`) instead of files under
 * `var/`. External content flows only through prompt renderers, which
 * wrap it in delimiters — the gateway itself never interprets model text
 * beyond JSON parsing.
 */
export class ModelGateway {
  private readonly config: ModelsConfig;
  private readonly client: ModelClient;
  private readonly pool: Pool;
  private readonly allowInactive: boolean;
  private readonly now: () => Date;
  private readonly providerRegistry: ProviderRegistry | undefined;
  readonly stats: RunStats = { calls: 0, cacheHits: 0, costUsd: 0 };

  get budgets(): ModelsConfig["budgets"] {
    return this.config.budgets;
  }

  constructor(options: GatewayOptions) {
    this.config = options.config;
    this.client = options.client;
    this.pool = options.pool;
    this.allowInactive = options.allowInactive ?? false;
    this.now = options.now ?? (() => new Date());
    this.providerRegistry = options.providerRegistry;
  }

  /** Sum of today's cloud cost from the ledger (persisted across deploys/restarts). */
  private async dailyCostUsd(): Promise<number> {
    const todayStart = new Date(this.now());
    todayStart.setUTCHours(0, 0, 0, 0);
    const { rows } = await this.pool.query<{ total: string | null }>(
      `SELECT SUM(cost_usd) AS total FROM llm_usage_ledger WHERE ts >= $1 AND cached = false`,
      [todayStart]
    );
    return Number(rows[0]?.total ?? 0);
  }

  private async log(entry: {
    task: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    cached: boolean;
    context?: RunContext;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO llm_usage_ledger
         (ts, user_id, stage, model, input_tokens, output_tokens, cost_usd, cached, cv_generation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        this.now(),
        entry.context?.userId ?? null,
        entry.task,
        entry.model,
        entry.inputTokens,
        entry.outputTokens,
        entry.costUsd,
        entry.cached,
        entry.context?.cvGenerationId ?? null
      ]
    );
  }

  private async checkBudgets(task: string): Promise<void> {
    const budgets = this.config.budgets;
    if (!budgets.stop_on_budget_exceeded) {
      return;
    }
    const daily = (await this.dailyCostUsd()) + this.stats.costUsd;
    if (daily >= budgets.max_daily_cloud_cost_usd) {
      throw new BudgetExceededError(
        `max_daily_cloud_cost_usd (${budgets.max_daily_cloud_cost_usd}) reached (spent ~$${daily.toFixed(4)}) for task ${task}`
      );
    }
  }

  private async readCache<TOutput>(
    key: string,
    schema: z.ZodType<TOutput>
  ): Promise<TOutput | null> {
    const { rows } = await this.pool.query<{ output_json: unknown }>(
      `SELECT output_json FROM llm_response_cache WHERE key = $1`,
      [key]
    );
    if (rows.length === 0) {
      return null;
    }
    const parsed = schema.safeParse(rows[0]!.output_json);
    return parsed.success ? parsed.data : null;
  }

  /** `scope` es `null` para el fallback del operador (fila global, igual que
   * siempre) — solo se puebla `user_id`/`provider_id` cuando la llamada la
   * pagó la key propia de un usuario (Fase 2, ver `RunContext.credentialSource`). */
  private async writeCache(
    key: string,
    output: unknown,
    scope: { userId: string; providerId: string } | null
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO llm_response_cache (key, output_json, user_id, provider_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(output), scope?.userId ?? null, scope?.providerId ?? null]
    );
  }

  async run<TInput, TOutput>(
    prompt: PromptDefinition<TInput, TOutput>,
    input: TInput,
    context?: RunContext
  ): Promise<{ output: TOutput; cached: boolean }> {
    if (!prompt.active && !this.allowInactive) {
      throw new InactivePromptError(prompt.name);
    }
    // Fase 4 de docs/RESUME-STUDIO-PLAN.md: `maxOutputTokens` sigue
    // saliendo SIEMPRE del presupuesto por tarea en YAML — es un límite de
    // esta aplicación para esa etapa (§6.3 de CV-GENERATION-PLAN.md), no
    // algo que deba variar según qué proveedor atienda la llamada. Lo
    // único que cambia con el registry es QUÉ modelo/adapter genera la
    // respuesta, nunca cuántos tokens se le permiten.
    const resolvedFromConfig = resolveModel(this.config, prompt.task);
    const maxOutputTokens = resolvedFromConfig.maxOutputTokens;

    const useRegistry = !!(context?.providerId && context?.modelId && context?.apiKey);
    if (useRegistry && !this.providerRegistry) {
      throw new Error(
        "RunContext trae providerId/modelId/apiKey pero este ModelGateway no recibió un providerRegistry en su constructor."
      );
    }
    const model = useRegistry ? context!.modelId! : resolvedFromConfig.model;
    const rendered = prompt.render(input);

    // Fase 2 de docs/RESUME-STUDIO-PLAN.md: solo "user_byok" scopea la key
    // por usuario+proveedor — cualquier otro valor (incluido `undefined`,
    // el caso de TODO caller real hoy) mantiene la key global de siempre,
    // cero regresión de cache-hit rate para el camino financiado por el
    // operador.
    let scope: { userId: string; providerId: string } | null = null;
    if (context?.credentialSource === "user_byok") {
      if (!context.userId || !context.providerId) {
        throw new Error(
          'RunContext.credentialSource "user_byok" requiere userId y providerId — sin ambos, la key no puede scopearse de forma segura.'
        );
      }
      scope = { userId: context.userId, providerId: context.providerId };
    }
    const keyMaterial = [prompt.name, prompt.version, model, rendered.system, rendered.user];
    if (scope) keyMaterial.push(scope.userId, scope.providerId);
    const key = createHash("sha256").update(keyMaterial.join(" ")).digest("hex");

    const cached = await this.readCache(key, prompt.schema);
    if (cached !== null) {
      this.stats.cacheHits += 1;
      return { output: cached, cached: true };
    }

    await this.checkBudgets(prompt.task);

    let lastDetail = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const user =
        attempt === 0
          ? rendered.user
          : rendered.user +
            "\n\nYour previous answer was not valid JSON for the required schema. " +
            "Return ONLY a valid JSON object matching the schema, with no extra text.";
      // Fase 4: enrutado por registry, un adapter real habla con el
      // proveedor de la key BYOK; si no, el único `ModelClient` inyectado
      // de siempre (comportamiento idéntico a antes de esta fase).
      const result = useRegistry
        ? await this.providerRegistry!.get(context!.providerId!).generate({
            model,
            system: rendered.system,
            user,
            maxOutputTokens,
            apiKey: context!.apiKey!
          })
        : await this.client.complete({ model, system: rendered.system, user, maxOutputTokens });
      // Sin pricing conocido para el modelo (siempre el caso hoy para
      // cualquier modelo BYOK — `config.pricing` solo trae los alias
      // operador-financiados de config/models.*.yaml), `costUsd()` ya
      // devuelve $0 — correcto aquí: el operador no gastó nada, la key la
      // pagó el usuario, y el circuit breaker diario (§6.1) protege el
      // gasto del OPERADOR, no el del usuario.
      const cost = costUsd(this.config, model, result.inputTokens, result.outputTokens);
      this.stats.calls += 1;
      this.stats.costUsd += cost;
      await this.log({
        task: prompt.task,
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: cost,
        cached: false,
        context
      });

      const json = extractJson(result.text);
      if (json === null) {
        lastDetail = "no JSON object found in the response";
        continue;
      }
      const parsed = prompt.schema.safeParse(json);
      if (!parsed.success) {
        lastDetail = parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.code}`)
          .join("; ");
        continue;
      }
      await this.writeCache(key, parsed.data, scope);
      return { output: parsed.data, cached: false };
    }
    throw new PromptOutputError(prompt.name, lastDetail);
  }
}

/** Extracts the first JSON object from model text without executing anything. */
function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}
