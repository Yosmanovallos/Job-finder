import { updateCvProfileFacts } from "../db/cv-profile-repository.js";
import { getDevGateway } from "./gateway-instance.js";
import { cvExtractV1 } from "./prompts.js";

/**
 * Fase 6 wiring for Etapa A (docs/CV-GENERATION-PLAN.md, nota de alcance
 * bajo la tabla de Fase 2b): `POST /api/cv/profile` (Fase 2a) only saved
 * raw text; this module is what actually turns that into `CvFacts`. Called
 * fire-and-forget from the upload handler — never awaited by the HTTP
 * response, matching the shape `facts_json` was already built for
 * (nullable, filled by a separate UPDATE, §10 Fase 2a/2b) and the
 * documented Gemini free-tier flakiness under bursts (Fase 3 notes): if
 * this fails, the raw text stays saved and the UI can just keep polling
 * `GET /api/cv/profile` — no re-upload needed, no request left hanging on
 * a slow/flaky model call.
 *
 * Usa el gateway singleton compartido de `gateway-instance.ts`, cuyo
 * config (gratuito por defecto, pagado si `CV_MODELS_CONFIG_PATH` apunta
 * a `config/models.local.yaml` — Fase 8, §10) se decide ahí, no aquí. El
 * gateway singleton en sí vive ahí (Fase 7 — shared with `server.ts`'s
 * generate/regenerate routes).
 */

/** Never throws — errors are logged (no CV content, §8.2) and swallowed,
 * since the caller (the POST handler) has already responded to the
 * client by the time this runs. */
export async function extractAndStoreFacts(userId: string, rawText: string): Promise<void> {
  try {
    const gateway = getDevGateway();
    const { output } = await gateway.run(cvExtractV1, { text: rawText }, { userId });
    const applied = await updateCvProfileFacts(userId, rawText, output);
    if (!applied) {
      console.error(`[cv-extract-facts] user=${userId} raw_text cambió antes de terminar — descartado, no aplica`);
    }
  } catch (err: any) {
    console.error(`[cv-extract-facts] user=${userId} Etapa A falló:`, err?.message ?? err);
  }
}
