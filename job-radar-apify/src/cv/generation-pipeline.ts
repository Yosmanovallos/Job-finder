import type { CvFacts } from "./cv-facts-schema.js";
import type { CvDocument } from "./cv-document-schema.js";
import { validateCvDocument, type FactualityReport } from "./factuality.js";
import { cvDraftV1, cvCritiqueV1 } from "./prompts.js";
import type { ModelGateway, RunContext } from "./model-gateway.js";
import {
  reserveGenerationQuota,
  completeGeneration,
  failGeneration,
  reserveRegenerationQuota,
  revertRegeneration,
  type ModelOption,
  type ReserveGenerationInput,
  type ReserveRegenerationInput
} from "./quota.js";

/**
 * Fase 11 (docs/CV-GENERATION-PLAN.md §10 fila 11, decidido con el
 * usuario 2026-08-09): "Premium" no tiene modelo real detrás (no existe
 * cliente Anthropic, `reasoning_high` resuelve a `none` en ambos
 * `config/models.*.yaml` — verificado en vivo, ningún modelo Gemini de
 * la cuenta real es más fuerte que el que ya usa "Estándar") y
 * "Comparar" necesita la Etapa C (score ATS determinístico) que no
 * existe en este subproyecto y que, aunque existiera, no tendría contra
 * qué comparar de forma confiable (§3.2: `Job` no trae requisitos
 * estructurados de la vacante). Decisión explícita: el mecanismo de
 * créditos por opción (§6.2, `MODEL_OPTION_CREDIT_COST` en quota.ts) se
 * construye completo y real para las tres opciones — probado
 * directamente contra `reserveGenerationQuota` (tests/validate-cv-quota.ts,
 * Grupo 5) sin pasar por este pipeline — pero solo `standard` corre un
 * pipeline real. Pedir `premium`/`compare` aquí falla ANTES de reservar
 * cualquier cuota (revisado con el asesor: reservar-y-revertir para una
 * opción que estructuralmente nunca puede correr no demuestra nada que
 * el test de quota.ts no demuestre ya, y expone una clase de bug real —
 * si el revert falla, créditos quedan atrapados para siempre en una
 * opción inexistente). El cliente Anthropic y la Etapa C quedan como
 * trabajo futuro separado, con su propio ADR.
 */
export const AVAILABLE_MODEL_OPTIONS: ReadonlySet<ModelOption> = new Set(["standard"]);

export class ModelOptionNotAvailableError extends Error {
  constructor(readonly option: ModelOption) {
    super(
      `Model option "${option}" is not available yet — only "standard" runs a real pipeline today ` +
        "(Fase 11, docs/CV-GENERATION-PLAN.md §10 fila 11)."
    );
    this.name = "ModelOptionNotAvailableError";
  }
}

/**
 * Orchestrates Etapas B/D/E for one CV generation (docs/CV-GENERATION-PLAN.md
 * §4/§6.2). §4 says Etapa E fires "solo si la Etapa D marca fail," but §3.3
 * and §6.2 paso 5 make the deterministic validator the real authority —
 * taken literally, that leaves it undefined what happens when the
 * validator rejects a document Etapa D called "pass". Decided here
 * (2026-08-07, written back into docs/CV-GENERATION-PLAN.md §4): Etapa E
 * fires if EITHER signal indicates a problem — the validator is cheap to
 * run and a false "pass" from Etapa D must never let an unbacked claim
 * skip the one chance at a retry. The FINAL accept/reject decision after
 * that retry (or immediately, if no retry was needed) is always the
 * validator's alone; Etapa D's verdict never gates anything by itself.
 *
 * Regla 12 (AGENTS.md — every loop has an explicit bound): there is
 * exactly one retry, structurally — the retry block runs at most once,
 * unconditionally followed by a final check, never a loop.
 */

export class FactualityRejectedError extends Error {
  constructor(readonly report: FactualityReport) {
    super(`Generation rejected by the deterministic validator after Etapa E: ${JSON.stringify(report.violations)}`);
    this.name = "FactualityRejectedError";
  }
}

interface PipelineStagesInput {
  facts: CvFacts;
  jobTitle: string;
  jobCompany: string;
  jobRequirements: string;
  gateway: ModelGateway;
}

/** Shared Etapa B → Etapa D → validator → (conditional Etapa E) → final
 * validator run — the part that's identical whether this is a first
 * generation or a regeneration (Fase 7). Reserving/completing/failing
 * quota around this is the caller's job, since the two callers below
 * disagree on what "fail" means (see `revertRegeneration`'s doc comment). */
async function runPipelineStages(
  input: PipelineStagesInput,
  context: RunContext
): Promise<{ document: CvDocument; report: FactualityReport }> {
  let draft = await input.gateway.run(
    cvDraftV1,
    { facts: input.facts, jobTitle: input.jobTitle, jobCompany: input.jobCompany, jobRequirements: input.jobRequirements },
    context
  );
  const critique = await input.gateway.run(
    cvCritiqueV1,
    { facts: input.facts, jobRequirements: input.jobRequirements, document: draft.output },
    context
  );
  let report = validateCvDocument(draft.output, input.facts);

  const needsRetry = !report.ok || critique.output.verdict === "fail";
  if (needsRetry) {
    const issues = [
      ...report.violations.map((v) => `[${v.kind}] ${v.where}: ${v.detail}`),
      ...critique.output.violations.map((v) => `[${v.kind}] ${v.detail}`)
    ];
    draft = await input.gateway.run(
      cvDraftV1,
      {
        facts: input.facts,
        jobTitle: input.jobTitle,
        jobCompany: input.jobCompany,
        jobRequirements: input.jobRequirements,
        priorAttemptIssues: issues
      },
      context
    );
    report = validateCvDocument(draft.output, input.facts);
    // Never a second retry, regardless of outcome — the block above ran
    // exactly once and this is the final check.
  }

  return { document: draft.output, report };
}

