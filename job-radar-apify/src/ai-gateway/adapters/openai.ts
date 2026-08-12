import { OpenAiCompatibleClient } from "../../cv/openai-compatible-client.js";
import type { ModelCapabilities, ModelDescriptor } from "../types.js";
import type { GenerateRequest, GenerateResult, ProviderAdapter } from "../provider-adapter.js";

/**
 * Fase 4 de docs/RESUME-STUDIO-PLAN.md (§3.1) — adapter de OpenAI. La API
 * de Chat Completions de OpenAI es literalmente el formato que
 * `OpenAiCompatibleClient` ya habla (es el "openai" al que ese nombre se
 * refiere) — mismo cliente que Google, solo cambia el `baseUrl`. No
 * probado contra tráfico real en este entorno (sin API key de OpenAI
 * disponible) — el contrato de wire format es público y estable; queda
 * listo para que Fase 5/6 lo valide en vivo en cuanto exista una key real.
 */
const OPENAI_BASE_URL = "https://api.openai.com/v1";

interface OpenAiModelEntry {
  id: string;
}

export class OpenAiProviderAdapter implements ProviderAdapter {
  readonly providerId = "openai";

  async validateCredentials(apiKey: string): Promise<{ ok: boolean; detail?: string }> {
    try {
      const res = await fetch(`${OPENAI_BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (res.status === 401 || res.status === 403) return { ok: false, detail: "API key inválida o sin permiso." };
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async listModels(apiKey?: string): Promise<ModelDescriptor[]> {
    if (!apiKey) return [];
    const res = await fetch(`${OPENAI_BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`OpenAI listModels: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: OpenAiModelEntry[] };
    return (body.data ?? []).map(
      (m) =>
        ({
          id: `openai:${m.id}`,
          providerId: "openai",
          modelId: m.id,
          displayName: m.id,
          // GET /v1/models no trae flags de capacidad — mismo criterio
          // conservador que el adapter de Google (AGENTS.md regla 5:
          // nunca afirmar lo que la respuesta no confirma).
          capabilities: { text: true, vision: false, structuredOutput: false, tools: false, streaming: false },
          accessType: "byok",
          contextWindowTokens: null,
          maxOutputTokens: null,
          costPerMtokInputUsd: null,
          costPerMtokOutputUsd: null,
          source: "provider_api"
        }) satisfies ModelDescriptor
    );
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const client = new OpenAiCompatibleClient({ baseUrl: OPENAI_BASE_URL, apiKey: request.apiKey });
    return client.complete({
      model: request.model,
      system: request.system,
      user: request.user,
      maxOutputTokens: request.maxOutputTokens
    });
  }

  getCapabilities(_model: string): ModelCapabilities {
    return { text: true, vision: false, structuredOutput: false, tools: false, streaming: false };
  }
}
