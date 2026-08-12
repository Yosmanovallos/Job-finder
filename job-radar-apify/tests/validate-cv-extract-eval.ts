// Real eval of Etapa A (cv_extract) against the real Gemini free tier —
// no mocks, no fake client (docs/CV-GENERATION-PLAN.md §2b: a fake client
// can't produce evidence for a faithfulness check, since it just returns
// whatever the test scripted). Runs against a real, richly-detailed
// FICTIONAL CV (tests/fixtures/fictional-cv-text.ts) so every assertion
// below has a known ground truth to check the model's output against.
// Writes real rows to llm_response_cache/llm_usage_ledger — cleaned up
// in `finally`, same discipline as tests/validate-cv-gateway.ts.
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { loadModelsConfig, resolveModel } from "../src/cv/model-config.js";
import { ModelGateway } from "../src/cv/model-gateway.js";
import { buildOpenAiCompatibleClientFromEnv } from "../src/cv/openai-compatible-client.js";
import { cvExtractV1 } from "../src/cv/prompts.js";
import { FICTIONAL_CV_TEXT } from "./fixtures/fictional-cv-text.js";

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

// Fase 8 (docs/CV-GENERATION-PLAN.md §10): el mismo eval corre contra
// modelos gratuitos (default) o pagados sin duplicar el script — solo
// cambia qué config se carga. El modelo real se deriva de esa config
// (resolveModel), nunca se hardcodea, para que nunca quede desincronizado
// de lo que la config realmente resuelve.
const CONFIG_PATH = process.env.CV_EVAL_MODELS_CONFIG ?? "config/models.dev.yaml";

async function cleanup(model: string) {
  const rendered = cvExtractV1.render({ text: FICTIONAL_CV_TEXT });
  const key = createHash("sha256")
    .update([cvExtractV1.name, cvExtractV1.version, model, rendered.system, rendered.user].join(" "))
    .digest("hex");
  await pool.query(`DELETE FROM llm_response_cache WHERE key = $1`, [key]);
  await pool.query(`DELETE FROM llm_usage_ledger WHERE model = $1`, [model]);
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 EVAL REAL — Etapa A (cv_extract) contra Gemini en vivo, sin mocks (config: ${CONFIG_PATH})`);
  console.log(`==================================================\n`);

  if (!process.env.GEMINI_API_KEY) {
    console.error(`❌ Falta GEMINI_API_KEY en .env — no se puede correr este eval contra un modelo real.`);
    process.exit(1);
  }

  const config = loadModelsConfig(CONFIG_PATH);
  const MODEL = resolveModel(config, "cv_extract").model;
  await cleanup(MODEL);

  try {
    const client = buildOpenAiCompatibleClientFromEnv(config.providers.openai_compatible.base_url_env);
    const gateway = new ModelGateway({ config, client, pool, allowInactive: true });

    console.log(`🔍 Llamando a ${MODEL} (real)...`);
    const { output, cached } = await gateway.run(cvExtractV1, { text: FICTIONAL_CV_TEXT });
    check("La corrida NO vino de cache (llamada real)", cached === false);

    const sourceLower = FICTIONAL_CV_TEXT.toLowerCase();
    const inSource = (s: string) => sourceLower.includes(s.toLowerCase().trim());

    console.log(`\n🔍 [Grupo 1] Datos de contacto — deben ser copia literal...`);
    check("email exacto", output.contact.email === "ana.ficticia.prueba@example-test.com", output.contact.email ?? "null");
    check("name contiene 'Ana' y 'Ficticia'", output.contact.name.includes("Ana") && output.contact.name.includes("Ficticia"), output.contact.name);
    check("location está presente (el CV sí lo trae)", output.contact.location !== null && inSource(output.contact.location), String(output.contact.location));

    console.log(`\n🔍 [Grupo 2] Experiencia — conteo exacto, nada inventado ni omitido...`);
    check("experience.length === 2 (ni más ni menos que el CV real)", output.experience.length === 2, `len=${output.experience.length}`);
    const companies = output.experience.map((e) => e.company.toLowerCase());
    check("Empresa Inventada Uno está presente", companies.some((c) => c.includes("empresa inventada uno")), JSON.stringify(companies));
    check("Empresa Inventada Dos está presente", companies.some((c) => c.includes("empresa inventada dos")), JSON.stringify(companies));
    for (const exp of output.experience) {
      check(`company "${exp.company}" es texto literal del CV (no inventado)`, inSource(exp.company), exp.company);
      check(`title "${exp.title}" es texto literal del CV`, inSource(exp.title), exp.title);
    }

    console.log(`\n🔍 [Grupo 3] La métrica real (40%) se preservó, no se inventó otra...`);
    const allAchievementText = output.experience
      .flatMap((e) => e.achievements)
      .map((a) => `${a.statement} ${a.metric ?? ""}`)
      .join(" | ");
    check("El 40% real aparece en algún logro extraído", allAchievementText.includes("40%"), allAchievementText);
    const percentagesFound = allAchievementText.match(/\d+%/g) ?? [];
    check(
      "Ningún logro extraído inventa un porcentaje distinto al 40% del CV",
      percentagesFound.every((p) => p === "40%"),
      JSON.stringify(percentagesFound)
    );

    console.log(`\n🔍 [Grupo 4] Skills/educación/certificaciones/idiomas — literales, sin inventar...`);
    check("skills.length >= 3 (Node.js, PostgreSQL, TypeScript, Docker en el CV)", output.skills.length >= 3, `len=${output.skills.length}`);
    for (const skill of output.skills) {
      check(`skill "${skill.name}" es literal del CV`, inSource(skill.name), skill.name);
    }
    check("education.length === 1", output.education.length === 1, `len=${output.education.length}`);
    if (output.education[0]) {
      check("institution es literal del CV", inSource(output.education[0].institution), output.education[0].institution);
    }
    check("certifications.length === 1", output.certifications.length === 1, `len=${output.certifications.length}`);
    check("languages.length === 2", output.languages.length === 2, `len=${output.languages.length}`);

    console.log(`\n🔍 [Grupo 5] IDs de hechos con la forma correcta (regex FactId)...`);
    const allIds = [
      ...output.experience.map((e) => e.id),
      ...output.experience.flatMap((e) => e.achievements.map((a) => a.id)),
      ...output.skills.map((s) => s.id)
    ];
    check("Todos los ids matchean /^[a-z][a-z0-9_-]*$/", allIds.every((id) => /^[a-z][a-z0-9_-]*$/.test(id)), JSON.stringify(allIds));

    console.log(`\n📊 Uso real registrado en el ledger:`);
    const { rows } = await pool.query<{ input_tokens: number; output_tokens: number; cost_usd: string }>(
      `SELECT input_tokens, output_tokens, cost_usd FROM llm_usage_ledger WHERE model = $1`,
      [MODEL]
    );
    console.log(`   ${JSON.stringify(rows[0])}`);
  } finally {
    await cleanup(MODEL);
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\n❌ [EVAL FAILED] ${failed} caso(s) fallaron — no activar cv_extract todavía.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [EVAL PASSED] Etapa A (cv_extract) verificada contra Gemini real — fiel al texto fuente, nada inventado.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en el eval:", err);
  process.exit(1);
});
