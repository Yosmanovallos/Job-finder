import type { ModelCapabilities, ModelDescriptor, ProviderId } from "./types.js";

/**
 * Fase 4 de docs/RESUME-STUDIO-PLAN.md (§3.1) — interfaz que implementa
 * cada proveedor real. Tipos puros (igual que types.ts) — los adapters
 * concretos (adapters/*.ts) SÍ hacen `fetch` y son server-only, pero la
 * interfaz en sí es segura de importar desde cualquier lado.
 */

export interface GenerateRequest {
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  /** Ya descifrada — el adapter nunca toca almacenamiento ni cifrado, eso
   * es trabajo exclusivo de `credential-resolver.ts` (Fase 5). */
  apiKey: string;
}

export interface GenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface StreamChunk {
  delta: string;
}

export interface ProviderAdapter {
  readonly providerId: ProviderId;
  validateCredentials(apiKey: string): Promise<{ ok: boolean; detail?: string }>;
  listModels(apiKey?: string): Promise<ModelDescriptor[]>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  getCapabilities(model: string): ModelCapabilities;
  /** Declarado para completar el contrato de la interfaz — ningún adapter
   * lo implementa en v1 (§ "sin streaming en v1" del plan aprobado, una
   * decisión de alcance explícita, no un olvido). */
  stream?(request: GenerateRequest): AsyncIterable<StreamChunk>;
}
