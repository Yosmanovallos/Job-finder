// Real eval of Etapa B (cv_draft) + Etapa D (cv_critique) against the real
// Gemini free tier — no mocks (docs/CV-GENERATION-PLAN.md Fase 3). Feeds a
// hand-built CvFacts fixture (decoupled from Etapa A — that faithfulness
// question is already answered by validate-cv-extract-eval.ts) through a
// live Etapa B call, runs the REAL deterministic validator
// (factuality.ts) against the REAL output, then feeds that same real
// output through a live Etapa D call.
//
// Cache cleanup: Etapa B's render() output is deterministic (fixed
// fixture inputs), so its key can be precomputed the same way Fase 2b did.
// Etapa D's input includes Etapa B's *live, nondeterministic* output, so
// its key can't be known ahead of time — cleaned up instead by snapshotting
// llm_response_cache before/after and deleting whatever's new. Recomputing
// a key that depends on nondeterministic input would silently leave an
// orphan row in the shared production cache table forever.
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { loadModelsConfig, resolveModel } from "../src/cv/model-config.js";
import { ModelGateway } from "../src/cv/model-gateway.js";
import { buildOpenAiCompatibleClientFromEnv } from "../src/cv/openai-compatible-client.js";
import { cvDraftV1, cvCritiqueV1 } from "../src/cv/prompts.js";
import { validateCvDocument } from "../src/cv/factuality.js";
import type { CvFacts } from "../src/cv/cv-facts-schema.js";

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

// Fase 8 (docs/CV-GENERATION-PLAN.md §10): mismo eval contra modelos
// gratuitos (default) o pagados según qué config se cargue — el modelo
// real se deriva de la config (resolveModel), nunca hardcodeado.
const CONFIG_PATH = process.env.CV_EVAL_MODELS_CONFIG ?? "config/models.dev.yaml";

const SAMPLE_FACTS: CvFacts = {
  contact: { name: "Ana Ficticia Prueba", email: "ana.ficticia.prueba@example-test.com", phone: null, location: "Bogotá, Colombia", linkedin: null },
  summary_raw: "Desarrolladora backend con experiencia en sistemas de pruebas ficticias.",
  experience: [
    {
      id: "exp_1",
      title: "Ingeniera de Software",
      company: "Empresa Inventada Uno S.A.S.",
      start_date: "2021-01",
      end_date: "2023-06",
      achievements: [
        { id: "exp_1_bullet_1", statement: "Redujo el tiempo de respuesta de la API ficticia en un 40%.", metric: "40%" },
        { id: "exp_1_bullet_2", statement: "Lideró la migración de un monolito ficticio a microservicios ficticios.", metric: null }
      ]
    }
  ],
  skills: [
    { id: "skill_node", name: "Node.js", category: null },
    { id: "skill_postgres", name: "PostgreSQL", category: null },
    { id: "skill_ts", name: "TypeScript", category: null }
  ],
  education: [{ id: "edu_1", institution: "Universidad Ficticia de Pruebas", degree: "Ingeniería de Sistemas", end_date: "2018" }],
  certifications: [],
  languages: [{ id: "lang_es", name: "Español", level: "nativo" }]
};

// Fictional job posting — deliberately asks for something the fixture
// candidate does NOT have (Kubernetes) alongside things it does, so the
// eval can check Etapa B actually declares the gap instead of claiming it.
const JOB_TITLE = "Desarrolladora Backend Senior";
const JOB_COMPANY = "Empresa Ficticia de Contratación S.A.S.";
const JOB_REQUIREMENTS =
  "Buscamos una desarrolladora backend con experiencia sólida en Node.js y PostgreSQL. " +
  "Deseable: experiencia con Kubernetes para despliegues en producción. " +
  "Se valora experiencia liderando migraciones de arquitectura.";

