import type { CompletionRequest, CompletionResult, ModelClient } from "./model-client.js";

/**
 * `ModelClient` for the `openai_compatible` provider slot
 * (docs/CV-GENERATION-PLAN.md §4 Etapa D / §5.1) — real implementation
 * against Gemini's OpenAI-compatible endpoint
 * (`generativelanguage.googleapis.com/v1beta/openai/`), verified live
 * 2026-08-07 with a real API key (HTTP 200, real model list). Plain
 * `fetch`, no `openai` SDK dependency — the gateway's own retry-on-
 * invalid-JSON loop (model-gateway.ts) already gets a schema-locked
 * output provider-agnostically, so this client only needs to speak the
 * Chat Completions wire format, not any SDK-specific structured-output
 * helper.
 */

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

export class OpenAiCompatibleClient implements ModelClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: { baseUrl?: string; apiKey: string }) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiKey = opts.apiKey;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxOutputTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user }
        ]
      })
    });

    if (!res.ok) {
      // El body de error de un proveedor externo nunca se propaga
      // completo — podría, en teoría, ecoar fragmentos del prompt (que
      // incluye texto de CV/vacante, §8.2) en un mensaje de validación.
      const status = res.status;
      throw new Error(`openai_compatible request failed with HTTP ${status}`);
    }

    const body: {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } = await res.json();

    const text = body.choices?.[0]?.message?.content ?? "";
    return {
      text,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0
    };
  }
}

/** Builds the client from env + the `openai_compatible.base_url_env`
 * config field — never hardcodes the API key's env var name beyond the
 * documented convention (`GEMINI_API_KEY`), matching §4 Etapa D. */
export function buildOpenAiCompatibleClientFromEnv(baseUrlEnvVar?: string): OpenAiCompatibleClient {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta GEMINI_API_KEY en el entorno — requerida por el proveedor openai_compatible.");
  }
  const baseUrl = baseUrlEnvVar ? process.env[baseUrlEnvVar] : undefined;
  return new OpenAiCompatibleClient({ apiKey, baseUrl });
}
