// Fase 4 de docs/RESUME-STUDIO-PLAN.md — prueba el ProviderRegistry y el
// enrutado nuevo de ModelGateway.run(). Cero red real: un FakeAdapter
// sustituye a cualquier proveedor real, igual que fakeClient ya hace para
// el ModelClient inyectado de siempre. Corre contra Postgres real
// (llm_response_cache/llm_usage_ledger), limpia cada fila que toca.
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "../src/db/client.js";
import { ModelGateway, PromptOutputError, type PromptDefinition } from "../src/cv/model-gateway.js";
import { ModelsConfigSchema, type ModelsConfig } from "../src/cv/model-config.js";
import type { CompletionRequest, CompletionResult, ModelClient } from "../src/cv/model-client.js";
import { ProviderRegistry, UnknownProviderError } from "../src/ai-gateway/registry.js";
import type { GenerateRequest, GenerateResult, ProviderAdapter } from "../src/ai-gateway/provider-adapter.js";
import type { ModelCapabilities, ModelDescriptor } from "../src/ai-gateway/types.js";

const TEST_MODEL = "__test-model-fase4-yaml__";
const TEST_REGISTRY_MODEL = "__test-model-fase4-registry__";

function baseConfig(): ModelsConfig {
  return ModelsConfigSchema.parse({
    aliases: { test_alias: TEST_MODEL },
    pricing: { [TEST_MODEL]: { input_per_mtok: 1, output_per_mtok: 5 } },
    tasks: { test_task: { model_alias: "test_alias", max_output_tokens: 500 } },
    budgets: { max_daily_cloud_cost_usd: 1000, stop_on_budget_exceeded: true }
  });
}

const OutputSchema = z.object({ decision: z.string() }).strict();
type Output = z.infer<typeof OutputSchema>;

function makePrompt(): PromptDefinition<{ text: string }, Output> {
  return {
    name: "test_prompt_fase4",
    version: "v1",
    task: "test_task",
    active: true,
    schema: OutputSchema,
    render: (input) => ({ system: "system prompt", user: `<INPUT>\n${input.text}\n</INPUT>` })
  };
}

function fakeClient(responses: string[]): ModelClient & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    requests,
    async complete(request): Promise<CompletionResult> {
      requests.push(request);
      return { text: responses.shift() ?? "{}", inputTokens: 100, outputTokens: 50 };
    }
  };
}

/** Adapter falso registrado en un ProviderRegistry real — nunca toca la
 * red. Verifica que ModelGateway.run() de verdad delega a `generate()` del
 * adapter cuando el selector está presente, en vez del `client` inyectado. */
