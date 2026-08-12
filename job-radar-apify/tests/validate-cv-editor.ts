// Fase 7 (docs/CV-GENERATION-PLAN.md §9.4/§9.5) — verifies the editor's
// exit criteria directly against real Postgres and real renderers, WITHOUT
// going through the HTTP layer: cv_draft/cv_critique are still `active:
// false` (Fase 8 pending), so a real end-to-end POST /api/cv/generate call
// can't produce a document to edit here, and a real Pro browser session is
// still blocked by Supabase's "Confirm email" (same limitation documented
// in Fase 2a/6). Seeds a `completed` cv_generations row the same way
// reserveGenerationQuota/completeGeneration already do in production, then
// exercises exactly what the repository functions and renderers do —
// which is everything server.ts's PATCH/pdf/docx/regenerate routes call.
import crypto from "crypto";
import dotenv from "dotenv";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { pool } from "../src/db/client.js";
import { getOrCreateUser, upgradeUserToPro, saveJobs } from "../src/db/job-repository.js";
import type { Job } from "../src/sources/types.js";
import type { CvFacts } from "../src/cv/cv-facts-schema.js";
import type { CvDocument } from "../src/cv/cv-document-schema.js";
import { upsertCvProfileRawText, updateCvProfileFacts, getCvFacts } from "../src/db/cv-profile-repository.js";
import { getGenerationById, updateGenerationDocument } from "../src/db/cv-generation-repository.js";
import {
  reserveGenerationQuota,
  completeGeneration,
  getQuotaStatus,
  reserveRegenerationQuota,
  revertRegeneration,
  GenerationConflictError,
  GenerationNotFoundError
} from "../src/cv/quota.js";
import { renderCvToPdf } from "../src/cv/render-pdf.js";
import { renderCvToDocx } from "../src/cv/render-docx.js";

