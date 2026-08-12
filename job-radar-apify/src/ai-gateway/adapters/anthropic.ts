import type { ModelCapabilities, ModelDescriptor } from "../types.js";
import type { GenerateRequest, GenerateResult, ProviderAdapter } from "../provider-adapter.js";

/**
 * Fase 4 de docs/RESUME-STUDIO-PLAN.md (§3.1) — adapter de Anthropic. A
 * diferencia de google/openai/openrouter, la API de Messages de Anthropic
 * NO es compatible con el formato de OpenAI (`x-api-key` en vez de
 * `Authorization: Bearer`, `system` como campo top-level en vez de un
 * mensaje de rol "system", `content` como array de bloques tipados) — no
 * se puede reusar `OpenAiCompatibleClient` aquí, necesita su propio
 * request/response. No probado contra tráfico real en este entorno (sin
 * API key de Anthropic disponible) — contrato público y estable
 * (Messages API, `anthropic-version: 2023-06-01`); queda listo para que
 * Fase 5/6 lo valide en vivo en cuanto exista una key real. Este es
 * exactamente el cliente que Fase 8 de CV-GENERATION-PLAN.md dejó
 * diferido — construido ahora, pero inerte hasta que BYOK lo conecte.
 */
const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_API_VERSION = "2023-06-01";

interface AnthropicModelEntry {
  id: string;
  display_name?: string;
}

function headersFor(apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION
  };
}

export class AnthropicProviderAdapter implements ProviderAdapter {
  readonly providerId = "anthropic";

  async validateCredentials(apiKey: string): Promise<{ ok: boolean; detail?: string }> {
    // GET /v1/models no gasta tokens de generación — probe más barato que
    // mandar un mensaje real solo para validar la key.
    try {
      const res = await fetch(`${ANTHROPIC_BASE_URL}/models`, { headers: headersFor(apiKey) });
      if (res.status === 401 || res.status === 403) return { ok: false, detail: "API key inválida o sin permiso." };
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async listModels(apiKey?: string): Promise<ModelDescriptor[]> {
    if (!apiKey) return [];
    const res = await fetch(`${ANTHROPIC_BASE_URL}/models`, { headers: headersFor(apiKey) });
    if (!res.ok) throw new Error(`Anthropic listModels: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: AnthropicModelEntry[] };
    return (body.data ?? []).map(
      (m) =>
        ({
          id: `anthropic:${m.id}`,
          providerId: "anthropic",
          modelId: m.id,
          displayName: m.display_name ?? m.id,
          // Mismo criterio conservador que el resto de adapters: GET
          // /v1/models no trae flags de capacidad, así que no se afirman
          // (AGENTS.md regla 5).
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
    const res = await fetch(`${ANTHROPIC_BASE_URL}/messages`, {
      method: "POST",
      headers: headersFor(request.apiKey),
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }]
      })
    });
    if (!res.ok) {
      // Mismo motivo que OpenAiCompatibleClient: nunca propagar el body de
      // error completo de un proveedor externo (podría ecoar fragmentos
      // del prompt, §8.2).
      throw new Error(`Anthropic generate: HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = body.content?.find((block) => block.type === "text")?.text ?? "";
    return {
      text,
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0
    };
  }

  getCapabilities(_model: string): ModelCapabilities {
    return { text: true, vision: false, structuredOutput: false, tools: false, streaming: false };
  }
}
