import { OpenAiCompatibleClient } from "../../cv/openai-compatible-client.js";
import type { ModelCapabilities, ModelDescriptor } from "../types.js";
import type { GenerateRequest, GenerateResult, ProviderAdapter } from "../provider-adapter.js";

/**
 * Fase 4 de docs/RESUME-STUDIO-PLAN.md (§3.1) — adapter de OpenRouter.
 * Mismo motivo que openai.ts: OpenRouter expone una API compatible con
 * OpenAI a propósito, así que `generate()` reusa `OpenAiCompatibleClient`
 * con otro `baseUrl`. No probado contra tráfico real en este entorno (sin
 * API key de OpenRouter disponible) — contrato público y estable.
 *
 * A diferencia de Google/OpenAI, `GET /api/v1/models` de OpenRouter SÍ
 * trae pricing (`pricing.prompt`/`pricing.completion`, USD por token) y
 * `context_length` reales en la respuesta — esos campos se completan de
 * verdad aquí, no quedan conservadores como en los otros adapters, porque
 * la fuente sí los confirma (AGENTS.md regla 5: completar solo lo que el
 * dato real respalda, nunca menos de lo que sí se puede verificar).
 */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

interface OpenRouterModelEntry {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

export class OpenRouterProviderAdapter implements ProviderAdapter {
  readonly providerId = "openrouter";

  async validateCredentials(apiKey: string): Promise<{ ok: boolean; detail?: string }> {
    try {
      const res = await fetch(`${OPENROUTER_BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (res.status === 401 || res.status === 403) return { ok: false, detail: "API key inválida o sin permiso." };
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async listModels(apiKey?: string): Promise<ModelDescriptor[]> {
    // OpenRouter's model catalog is public (no key required to list) —
    // pero se sigue exigiendo `apiKey` en la firma por consistencia con el
    // resto de la interfaz (un caller sin key no debería depender de que
    // esta particularidad se mantenga).
    const res = await fetch(`${OPENROUTER_BASE_URL}/models`, apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined);
    if (!res.ok) throw new Error(`OpenRouter listModels: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: OpenRouterModelEntry[] };
    return (body.data ?? []).map((m) => {
      const inputPerToken = m.pricing?.prompt ? Number(m.pricing.prompt) : null;
      const outputPerToken = m.pricing?.completion ? Number(m.pricing.completion) : null;
      return {
        id: `openrouter:${m.id}`,
        providerId: "openrouter",
        modelId: m.id,
        displayName: m.name ?? m.id,
        capabilities: { text: true, vision: false, structuredOutput: false, tools: false, streaming: false },
        accessType: "byok",
        contextWindowTokens: m.context_length ?? null,
        maxOutputTokens: null,
        costPerMtokInputUsd: inputPerToken !== null && !Number.isNaN(inputPerToken) ? inputPerToken * 1_000_000 : null,
        costPerMtokOutputUsd: outputPerToken !== null && !Number.isNaN(outputPerToken) ? outputPerToken * 1_000_000 : null,
        source: "provider_api"
      } satisfies ModelDescriptor;
    });
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const client = new OpenAiCompatibleClient({ baseUrl: OPENROUTER_BASE_URL, apiKey: request.apiKey });
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
