// Fase 4 de docs/RESUME-STUDIO-PLAN.md — prueba los 5 ProviderAdapter
// contra un `fetch` global simulado (ninguna key real de Anthropic/OpenAI/
// OpenRouter/Ollama existe en este entorno). Verifica que cada adapter
// construye el request correcto (headers, body, URL) para el contrato
// público de cada proveedor y parsea bien una respuesta realista — no que
// el proveedor real responda exactamente así (eso lo confirma quien
// conecte la primera key real en Fase 5/6).
import { GoogleProviderAdapter } from "../src/ai-gateway/adapters/google.js";
import { AnthropicProviderAdapter } from "../src/ai-gateway/adapters/anthropic.js";
import { OpenAiProviderAdapter } from "../src/ai-gateway/adapters/openai.js";
import { OpenRouterProviderAdapter } from "../src/ai-gateway/adapters/openrouter.js";
import { OllamaProviderAdapter } from "../src/ai-gateway/adapters/ollama.js";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    console.log(`✅ [PASSED] ${label}`);
  } else {
    console.error(`❌ [FAILED] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

interface FakeResponse {
  status: number;
  body: unknown;
}
interface FetchCall {
  url: string;
  init?: RequestInit;
}

/** Reemplaza `globalThis.fetch` por una cola de respuestas fijas — cada
 * adapter usa `fetch` directo (mismo patrón zero-SDK que
 * `OpenAiCompatibleClient` ya establecido), así que esto cubre los 5 sin
 * necesitar 5 mecanismos de mock distintos. */
function mockFetch(responses: FakeResponse[]): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body
    } as Response;
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Adapters de proveedor (Fase 4, fetch simulado, sin red real)`);
  console.log(`==================================================\n`);

  console.log(`🔍 [Google] generate() delega en OpenAiCompatibleClient, validateCredentials/listModels contra la API nativa...`);
  {
    const adapter = new GoogleProviderAdapter();

    {
      const mock = mockFetch([{ status: 200, body: { models: [] } }]);
      const result = await adapter.validateCredentials("fake-key");
      mock.restore();
      check("validateCredentials: 200 → ok:true", result.ok === true);
      check("validateCredentials: llama a v1beta/models con la key en query", mock.calls[0]!.url.includes("v1beta/models") && mock.calls[0]!.url.includes("fake-key"));
    }
    {
      const mock = mockFetch([{ status: 401, body: {} }]);
      const result = await adapter.validateCredentials("bad-key");
      mock.restore();
      check("validateCredentials: 401 → ok:false", result.ok === false);
    }
    {
      const mock = mockFetch([
        {
          status: 200,
          body: {
            models: [
              { name: "models/gemini-3.6-flash", displayName: "Gemini 3.6 Flash", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1000000, outputTokenLimit: 8192 },
              { name: "models/gemini-embedding-001", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] } // debe filtrarse
            ]
          }
        }
      ]);
      const models = await adapter.listModels("fake-key");
      mock.restore();
      check("listModels: solo trae generateContent (filtra embeddings)", models.length === 1, JSON.stringify(models));
      check('listModels: id compuesto "google:gemini-3.6-flash"', models[0]?.id === "google:gemini-3.6-flash");
      check("listModels: modelId sin el prefijo models/", models[0]?.modelId === "gemini-3.6-flash");
      check("listModels: contextWindowTokens real de la respuesta", models[0]?.contextWindowTokens === 1000000);
    }
    {
      const mock = mockFetch([{ status: 200, body: { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } }]);
      const result = await adapter.generate({ model: "gemini-3.6-flash", system: "sys", user: "usr", maxOutputTokens: 100, apiKey: "fake-key" });
      mock.restore();
      check("generate(): devuelve el texto del choice", result.text === '{"ok":true}');
      check("generate(): tokens desde usage real", result.inputTokens === 10 && result.outputTokens === 5);
      check("generate(): manda Authorization Bearer con la apiKey del request", (mock.calls[0]!.init?.headers as Record<string, string>)?.Authorization === "Bearer fake-key");
    }
  }

  console.log(`\n🔍 [Anthropic] Messages API real (no compatible con OpenAI) — headers x-api-key/anthropic-version, content como array de bloques...`);
  {
    const adapter = new AnthropicProviderAdapter();
    {
      const mock = mockFetch([{ status: 200, body: { data: [] } }]);
      const result = await adapter.validateCredentials("fake-key");
      mock.restore();
      check("validateCredentials: 200 → ok:true", result.ok === true);
      const headers = mock.calls[0]!.init?.headers as Record<string, string>;
      check('validateCredentials: manda x-api-key (NUNCA Authorization Bearer)', headers?.["x-api-key"] === "fake-key");
      check("validateCredentials: manda anthropic-version", headers?.["anthropic-version"] === "2023-06-01");
    }
    {
      const mock = mockFetch([{ status: 403, body: {} }]);
      const result = await adapter.validateCredentials("bad-key");
      mock.restore();
      check("validateCredentials: 403 → ok:false", result.ok === false);
    }
    {
      const mock = mockFetch([{ status: 200, body: { data: [{ id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" }] } }]);
      const models = await adapter.listModels("fake-key");
      mock.restore();
      check("listModels: mapea id/displayName reales", models[0]?.modelId === "claude-haiku-4-5" && models[0]?.displayName === "Claude Haiku 4.5");
      check('listModels: id compuesto "anthropic:claude-haiku-4-5"', models[0]?.id === "anthropic:claude-haiku-4-5");
    }
    {
      const mock = mockFetch([{ status: 200, body: { content: [{ type: "text", text: '{"ok":true}' }], usage: { input_tokens: 20, output_tokens: 8 } } }]);
      const result = await adapter.generate({ model: "claude-haiku-4-5", system: "sys", user: "usr", maxOutputTokens: 100, apiKey: "fake-key" });
      mock.restore();
      check("generate(): extrae el bloque type=text", result.text === '{"ok":true}');
      check("generate(): tokens desde usage real (input_tokens/output_tokens, no prompt_tokens)", result.inputTokens === 20 && result.outputTokens === 8);
      const sentBody = JSON.parse(String(mock.calls[0]!.init?.body));
      check('generate(): "system" va como campo top-level, NUNCA como mensaje de rol "system"', sentBody.system === "sys" && !sentBody.messages.some((m: { role: string }) => m.role === "system"));
      check("generate(): max_tokens (no max_output_tokens) en el body", sentBody.max_tokens === 100);
    }
  }

  console.log(`\n🔍 [OpenAI] Chat Completions vía OpenAiCompatibleClient (mismo formato de siempre, solo cambia baseUrl)...`);
  {
    const adapter = new OpenAiProviderAdapter();
    {
      const mock = mockFetch([{ status: 200, body: { data: [{ id: "gpt-5" }] } }]);
      const models = await adapter.listModels("fake-key");
      mock.restore();
      check("listModels: apunta a api.openai.com", mock.calls[0]!.url.startsWith("https://api.openai.com/v1/models"));
      check("listModels: mapea el id real", models[0]?.modelId === "gpt-5");
    }
    {
      const mock = mockFetch([{ status: 200, body: { choices: [{ message: { content: "hola" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } }]);
      await adapter.generate({ model: "gpt-5", system: "sys", user: "usr", maxOutputTokens: 50, apiKey: "fake-key" });
      mock.restore();
      check("generate(): pega contra api.openai.com/v1/chat/completions", mock.calls[0]!.url === "https://api.openai.com/v1/chat/completions");
    }
  }

  console.log(`\n🔍 [OpenRouter] Igual que OpenAI + pricing/context_length reales de la respuesta (no conservador como los demás)...`);
  {
    const adapter = new OpenRouterProviderAdapter();
    const mock = mockFetch([
      { status: 200, body: { data: [{ id: "deepseek/deepseek-v4", name: "DeepSeek V4", context_length: 128000, pricing: { prompt: "0.0000008", completion: "0.0000024" } }] } }
    ]);
    const models = await adapter.listModels("fake-key");
    mock.restore();
    check("listModels: apunta a openrouter.ai", mock.calls[0]!.url.startsWith("https://openrouter.ai/api/v1/models"));
    check("listModels: contextWindowTokens real (no null como los adapters conservadores)", models[0]?.contextWindowTokens === 128000);
    check(
      "listModels: pricing convertido de USD/token a USD/Mtok correctamente (0.0000008 * 1e6 = 0.8)",
      Math.abs((models[0]?.costPerMtokInputUsd ?? -1) - 0.8) < 1e-9,
      String(models[0]?.costPerMtokInputUsd)
    );
    check(
      "listModels: mismo cálculo para output (0.0000024 * 1e6 = 2.4)",
      Math.abs((models[0]?.costPerMtokOutputUsd ?? -1) - 2.4) < 1e-9,
      String(models[0]?.costPerMtokOutputUsd)
    );
  }

  console.log(`\n🔍 [Ollama] Endpoint local — /api/tags nativo para listModels, sin credencial real que validar...`);
  {
    const adapter = new OllamaProviderAdapter();
    {
      const mock = mockFetch([{ status: 200, body: { models: [{ name: "llama3:8b", size: 123 }] } }]);
      const models = await adapter.listModels();
      mock.restore();
      check("listModels: pega contra /api/tags (nativo, no la ruta OpenAI-compatible)", mock.calls[0]!.url.endsWith("/api/tags"));
      check("listModels: accessType local", models[0]?.accessType === "local");
      check("listModels: costo $0 (modelo local, nadie cobra por token)", models[0]?.costPerMtokInputUsd === 0 && models[0]?.costPerMtokOutputUsd === 0);
    }
    {
      const mock = mockFetch([{ status: 200, body: {} }]);
      const result = await adapter.validateCredentials("cualquier-cosa-se-ignora");
      mock.restore();
      check("validateCredentials: solo comprueba que el endpoint responde (no hay credencial real)", result.ok === true);
    }
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] Los 5 adapters de proveedor verificados contra fetch simulado.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  process.exit(1);
});
