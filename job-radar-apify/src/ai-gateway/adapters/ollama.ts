import { OpenAiCompatibleClient } from "../../cv/openai-compatible-client.js";
import type { ModelCapabilities, ModelDescriptor } from "../types.js";
import type { GenerateRequest, GenerateResult, ProviderAdapter } from "../provider-adapter.js";

/**
 * Fase 4 de docs/RESUME-STUDIO-PLAN.md (§3.1) — adapter de Ollama (modelos
 * locales). Distinto en naturaleza a los otros cuatro: no hay una API key
 * de verdad que validar — es un endpoint local (`accessType: "local"`,
 * §types.ts) que por defecto no exige autenticación. `apiKey` en la
 * interfaz se acepta por consistencia con `ProviderAdapter` pero Ollama la
 * ignora; lo que sí importa es la URL del endpoint (`OLLAMA_BASE_URL`,
 * configurable — nunca hardcodeado a `localhost` para no asumir que el
 * proceso de este servidor y el de Ollama corren en la misma máquina).
 * `generate()` reusa `OpenAiCompatibleClient` (Ollama expone una capa
 * compatible con OpenAI en `/v1/chat/completions`); `listModels()` usa el
 * endpoint nativo `/api/tags` (lista lo que el usuario ya descargó
 * localmente — la ruta OpenAI-compatible no tiene equivalente para esto).
 * No probado contra una instancia real de Ollama en este entorno.
 */
function baseUrl(): string {
  return (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
}

interface OllamaTagEntry {
  name: string;
  size?: number;
}

export class OllamaProviderAdapter implements ProviderAdapter {
  readonly providerId = "ollama";

  async validateCredentials(_apiKey: string): Promise<{ ok: boolean; detail?: string }> {
    // No hay credencial real que validar — esto comprueba que el endpoint
    // local responde, que es la única precondición real para "conectado".
    try {
      const res = await fetch(`${baseUrl()}/api/tags`);
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: `No se pudo conectar a ${baseUrl()}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  async listModels(): Promise<ModelDescriptor[]> {
    const res = await fetch(`${baseUrl()}/api/tags`);
    if (!res.ok) throw new Error(`Ollama listModels: HTTP ${res.status}`);
    const body = (await res.json()) as { models?: OllamaTagEntry[] };
    return (body.models ?? []).map(
      (m) =>
        ({
          id: `ollama:${m.name}`,
          providerId: "ollama",
          modelId: m.name,
          displayName: m.name,
          capabilities: { text: true, vision: false, structuredOutput: false, tools: false, streaming: false },
          accessType: "local",
          contextWindowTokens: null,
          maxOutputTokens: null,
          costPerMtokInputUsd: 0,
          costPerMtokOutputUsd: 0,
          source: "provider_api"
        }) satisfies ModelDescriptor
    );
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const client = new OpenAiCompatibleClient({ baseUrl: `${baseUrl()}/v1`, apiKey: request.apiKey || "ollama" });
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