dotenv.config();

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    console.log(`✅ [PASSED] ${label}`);
  } else {
    console.error(`❌ [FAILED] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

const ORIGINAL_BULLET = "Optimizó el pipeline de despliegue original.";
const EDITED_BULLET_SENTINEL = "SENTINELA_EDITADA_QUE_NUNCA_ESTUVO_EN_LA_GENERACION_ORIGINAL_9f31";

const FACTS: CvFacts = {
  contact: {
    name: "Editor Ficticio Prueba",
    email: "editor.ficticio.prueba@example-test.com",
    phone: null,
    location: "Bogotá, Colombia",
    linkedin: null
  },
  summary_raw: null,
  experience: [
    {
      id: "exp_1",
      title: "Desarrolladora Backend",
      company: "Empresa Editor Ficticia S.A.S.",
      start_date: "2020-01",
      end_date: "2022-01",
      achievements: [{ id: "exp_1_b1", statement: "Logro original sin editar.", metric: null }]
    }
  ],
  skills: [{ id: "skill_ts", name: "TypeScript", category: null }],
  education: [],
  certifications: [],
  languages: [{ id: "lang_es", name: "Español", level: "nativo" }]
};

function baseDocument(): CvDocument {
  return {
    headline: { text: "Headline original", supporting_fact_ids: ["exp_1"] },
    summary: { text: "Resumen original.", supporting_fact_ids: ["exp_1_b1"] },
    experience: [{ source_id: "exp_1", bullets: [{ text: ORIGINAL_BULLET, supporting_fact_ids: ["exp_1_b1"] }] }],
    reordered_skill_ids: ["skill_ts"],
    reordered_education_ids: [],
    reordered_certification_ids: [],
    omitted_fact_ids: [],
    gaps_not_to_claim: [],
    language: "es"
  };
}

async function makeProUser(label: string): Promise<string> {
  const id = crypto.randomUUID();
  await getOrCreateUser(id, `cv_editor_${label}_${Date.now()}@example-test.com`);
  await upgradeUserToPro(id, new Date(Date.now() + 20 * 24 * 3600 * 1000));
  return id;
}

async function makeJob(label: string): Promise<string> {
  const job: Job = {
    jobId: `cv_editor_fixture_${label}_${Date.now()}`,
    title: "Vacante Ficticia Editor",
    company: "Empresa Ficticia Editor",
    location: "Remoto",
    url: `https://example-test.invalid/cv-editor-fixture/${label}/${Date.now()}`,
    dateText: "hoy",
    source: "LinkedIn" // KNOWN_SOURCES en job-validator.ts exige un source real
  };
  await saveJobs([job], "TestFixture");
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM jobs WHERE url = $1`, [job.url]);
  return rows[0]!.id;
}

const RAW_TEXT_FIXTURE = "CV crudo ficticio de prueba para el editor.";

async function seedCompletedGeneration(userId: string, jobId: string): Promise<string> {
  await upsertCvProfileRawText(userId, RAW_TEXT_FIXTURE);
  await updateCvProfileFacts(userId, RAW_TEXT_FIXTURE, FACTS);
  const reservation = await reserveGenerationQuota({
    userId,
    tier: "pro",
    jobId,
    jobTitle: "Vacante Ficticia Editor",
    jobCompany: "Empresa Ficticia Editor",
    modelOption: "standard"
  });
  await completeGeneration(reservation.id, baseDocument());
  return reservation.id;
}

async function cleanup(userId: string, jobId: string | null): Promise<void> {
  await pool.query(`DELETE FROM cv_generations WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM cv_profiles WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  if (jobId) await pool.query(`DELETE FROM jobs WHERE id = $1`, [jobId]);
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Editor de CV (Fase 7, sin LLM, Postgres real)`);
  console.log(`==================================================\n`);

  console.log(`🔍 [Grupo 1] Round-trip del editor: editar → guardar → "reabrir" → PDF/DOCX reflejan la edición...`);
  {
    const userId = await makeProUser("roundtrip");
    const jobId = await makeJob("roundtrip");
    try {
      const genId = await seedCompletedGeneration(userId, jobId);

      const before = await getGenerationById(genId, userId);
      check("Antes de editar: el bullet ORIGINAL está presente", before?.document.experience[0]?.bullets[0]?.text === ORIGINAL_BULLET);

      const edited: CvDocument = {
        ...baseDocument(),
        headline: { text: "Headline editado por el usuario", supporting_fact_ids: ["exp_1"] },
        experience: [{ source_id: "exp_1", bullets: [{ text: EDITED_BULLET_SENTINEL, supporting_fact_ids: [] }] }]
      };
      const updated = await updateGenerationDocument(genId, userId, edited);
      check("updateGenerationDocument encontró y actualizó la fila (true)", updated === true);

      const notOwned = await updateGenerationDocument(genId, crypto.randomUUID(), edited);
      check("updateGenerationDocument con un user_id distinto no toca la fila (ownership)", notOwned === false);

      // "Reabrir" = leer de nuevo desde la BD, no reusar el objeto en memoria.
      const reopened = await getGenerationById(genId, userId);
      check("Tras 'reabrir', el bullet EDITADO persiste", reopened?.document.experience[0]?.bullets[0]?.text === EDITED_BULLET_SENTINEL);
      check("El bullet original ya NO está tras reabrir", reopened?.document.experience[0]?.bullets[0]?.text !== ORIGINAL_BULLET);

      const { rows } = await pool.query<{ generated_document_json: any; edited_at: string | null }>(
        `SELECT generated_document_json, edited_at FROM cv_generations WHERE id = $1`,
        [genId]
      );
      check(
        "generated_document_json (inmutable) conserva el bullet ORIGINAL — guardar nunca lo sobreescribe",
        rows[0]!.generated_document_json.experience[0].bullets[0].text === ORIGINAL_BULLET
      );
      check("edited_at quedó poblado tras guardar", rows[0]!.edited_at !== null);

      const facts = await getCvFacts(userId);
      check("getCvFacts devuelve los hechos reales guardados", facts !== null && facts.contact.name === FACTS.contact.name);

      const pdfBuf = await renderCvToPdf(reopened!.document, facts!);
      const pdfParser = new PDFParse({ data: pdfBuf });
      try {
        const pdfText = (await pdfParser.getText()).text;
        check("El PDF descargado contiene la edición (sentinela)", pdfText.includes(EDITED_BULLET_SENTINEL));
        check("El PDF descargado NO contiene el bullet original — refleja document_json, no generated_document_json", !pdfText.includes(ORIGINAL_BULLET));
      } finally {
        await pdfParser.destroy();
      }

      const docxBuf = await renderCvToDocx(reopened!.document, facts!);
      const docxText = (await mammoth.extractRawText({ buffer: docxBuf })).value;
      check("El DOCX descargado contiene la edición (sentinela)", docxText.includes(EDITED_BULLET_SENTINEL));
      check("El DOCX descargado NO contiene el bullet original", !docxText.includes(ORIGINAL_BULLET));
    } finally {
      await cleanup(userId, jobId);
    }
  }

  console.log(`\n🔍 [Grupo 2] Regenerar: cuota se ACUMULA (no se reemplaza) y un fallo la REVIERTE sin tocar el CV que ya funcionaba...`);
  {
    const userId = await makeProUser("regen");
    const jobId = await makeJob("regen");
    try {
      const genId = await seedCompletedGeneration(userId, jobId);

      const before = await getQuotaStatus(userId, "pro");
      check("Cuota inicial tras 1 generación: used=1", before.used === 1, JSON.stringify(before));

      const reservation = await reserveRegenerationQuota({ userId, tier: "pro", generationId: genId, modelOption: "standard" });
      check("reserveRegenerationQuota devuelve previousCreditsCharged=1", reservation.previousCreditsCharged === 1);

      const { rows: midRows } = await pool.query<{ status: string; credits_charged: number }>(
        `SELECT status, credits_charged FROM cv_generations WHERE id = $1`,
        [genId]
      );
      check("Mientras está 'reserved', credits_charged se ACUMULÓ (1+1=2), nunca se reemplazó", midRows[0]!.credits_charged === 2);
      check("status pasó a 'reserved' durante la regeneración", midRows[0]!.status === "reserved");

      const duringRegen = await getQuotaStatus(userId, "pro");
      check("La cuota ya refleja el total acumulado (used=2) mientras la regeneración está en curso", duringRegen.used === 2);

      try {
        await reserveRegenerationQuota({ userId, tier: "pro", generationId: genId, modelOption: "standard" });
        check("Una segunda regeneración concurrente (status ya 'reserved') lanza GenerationConflictError", false, "no lanzó nada");
      } catch (e) {
        check("Una segunda regeneración concurrente (status ya 'reserved') lanza GenerationConflictError", e instanceof GenerationConflictError, String(e));
      }

      // Simula que la regeneración FALLÓ (validador/Etapa D rechazaron el resultado).
      await revertRegeneration(reservation.id, reservation.previousCreditsCharged);

      const { rows: afterRows } = await pool.query<{ status: string; credits_charged: number; document_json: any }>(
        `SELECT status, credits_charged, document_json FROM cv_generations WHERE id = $1`,
        [genId]
      );
      check("Tras revertRegeneration: status vuelve a 'completed'", afterRows[0]!.status === "completed");
      check("Tras revertRegeneration: credits_charged vuelve al valor previo (1), no se queda en 2", afterRows[0]!.credits_charged === 1);
      check(
        "Tras revertRegeneration: document_json (el CV que ya funcionaba) queda intacto — nunca se tocó",
        afterRows[0]!.document_json.experience[0].bullets[0].text === ORIGINAL_BULLET
      );

      const afterQuota = await getQuotaStatus(userId, "pro");
      check("La cuota vuelve a used=1 tras el revert — el intento fallido no dejó un cobro fantasma", afterQuota.used === 1, JSON.stringify(afterQuota));

      // Ahora una regeneración que sí se completa.
      const reservation2 = await reserveRegenerationQuota({ userId, tier: "pro", generationId: genId, modelOption: "standard" });
      const regeneratedDoc: CvDocument = {
        ...baseDocument(),
        headline: { text: "Headline tras una regeneración real", supporting_fact_ids: ["exp_1"] }
      };
      await completeGeneration(reservation2.id, regeneratedDoc);
      const { rows: finalRows } = await pool.query<{ status: string; credits_charged: number }>(
        `SELECT status, credits_charged FROM cv_generations WHERE id = $1`,
        [genId]
      );
      check("Tras una regeneración EXITOSA: status='completed'", finalRows[0]!.status === "completed");
      check("Tras una regeneración EXITOSA: credits_charged acumuló a 2 (cobra igual que la primera vez, §9.4)", finalRows[0]!.credits_charged === 2);
      const finalQuota = await getQuotaStatus(userId, "pro");
      check("La cuota final refleja las 2 generaciones reales cobradas (used=2)", finalQuota.used === 2, JSON.stringify(finalQuota));
    } finally {
      await cleanup(userId, jobId);
    }
  }

  console.log(`\n🔍 [Grupo 3] Regenerar un id que no existe (o no es del usuario) lanza GenerationNotFoundError...`);
  {
    const userId = await makeProUser("notfound");
    try {
      try {
        await reserveRegenerationQuota({ userId, tier: "pro", generationId: crypto.randomUUID(), modelOption: "standard" });
        check("Regenerar un id inexistente lanza GenerationNotFoundError", false, "no lanzó nada");
      } catch (e) {
        check("Regenerar un id inexistente lanza GenerationNotFoundError", e instanceof GenerationNotFoundError, String(e));
      }
    } finally {
      await cleanup(userId, null);
    }
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    await pool.end();
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] Editor de CV (Fase 7) verificado: guardar persiste, PDF/DOCX reflejan la edición, regenerar acumula/revierte cuota correctamente.`);
  console.log(`==================================================\n`);
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