async function cleanup(draftModel: string, critiqueModel: string, draftCacheKey: string, cacheKeysBefore: Set<string>) {
  await pool.query(`DELETE FROM llm_response_cache WHERE key = $1`, [draftCacheKey]);
  const { rows } = await pool.query<{ key: string }>(`SELECT key FROM llm_response_cache`);
  const newKeys = rows.map((r) => r.key).filter((k) => !cacheKeysBefore.has(k));
  if (newKeys.length > 0) {
    await pool.query(`DELETE FROM llm_response_cache WHERE key = ANY($1)`, [newKeys]);
  }
  await pool.query(`DELETE FROM llm_usage_ledger WHERE model = ANY($1)`, [[draftModel, critiqueModel]]);
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 EVAL REAL — Etapa B (cv_draft) + Etapa D (cv_critique) contra Gemini en vivo (config: ${CONFIG_PATH})`);
  console.log(`==================================================\n`);

  if (!process.env.GEMINI_API_KEY) {
    console.error(`❌ Falta GEMINI_API_KEY en .env.`);
    process.exit(1);
  }

  const config = loadModelsConfig(CONFIG_PATH);
  const DRAFT_MODEL = resolveModel(config, "cv_draft").model;
  const CRITIQUE_MODEL = resolveModel(config, "cv_critique").model;

  const draftRendered = cvDraftV1.render({ facts: SAMPLE_FACTS, jobTitle: JOB_TITLE, jobCompany: JOB_COMPANY, jobRequirements: JOB_REQUIREMENTS });
  const draftCacheKey = createHash("sha256")
    .update([cvDraftV1.name, cvDraftV1.version, DRAFT_MODEL, draftRendered.system, draftRendered.user].join(" "))
    .digest("hex");

  await pool.query(`DELETE FROM llm_response_cache WHERE key = $1`, [draftCacheKey]);
  await pool.query(`DELETE FROM llm_usage_ledger WHERE model = ANY($1)`, [[DRAFT_MODEL, CRITIQUE_MODEL]]);

  const { rows: beforeRows } = await pool.query<{ key: string }>(`SELECT key FROM llm_response_cache`);
  const cacheKeysBefore = new Set(beforeRows.map((r) => r.key));

  try {
    const client = buildOpenAiCompatibleClientFromEnv(config.providers.openai_compatible.base_url_env);
    const gateway = new ModelGateway({ config, client, pool, allowInactive: true });

    console.log(`🔍 Llamando a Etapa B (${DRAFT_MODEL}, real)...`);
    const { output: document, cached: draftCached } = await gateway.run(cvDraftV1, {
      facts: SAMPLE_FACTS,
      jobTitle: JOB_TITLE,
      jobCompany: JOB_COMPANY,
      jobRequirements: JOB_REQUIREMENTS
    });
    check("Etapa B no vino de cache (llamada real)", draftCached === false);

    console.log(`\n🔍 [Grupo 1] El validador determinístico real corre contra el output real...`);
    const report = validateCvDocument(document, SAMPLE_FACTS);
    check("validateCvDocument().ok === true (nada inventado, todo citado existe)", report.ok === true, JSON.stringify(report.violations));

    console.log(`\n🔍 [Grupo 2] El gap real (Kubernetes) se declaró, no se reclamó...`);
    const gapsLower = document.gaps_not_to_claim.join(" | ").toLowerCase();
    check("gaps_not_to_claim menciona Kubernetes", gapsLower.includes("kubernetes"), JSON.stringify(document.gaps_not_to_claim));
    const allClaimText = [document.headline.text, document.summary.text, ...document.experience.flatMap((e) => e.bullets.map((b) => b.text))]
      .join(" | ")
      .toLowerCase();
    check("Ningún texto generado reclama experiencia con Kubernetes", !allClaimText.includes("kubernetes"), allClaimText);

    console.log(`\n🔍 [Grupo 3] language se detectó correctamente (vacante en español)...`);
    check("document.language === 'es'", document.language === "es", document.language);

    console.log(`\n🔍 Llamando a Etapa D (${CRITIQUE_MODEL}, real)...`);
    const { output: critique, cached: critiqueCached } = await gateway.run(cvCritiqueV1, {
      facts: SAMPLE_FACTS,
      jobRequirements: JOB_REQUIREMENTS,
      document
    });
    check("Etapa D no vino de cache (llamada real)", critiqueCached === false);

    console.log(`\n🔍 [Grupo 4] La crítica es internamente consistente con sus propias reglas...`);
    const factualityKinds = new Set(["unsupported_claim", "unclaimed_gap"]);
    const hasFactualityViolation = critique.violations.some((v) => factualityKinds.has(v.kind));
    if (critique.verdict === "fail") {
      check("verdict:fail solo si hay violación de factualidad (puntos 1/2, según su propio prompt)", hasFactualityViolation, JSON.stringify(critique.violations));
    } else {
      check("verdict:pass y ninguna violación de factualidad reportada", !hasFactualityViolation, JSON.stringify(critique.violations));
    }
    console.log(`   Veredicto real: ${critique.verdict}, ${critique.violations.length} advertencia(s)/violación(es).`);
  } finally {
    await cleanup(DRAFT_MODEL, CRITIQUE_MODEL, draftCacheKey, cacheKeysBefore);
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\n❌ [EVAL FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [EVAL PASSED] Etapa B + Etapa D verificadas contra Gemini real.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en el eval:", err);
  process.exit(1);
});
