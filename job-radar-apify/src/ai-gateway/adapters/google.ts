import { OpenAiCompatibleClient } from "../../cv/openai-compatible-client.js";
import type { ModelCapabilities, ModelDescriptor } from "../types.js";
import type { GenerateRequest, GenerateResult, ProviderAdapter } from "../provider-adapter.js";

/**
 * Fase 4 de docs/RESUME-STUDIO-PLAN.md (§3.1) — adapter de Google, el único
 * de los cinco que envuelve un cliente YA probado en producción real
 * (`OpenAiCompatibleClient`, verificado en vivo desde Fase 3 de
 * CV-GENERATION-PLAN.md contra Gemini) en vez de escribir requests nuevas
 * sin verificar. `generate()` nunca cambia el comportamiento de ese
 * cliente — solo lo instancia con la `apiKey` que trae cada request
 * (BYOK: la key es por-usuario, no un singleton de proceso como hoy en
 * `gateway-instance.ts`).
 */
const NATIVE_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface NativeModelEntry {
  name: string;
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

export class GoogleProviderAdapter implements ProviderAdapter {
  readonly providerId = "google";

  async validateCredentials(apiKey: string): Promise<{ ok: boolean; detail?: string }> {
    try {
      const res = await fetch(`${NATIVE_MODELS_URL}?key=${encodeURIComponent(apiKey)}`);
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, detail: "API key inválida o sin permiso." };
      }
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async listModels(apiKey?: string): Promise<ModelDescriptor[]> {
    if (!apiKey) return [];
    const res = await fetch(`${NATIVE_MODELS_URL}?key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) throw new Error(`Google listModels: HTTP ${res.status}`);
    const body = (await res.json()) as { models?: NativeModelEntry[] };
    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => {
        const modelId = m.name.replace(/^models\//, "");
        return {
          id: `google:${modelId}`,
          providerId: "google",
          modelId,
          displayName: m.displayName ?? modelId,
          // La API nativa de modelos no expone flags de structured_output/
          // tool_call como sí lo hace models.dev (usado en
          // scripts/sync-model-catalog.ts, CV-GENERATION-PLAN.md Fase 12) —
          // nunca se afirma una capacidad que esta respuesta no confirma
          // (AGENTS.md regla 5). `text: true` es lo único que este
          // endpoint garantiza (generateContent soportado); el resto queda
          // `false` hasta que Fase 6 cruce esto con datos reales de
          // capacidades si hace falta.
          capabilities: { text: true, vision: false, structuredOutput: false, tools: false, streaming: false },
          accessType: "byok",
          contextWindowTokens: m.inputTokenLimit ?? null,
          maxOutputTokens: m.outputTokenLimit ?? null,
          costPerMtokInputUsd: null,
          costPerMtokOutputUsd: null,
          source: "provider_api"
        } satisfies ModelDescriptor;
      });
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const client = new OpenAiCompatibleClient({ apiKey: request.apiKey });
    const result = await client.complete({
      model: request.model,
      system: request.system,
      user: request.user,
      maxOutputTokens: request.maxOutputTokens
    });
    return result;
  }

  getCapabilities(_model: string): ModelCapabilities {
    // Igual que listModels(): solo se afirma lo que se puede verificar sin
    // adivinar. Los alias YA activos en config/models.*.yaml
    // (fast_structured, general_balanced) corren contra modelos Gemini que
    // sí soportan JSON estructurado en la práctica (probado en Fase 8 de
    // CV-GENERATION-PLAN.md) — pero esta función no distingue por nombre de
    // modelo, así que se queda conservadora hasta que haga falta más
    // precisión (Fase 6).
    return { text: true, vision: false, structuredOutput: false, tools: false, streaming: false };
  }
}
