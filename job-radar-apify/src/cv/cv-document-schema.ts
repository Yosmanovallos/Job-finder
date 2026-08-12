import { z } from "zod";
import { FactId } from "./cv-facts-schema.js";

/**
 * `CvDocument` — Etapa B's output (docs/CV-GENERATION-PLAN.md §3.2).
 * Every claim cites the `CvFacts` ids that back it; the validator
 * (factuality.ts) is the only authority on whether those citations are
 * real — this schema only enforces shape, not truth.
 */
export const ClaimSchema = z.object({
  text: z.string().min(1),
  supporting_fact_ids: z.array(FactId),
  // Fase 9 de docs/RESUME-STUDIO-PLAN.md — opcional y aditivo, así que
  // `cv_draft`/`cv_critique` (que nunca lo piden) siguen validando exacto
  // igual que antes de esta fase, `.strict()` incluido (un campo opcional
  // ausente no rompe strict mode). Solo `cv_section_rewrite` (Fase 8, v2)
  // lo puebla: por qué la IA cambió el texto, grounded en la acción
  // aplicada — nunca inventado aparte, es parte de la misma respuesta
  // estructurada que ya pasa por el mismo eval/validador de factualidad
  // que el resto del claim. Se limpia del lado del cliente si el usuario
  // edita el texto a mano después (ver ContentTab.tsx) — una edición
  // manual ya no es lo que la explicación describía.
  rationale: z.string().optional()
}).strict();
export type Claim = z.infer<typeof ClaimSchema>;

export const CvDocumentSchema = z.object({
  headline: ClaimSchema,
  summary: ClaimSchema,
  experience: z.array(
    z.object({
      source_id: FactId,
      bullets: z.array(ClaimSchema).min(1).max(5)
    }).strict()
  ),
  reordered_skill_ids: z.array(FactId),
  reordered_education_ids: z.array(FactId),
  reordered_certification_ids: z.array(FactId),
  omitted_fact_ids: z.array(FactId),
  gaps_not_to_claim: z.array(z.string()),
  language: z.enum(["es", "en"])
}).strict();
export type CvDocument = z.infer<typeof CvDocumentSchema>;

/**
 * `CvCritique` — Etapa D's output. Own design, not lifted from the root
 * project (which has no equivalent adversarial-review stage) — shape
 * follows directly from the 4 review points in Etapa D's system prompt
 * (§4): point 1→unsupported_claim, point 2→unclaimed_gap, point 3→
 * missing_keyword_match, point 4→generic_language. `verdict` is
 * informational only — the deterministic validator (factuality.ts),
 * never this LLM critique, is the real gate (§4 Etapa D, último párrafo).
 */
export const CvCritiqueSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  violations: z.array(
    z.object({
      kind: z.enum(["unsupported_claim", "unclaimed_gap", "missing_keyword_match", "generic_language"]),
      detail: z.string()
    }).strict()
  )
}).strict();
export type CvCritique = z.infer<typeof CvCritiqueSchema>;
