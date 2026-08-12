/**
 * Fase 4 de docs/RESUME-STUDIO-PLAN.md (plan aprobado 2026-08-09, §3.1) —
 * tipos puros del Provider/Model Registry. NADA en este archivo importa
 * `pg`/`node:crypto`/nada server-only — es seguro importarlo desde el
 * bundle del browser (mismo motivo que obligó a duplicar una constante
 * entre `quota.ts` y `CvAdjustOverlay.tsx` en Fase 11 de
 * `CV-GENERATION-PLAN.md`: evitarlo desde el día uno a esta escala).
 */

/** Abierto a propósito, NO un union fijo — la validez real se decide al
 * REGISTRAR un adapter en el `ProviderRegistry` (runtime, `registry.ts`),
 * nunca a nivel de tipo. Así un proveedor nuevo nunca exige tocar este
 * archivo compartido con el frontend. */
export type ProviderId = string;

/** Quién paga esta capacidad — nunca hardcodeado como propiedad fija de un
 * modelo (un modelo puede ser gratis hoy y dejar de serlo mañana, o tener
 * un free tier limitado). Se resuelve al consultar, no se declara una vez
 * y se olvida. */
export type AccessType = "free" | "free_tier" | "paid" | "byok" | "local";

export interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  structuredOutput: boolean;
  tools: boolean;
  /** Declarado para completar el contrato — ningún adapter lo implementa
   * en v1 (ver riesgos del plan aprobado: "no streaming en v1" es una
   * decisión de alcance, no un olvido). */
  streaming: boolean;
}

export interface ModelDescriptor {
  /** `${providerId}:${modelId}` — convención de clave compuesta (mismo
   * patrón que OpenCode/Vercel AI SDK's provider registry). */
  id: string;
  providerId: ProviderId;
  modelId: string;
  displayName: string;
  capabilities: ModelCapabilities;
  accessType: AccessType;
  contextWindowTokens: number | null;
  maxOutputTokens: number | null;
  costPerMtokInputUsd: number | null;
  costPerMtokOutputUsd: number | null;
  /** De dónde salió este dato — nunca "inventado a mano" sin decirlo
   * (AGENTS.md regla 5 aplicada a metadata de modelos, no solo a hechos de
   * un CV). `"manual_review"` es el mismo principio que ya usa
   * `config/model-catalog.yaml` (Fase 12 de CV-GENERATION-PLAN.md):
   * revisado por un humano, no solo copiado de una API sin verificar. */
  source: "models.dev" | "provider_api" | "manual_review";
}

/** Lo único que el browser tiene permitido saber sobre una conexión de un
 * usuario — nunca la key, nunca lo suficiente para reconstruirla. */
export interface ProviderConnectionStatus {
  providerId: ProviderId;
  connected: boolean;
  label: string | null;
  last4: string | null;
  validatedAt: string | null;
}