export interface RunGenerationInput extends ReserveGenerationInput {
  facts: CvFacts;
  jobRequirements: string;
  gateway: ModelGateway;
}

export interface RunGenerationResult {
  generationId: string;
  document: CvDocument;
}

export async function runCvGenerationPipeline(input: RunGenerationInput): Promise<RunGenerationResult> {
  // Checked BEFORE any reservation, not after (revisado con el asesor,
  // Fase 11): reservar y luego revertir para una opción que nunca podía
  // correr no demuestra nada que el mecanismo de créditos (quota.ts) no
  // demuestre ya por sí solo — y evita por completo la clase de bug
  // donde un `revertRegeneration`/`failGeneration` que falla (best-effort,
  // `.catch(() => {})`) deja créditos reservados para siempre en una
  // opción que estructuralmente nunca iba a correr.
  if (!AVAILABLE_MODEL_OPTIONS.has(input.modelOption)) {
    throw new ModelOptionNotAvailableError(input.modelOption);
  }
  const reservation = await reserveGenerationQuota(input);

  try {
    const { document, report } = await runPipelineStages(input, { userId: input.userId, cvGenerationId: reservation.id });

    if (!report.ok) {
      await failGeneration(reservation.id);
      throw new FactualityRejectedError(report);
    }

    await completeGeneration(reservation.id, document);
    return { generationId: reservation.id, document };
  } catch (err) {
    if (!(err instanceof FactualityRejectedError)) {
      // Any unexpected failure (network error, PromptOutputError from the
      // gateway's own 2-attempt JSON-repair loop, etc.) must not leave the
      // row stuck in 'reserved' forever — that would silently hold quota
      // hostage. Best-effort: if this itself fails, the original error is
      // still what the caller sees.
      await failGeneration(reservation.id).catch(() => {});
    }
    throw err;
  }
}

export interface RunRegenerationInput extends ReserveRegenerationInput {
  facts: CvFacts;
  jobTitle: string;
  jobCompany: string;
  jobRequirements: string;
  gateway: ModelGateway;
  /**
   * Fase 11 de docs/RESUME-STUDIO-PLAN.md — el modelo elegido en el
   * `ModelPicker` del Studio para "Regenerar desde cero". Ausente (el
   * caso de siempre hasta esta fase) deja el pipeline resolviendo por el
   * alias YAML de siempre, cero cambio de comportamiento. Cuando está
   * presente, ya viene resuelto y descifrado por `server.ts` (nunca se
   * descifra aquí) — se aplica a las TRES llamadas de `runPipelineStages`
   * (draft, critique, reintento de draft) por igual: el usuario eligió un
   * modelo para esta regeneración completa, no por-etapa.
   */
  credentialOverride?: Pick<RunContext, "credentialSource" | "providerId" | "modelId" | "apiKey">;
}

/**
 * §9.4 "Regenerar desde cero" — same B→D→E→validator pipeline as a first
 * generation, but reserved/settled against an EXISTING `completed` row
 * (`reserveRegenerationQuota` accumulates credits rather than replacing
 * them, §6.2). On success, `completeGeneration` overwrites both
 * `generated_document_json` and `document_json` — deliberate, this is what
 * "desde cero" means; the client must confirm before calling this because
 * it discards manual edits. On failure, `revertRegeneration` restores the
 * row to its previous `completed` state (never `failGeneration` — see that
 * function's doc comment for why that would silently erase already-paid
 * credits and orphan the user's still-good prior CV).
 */
export async function runCvRegenerationPipeline(input: RunRegenerationInput): Promise<RunGenerationResult> {
  // Mismo motivo que en runCvGenerationPipeline: checked BEFORE reservar.
  // Aquí importa aún más — reservar-y-revertir sobre una fila 'completed'
  // ya existente que nunca se tocó sería un riesgo real si el revert
  // falla (créditos inflados para siempre sobre un CV que ya funcionaba).
  if (!AVAILABLE_MODEL_OPTIONS.has(input.modelOption)) {
    throw new ModelOptionNotAvailableError(input.modelOption);
  }
  // Fase 14 de docs/RESUME-STUDIO-PLAN.md — cutover de facturación: si esta
  // regeneración la financia la key propia del usuario (BYOK), la reserva
  // cuesta 0 créditos (ver `creditCostFor` en quota.ts). `credentialOverride`
  // ya viene resuelto por `server.ts` ANTES de llegar aquí (Fase 11) — este
  // pipeline nunca decide por su cuenta si algo es BYOK, solo lee el campo.
  const reservation = await reserveRegenerationQuota({
    ...input,
    credentialSource: input.credentialOverride?.credentialSource
  });

  try {
    const { document, report } = await runPipelineStages(input, {
      userId: input.userId,
      cvGenerationId: reservation.id,
      ...(input.credentialOverride ?? {})
    });

    if (!report.ok) {
      await revertRegeneration(reservation.id, reservation.previousCreditsCharged);
      throw new FactualityRejectedError(report);
    }

    await completeGeneration(reservation.id, document);
    return { generationId: reservation.id, document };
  } catch (err) {
    if (!(err instanceof FactualityRejectedError)) {
      await revertRegeneration(reservation.id, reservation.previousCreditsCharged).catch(() => {});
    }
    throw err;
  }
}