function fakeAdapter(providerId: string, responses: string[]): ProviderAdapter & { requests: GenerateRequest[] } {
  const requests: GenerateRequest[] = [];
  return {
    providerId,
    requests,
    async validateCredentials() {
      return { ok: true };
    },
    async listModels(): Promise<ModelDescriptor[]> {
      return [];
    },
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      requests.push(request);
      return { text: responses.shift() ?? "{}", inputTokens: 200, outputTokens: 80 };
    },
    getCapabilities(): ModelCapabilities {
      return { text: true, vision: false, structuredOutput: false, tools: false, streaming: false };
    }
  };
}

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    console.log(`✅ [PASSED] ${label}`);
  } else {
    console.error(`❌ [FAILED] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

/** Debe coincidir EXACTO con la construcción de key real de
 * `ModelGateway.run()` (sin scope de usuario — ninguna prueba de este
 * archivo pasa `credentialSource: "user_byok"`, eso ya lo cubre Fase 2 en
 * validate-cv-gateway.ts). Precomputar por (model, text) en vez de barrer
 * por contenido de la respuesta — un cleanup que filtra por el OUTPUT
 * cacheado, no por la key real, deja filas huérfanas de corridas previas
 * que después producen falsos negativos por cache-hit inesperado (bug
 * real encontrado corriendo este mismo archivo la primera vez). */
function cacheKeyFor(model: string, text: string): string {
  const prompt = makePrompt();
  const rendered = prompt.render({ text });
  return createHash("sha256")
    .update([prompt.name, prompt.version, model, rendered.system, rendered.user].join(" "))
    .digest("hex");
}

// Cada (model, text) que una prueba de abajo espera que SÍ complete y
// escriba en cache — mantenido en un solo lugar para que cleanup() nunca
// quede desincronizado de lo que las pruebas realmente generan.
const CACHE_WRITING_CALLS: Array<[string, string]> = [
  [TEST_MODEL, "fase4 sin selector"], // Test 2
  [TEST_REGISTRY_MODEL, "fase4 con selector"], // Test 3
  [TEST_MODEL, "fase4 selector parcial"], // Test 4
  [TEST_REGISTRY_MODEL, "fase4 costo cero para BYOK"] // Test 6
];

async function cleanup() {
  await pool.query(`DELETE FROM llm_usage_ledger WHERE model = ANY($1)`, [[TEST_MODEL, TEST_REGISTRY_MODEL]]);
  const keys = CACHE_WRITING_CALLS.map(([model, text]) => cacheKeyFor(model, text));
  await pool.query(`DELETE FROM llm_response_cache WHERE key = ANY($1)`, [keys]);
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — ProviderRegistry + enrutado de ModelGateway (Fase 4, sin red real)`);
  console.log(`==================================================\n`);

  await cleanup();

  try {
    console.log(`🔍 [Test 1] ProviderRegistry: register/get/has/list...`);
    {
      const registry = new ProviderRegistry();
      check("Vacío al crear", registry.list().length === 0);
      registry.register(fakeAdapter("fake-provider", []));
      check("has() encuentra el proveedor registrado", registry.has("fake-provider"));
      check("get() devuelve el mismo adapter", registry.get("fake-provider").providerId === "fake-provider");
      check("list() lo incluye", registry.list().includes("fake-provider"));
      let thrown: unknown;
      try {
        registry.get("no-existe");
      } catch (e) {
        thrown = e;
      }
      check("get() de un proveedor no registrado lanza UnknownProviderError", thrown instanceof UnknownProviderError);
    }

    console.log(`\n🔍 [Test 2] Sin selector (providerId/modelId/apiKey), ModelGateway.run() se comporta EXACTAMENTE igual que antes de Fase 4...`);
    {
      const client = fakeClient([JSON.stringify({ decision: "ok" })]);
      const registry = new ProviderRegistry();
      const adapter = fakeAdapter("unused-provider", []);
      registry.register(adapter);
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true, providerRegistry: registry });

      const result = await gateway.run(makePrompt(), { text: "fase4 sin selector" });
      check("Resuelve con el output esperado", result.output.decision === "ok");
      check("Usó el client inyectado de siempre (YAML alias)", client.requests.length === 1 && client.requests[0]?.model === TEST_MODEL);
      check("NUNCA llamó al adapter del registry (aunque estaba registrado)", adapter.requests.length === 0);
    }

    console.log(`\n🔍 [Test 3] Con selector completo (providerId+modelId+apiKey), delega al adapter del registry, NUNCA al client inyectado...`);
    {
      const client = fakeClient([JSON.stringify({ decision: "nunca debería llamarse" })]);
      const registry = new ProviderRegistry();
      const adapter = fakeAdapter("byok-provider", [JSON.stringify({ decision: "desde-el-adapter" })]);
      registry.register(adapter);
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true, providerRegistry: registry });

      // Sin userId a propósito: esto prueba enrutado del registry, no
      // scoping de cache por usuario (eso ya lo cubre validate-cv-gateway.ts
      // Fase 2, con usuarios reales por la FK de llm_usage_ledger.user_id).
      const result = await gateway.run(
        makePrompt(),
        { text: "fase4 con selector" },
        { providerId: "byok-provider", modelId: TEST_REGISTRY_MODEL, apiKey: "sk-fake-key" }
      );
      check("Resuelve con el output del ADAPTER, no del client", result.output.decision === "desde-el-adapter");
      check("El client inyectado NUNCA se llamó", client.requests.length === 0);
      check("El adapter recibió exactamente 1 request", adapter.requests.length === 1);
      check("El adapter recibió el modelId del selector, no el alias YAML", adapter.requests[0]?.model === TEST_REGISTRY_MODEL);
      check("El adapter recibió la apiKey del contexto", adapter.requests[0]?.apiKey === "sk-fake-key");
    }

    console.log(`\n🔍 [Test 4] Selector parcial (falta un campo) NO activa el registry — cae al client de siempre...`);
    {
      const client = fakeClient([JSON.stringify({ decision: "ok-fallback" })]);
      const registry = new ProviderRegistry();
      const adapter = fakeAdapter("partial-provider", []);
      registry.register(adapter);
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true, providerRegistry: registry });

      // providerId presente, pero SIN modelId ni apiKey.
      const result = await gateway.run(
        makePrompt(),
        { text: "fase4 selector parcial" },
        { providerId: "partial-provider" }
      );
      check("Con selector incompleto, resuelve vía el client de siempre", result.output.decision === "ok-fallback");
      check("El adapter nunca se llamó", adapter.requests.length === 0);
    }

    console.log(`\n🔍 [Test 5] Selector completo pero SIN providerRegistry en el constructor → error explícito, nunca un intento silencioso...`);
    {
      const client = fakeClient([JSON.stringify({ decision: "no debería llegar" })]);
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true }); // sin providerRegistry

      let thrown: unknown;
      try {
        await gateway.run(
          makePrompt(),
          { text: "fase4 sin registry en el constructor" },
          { providerId: "google", modelId: TEST_REGISTRY_MODEL, apiKey: "sk-fake" }
        );
      } catch (e) {
        thrown = e;
      }
      check("Lanza un error explícito, no un fallback silencioso al client viejo", thrown instanceof Error, String(thrown));
      check("Cero llamadas al client (nunca corrió nada a medias)", client.requests.length === 0);
    }

    console.log(`\n🔍 [Test 6] Un modelId del registry sin pricing conocido en la config cachea con costo $0 — el operador nunca paga por BYOK...`);
    {
      const client = fakeClient([]);
      const registry = new ProviderRegistry();
      const adapter = fakeAdapter("cost-check-provider", [JSON.stringify({ decision: "sin-costo-operador" })]);
      registry.register(adapter);
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true, providerRegistry: registry });

      await gateway.run(
        makePrompt(),
        { text: "fase4 costo cero para BYOK" },
        { providerId: "cost-check-provider", modelId: TEST_REGISTRY_MODEL, apiKey: "sk-fake" }
      );
      const { rows } = await pool.query<{ cost_usd: string }>(
        `SELECT cost_usd FROM llm_usage_ledger WHERE model = $1 ORDER BY ts DESC LIMIT 1`,
        [TEST_REGISTRY_MODEL]
      );
      check("cost_usd = 0 en el ledger (sin pricing configurado para este modelId, correcto: lo pagó el usuario, no el operador)", Number(rows[0]?.cost_usd) === 0, JSON.stringify(rows[0]));
    }
  } finally {
    await cleanup();
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] ProviderRegistry + enrutado de ModelGateway (Fase 4) verificados, cero red real.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  process.exit(1);
});
