export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Provider-agnostic seam (docs/CV-GENERATION-PLAN.md §6.1) — the gateway
 * never knows which vendor it's talking to. Real implementations
 * (Anthropic, Gemini via its OpenAI-compatible endpoint, §4 Etapa D)
 * arrive in Fase 3; this phase only needs the interface so the gateway
 * and its tests can be built and verified against fakes, with zero real
 * LLM calls.
 */
export interface ModelClient {
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
