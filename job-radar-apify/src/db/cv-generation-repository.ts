import { pool } from "./client.js";
import { CvDocumentSchema, type CvDocument } from "../cv/cv-document-schema.js";

/**
 * `cv_generations` access for Vista 2 (docs/CV-GENERATION-PLAN.md §9.4/§9.5,
 * Fase 7). Every read/write here is scoped by `user_id` in the query
 * itself (never just checked after fetching) — a non-owned id returns
 * `null`/`false`, never a distinguishable 403, so an id doesn't leak
 * existence across users.
 */

export interface GenerationForJob {
  id: string;
  status: string;
  /** Only populated for a `completed` row with a schema-valid
   * `document_json` — the overlay (§9.2) uses its presence, not just
   * `status`, to decide whether it can jump straight to the editor with
   * data in hand, in the same round trip that answers "does one exist?". */
  document: CvDocument | null;
  /** Fase 12 (docs/RESUME-STUDIO-PLAN.md) — el original inmutable de la
   * IA (`generated_document_json`), para el modo Comparar. Mismo criterio
   * defensivo que `document`: `null` si la fila no es `completed` o el
   * JSON guardado ya no calza con el schema, nunca una excepción a mitad
   * de un bootstrap que también trae `profile`/`quota`. */
  generatedDocument: CvDocument | null;
  /** Fase 10 (docs/RESUME-STUDIO-PLAN.md) — qué CvTemplateSpec.id usar al
   * renderizar. Siempre presente (columna NOT NULL con default), nunca
   * null — el Studio nunca necesita su propio fallback aparte del
   * registry's `getTemplate()`. */
  templateId: string;
}

/** For `GET /api/cv/generations?jobId=` (§9.2): decides Vista 1 vs Vista 2
 * on open, AND (when completed) hands back the document itself so the
 * editor has something to render without a second request — there's no
 * separate "GET generation by id as JSON" endpoint in §9.5's table, this
 * is deliberately the one place that returns the document as JSON (PDF/
 * DOCX are binary, PATCH only writes). A `reserved` row (regeneration in
 * flight) or a `failed` one both fall back to "no editor yet", same as no
 * row at all. */
export async function getGenerationForJob(userId: string, jobId: string): Promise<GenerationForJob | null> {
  const { rows } = await pool.query<{
    id: string;
    status: string;
    document_json: unknown;
    generated_document_json: unknown;
    template_id: string;
  }>(
    `SELECT id, status, document_json, generated_document_json, template_id FROM cv_generations WHERE user_id = $1 AND job_id = $2`,
    [userId, jobId]
  );
  const row = rows[0];
  if (!row) return null;
  let document: CvDocument | null = null;
  let generatedDocument: CvDocument | null = null;
  if (row.status === "completed") {
    if (row.document_json !== null) {
      const parsed = CvDocumentSchema.safeParse(row.document_json);
      document = parsed.success ? parsed.data : null;
    }
    if (row.generated_document_json !== null) {
      const parsedGenerated = CvDocumentSchema.safeParse(row.generated_document_json);
      generatedDocument = parsedGenerated.success ? parsedGenerated.data : null;
    }
  }
  return { id: row.id, status: row.status, document, generatedDocument, templateId: row.template_id };
}

export interface GenerationRecord {
  id: string;
  status: string;
  jobTitle: string;
  jobCompany: string;
  document: CvDocument;
  templateId: string;
}

/** Fetches a generation's current, editable `document_json` for the
 * editor/renderers — `null` if the id doesn't belong to this user, isn't
 * `completed` yet, or its stored JSON no longer matches `CvDocumentSchema`
 * (defensive: never hand a malformed document to a renderer that assumes
 * a valid shape). */
export async function getGenerationById(id: string, userId: string): Promise<GenerationRecord | null> {
  const { rows } = await pool.query<{
    id: string;
    status: string;
    job_title: string;
    job_company: string;
    document_json: unknown;
    template_id: string;
  }>(
    `SELECT id, status, job_title, job_company, document_json, template_id
     FROM cv_generations WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  const row = rows[0];
  if (!row || row.status !== "completed" || row.document_json === null) {
    return null;
  }
  const parsed = CvDocumentSchema.safeParse(row.document_json);
  if (!parsed.success) {
    return null;
  }
  return {
    id: row.id,
    status: row.status,
    jobTitle: row.job_title,
    jobCompany: row.job_company,
    document: parsed.data,
    templateId: row.template_id
  };
}

/**
 * §9.4 "Guardar cambios" — free, no LLM, no factuality re-check (§11: the
 * validator governs what the AI generates on its own, never what a user
 * edits into their own document). Only `document_json`/`edited_at` move;
 * `generated_document_json` (the immutable original) is never touched
 * here, so "revert to what the AI generated" stays possible forever.
 * Requires `status = 'completed'` in the WHERE clause — editing a
 * `reserved` (mid-regeneration) or `failed` row makes no sense and would
 * otherwise silently create a `document_json` for a row nothing else
 * expects to have one. Returns whether a row was actually updated.
 */
export async function updateGenerationDocument(id: string, userId: string, document: CvDocument): Promise<boolean> {
  const result = await pool.query(
    `UPDATE cv_generations
     SET document_json = $3, edited_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'completed'`,
    [id, userId, JSON.stringify(document)]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Fase 10 (docs/RESUME-STUDIO-PLAN.md) — cambia SOLO `template_id`, nunca
 * toca `document_json`/`generated_document_json`/`edited_at`. Deliberado:
 * cambiar de plantilla es presentación, no una edición del contenido —
 * mantenerlas separadas es lo que hace verificable estructuralmente que
 * "cambiar plantilla nunca dispara el pipeline de IA" (esta función no
 * importa nada de `cv/model-gateway.js` ni `ai-gateway/*`, ni siquiera
 * transitivamente). El `templateId` en sí NO se valida aquí — el caller
 * (`server.ts`) ya lo verificó contra el registry antes de llamar, mismo
 * criterio que `updateGenerationDocument` confía en que el caller ya
 * corrió `CvDocumentSchema.safeParse`.
 */
export async function updateGenerationTemplate(id: string, userId: string, templateId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE cv_generations
     SET template_id = $3, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'completed'`,
    [id, userId, templateId]
  );
  return (result.rowCount ?? 0) > 0;
}
