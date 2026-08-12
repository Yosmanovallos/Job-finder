// Orchestration tests for src/cv/generation-pipeline.ts — real Postgres
// (quota rows, ledger, cache), FAKE ModelClient. Deliberately a fake
// client here, unlike the Fase 2b/3 evals: what's under test is this
// repo's OWN code (does a validator rejection correctly skip charging
// quota while still logging real cost? does retry fire exactly once?),
// not a model's faithfulness — a fake client makes that deterministic
// and repeatable, the same justification Fase 1 used for the gateway's
// own tests.
import crypto from "crypto";
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { getOrCreateUser, upgradeUserToPro, upgradeUserToProMax, saveJobs } from "../src/db/job-repository.js";
import type { Job } from "../src/sources/types.js";
import { ModelGateway } from "../src/cv/model-gateway.js";
import { ModelsConfigSchema, type ModelsConfig } from "../src/cv/model-config.js";
import type { CompletionRequest, CompletionResult, ModelClient } from "../src/cv/model-client.js";
import {
  runCvGenerationPipeline,
  runCvRegenerationPipeline,
  FactualityRejectedError,
  ModelOptionNotAvailableError
} from "../src/cv/generation-pipeline.js";
import { QuotaExceededError, MODEL_OPTION_CREDIT_COST } from "../src/cv/quota.js";
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

const DRAFT_MODEL = "__test-pipeline-draft__";
const CRITIQUE_MODEL = "__test-pipeline-critique__";

const FACTS: CvFacts = {
  contact: { name: "Test Ficticio", email: null, phone: null, location: null, linkedin: null },
  summary_raw: null,
  experience: [{ id: "exp_1", title: "Dev", company: "Empresa", start_date: null, end_date: null, achievements: [{ id: "exp_1_b1", statement: "Hizo X", metric: null }] }],
  skills: [{ id: "skill_1", name: "Node.js", category: null }],
  education: [],
  certifications: [],
  languages: []
};

const VALID_DRAFT = {
  headline: { text: "Dev", supporting_fact_ids: ["exp_1"] },
  summary: { text: "Resumen", supporting_fact_ids: ["exp_1_b1"] },
  experience: [{ source_id: "exp_1", bullets: [{ text: "Hizo X", supporting_fact_ids: ["exp_1_b1"] }] }],
  reordered_skill_ids: ["skill_1"],
  reordered_education_ids: [],
  reordered_certification_ids: [],
  omitted_fact_ids: [],
  gaps_not_to_claim: [],
  language: "es"
};

const BAD_DRAFT = {
  ...VALID_DRAFT,
  headline: { text: "Dev inventado", supporting_fact_ids: ["fake_id_no_existe"] }
};

const CRITIQUE_PASS = { verdict: "pass", violations: [] };
const CRITIQUE_FAIL = { verdict: "fail", violations: [{ kind: "unsupported_claim", detail: "algo no cuadra" }] };

function baseConfig(): ModelsConfig {
  return ModelsConfigSchema.parse({
    aliases: { draft_alias: DRAFT_MODEL, critique_alias: CRITIQUE_MODEL },
    pricing: {
      [DRAFT_MODEL]: { input_per_mtok: 1, output_per_mtok: 5 },
      [CRITIQUE_MODEL]: { input_per_mtok: 1, output_per_mtok: 5 }
    },
    tasks: {
      cv_draft: { model_alias: "draft_alias", max_output_tokens: 2000 },
      cv_critique: { model_alias: "critique_alias", max_output_tokens: 1000 }
    },
    budgets: { max_daily_cloud_cost_usd: 1000, stop_on_budget_exceeded: true }
  });
}

function fakeClient(byModel: Record<string, string[]>): ModelClient & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    calls,
    async complete(request): Promise<CompletionResult> {
      calls.push(request);
      const queue = byModel[request.model];
      const text = queue?.shift() ?? "{}";
      return { text, inputTokens: 1000, outputTokens: 500 };
    }
  };
}

async function makeProUser(label: string): Promise<string> {
  const id = crypto.randomUUID();
  await getOrCreateUser(id, `cv_pipeline_${label}_${Date.now()}@example-test.com`);
  await upgradeUserToPro(id, new Date(Date.now() + 20 * 24 * 3600 * 1000));
  return id;
}

async function makeProMaxUser(label: string): Promise<string> {
  const id = crypto.randomUUID();
  await getOrCreateUser(id, `cv_pipeline_promax_${label}_${Date.now()}@example-test.com`);
  await upgradeUserToProMax(id, new Date(Date.now() + 20 * 24 * 3600 * 1000));
  return id;
}

async function makeFictionalJob(label: string): Promise<string> {
  const job: Job = {
    jobId: `cv_pipeline_fixture_${label}_${Date.now()}`,
    title: `Vacante Ficticia Pipeline ${label}`,
    company: "Empresa Ficticia de Pruebas",
    location: "Remoto",
    url: `https://example-test.invalid/cv-pipeline-fixture/${label}/${Date.now()}`,
    dateText: "hoy",
    source: "LinkedIn"
  };
  await saveJobs([job], "TestFixture");
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM jobs WHERE url = $1`, [job.url]);
  return rows[0]!.id;
}

async function cleanup(userIds: string[], jobIds: string[], cacheKeysBefore: Set<string>) {
  await pool.query(`DELETE FROM cv_generations WHERE user_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM jobs WHERE id = ANY($1)`, [jobIds]);
  await pool.query(`DELETE FROM llm_usage_ledger WHERE model = ANY($1)`, [[DRAFT_MODEL, CRITIQUE_MODEL]]);
  // Precise diff, never a broad DELETE — llm_response_cache.key is a
  // sha256 shared with every other prompt this gateway will ever cache
  // (same lesson as Fase 1: a loose filter here would wipe real
  // production cache entries, not just this test's own rows).
  const { rows } = await pool.query<{ key: string }>(`SELECT key FROM llm_response_cache`);
  const newKeys = rows.map((r) => r.key).filter((k) => !cacheKeysBefore.has(k));
  if (newKeys.length > 0) {
    await pool.query(`DELETE FROM llm_response_cache WHERE key = ANY($1)`, [newKeys]);
  }
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Orquestación de generación (generation-pipeline.ts, cliente fake)`);
  console.log(`==================================================\n`);

  const userIds: string[] = [];
  const jobIds: string[] = [];
  const cacheKeysBefore = new Set(
    (await pool.query<{ key: string }>(`SELECT key FROM llm_response_cache`)).rows.map((r) => r.key)
  );

  try {
    console.log(`🔍 [Test A] Camino feliz: draft válido + crítica pass en el primer intento...`);
    {
      const userId = await makeProUser("happy");
      const jobId = await makeFictionalJob("happy");
      userIds.push(userId);
      jobIds.push(jobId);
      const client = fakeClient({ [DRAFT_MODEL]: [JSON.stringify(VALID_DRAFT)], [CRITIQUE_MODEL]: [JSON.stringify(CRITIQUE_PASS)] });
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true });

      const result = await runCvGenerationPipeline({
        userId, tier: "pro", jobId, jobTitle: "Vacante Feliz", jobCompany: "Empresa",
        modelOption: "standard", facts: FACTS, jobRequirements: "Requisitos felices.", gateway
      });
      check("Pipeline resuelve con un documento", result.document.headline.text === "Dev");
      check("Exactamente 1 llamada a cv_draft (sin retry, no hacía falta)", client.calls.filter((c) => c.model === DRAFT_MODEL).length === 1);

      const { rows } = await pool.query<{ status: string; credits_charged: number }>(
        `SELECT status, credits_charged FROM cv_generations WHERE id = $1`, [result.generationId]
      );
      check("status = completed", rows[0]?.status === "completed");
      check("credits_charged = 1 (Pro)", rows[0]?.credits_charged === 1);
    }

    console.log(`\n🔍 [Test B] El validador rechaza AMBOS intentos: failed, cuota no cobrada, costo real sí queda en el ledger, nunca un 3er intento...`);
    {
      const userId = await makeProUser("reject-twice");
      const jobId = await makeFictionalJob("reject-twice");
      userIds.push(userId);
      jobIds.push(jobId);
      const client = fakeClient({
        [DRAFT_MODEL]: [JSON.stringify(BAD_DRAFT), JSON.stringify(BAD_DRAFT)],
        [CRITIQUE_MODEL]: [JSON.stringify(CRITIQUE_PASS), JSON.stringify(CRITIQUE_PASS)]
      });
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true });

      let thrown: unknown;
      try {
        await runCvGenerationPipeline({
          userId, tier: "pro", jobId, jobTitle: "Vacante Rechazo Doble", jobCompany: "Empresa",
          modelOption: "standard", facts: FACTS, jobRequirements: "Requisitos de rechazo.", gateway
        });
      } catch (e) {
        thrown = e;
      }
      check("Lanza FactualityRejectedError", thrown instanceof FactualityRejectedError, String(thrown));
      check("Exactamente 2 llamadas a cv_draft (1 original + 1 retry, NUNCA un 3ro)", client.calls.filter((c) => c.model === DRAFT_MODEL).length === 2);

      const { rows: genRows } = await pool.query<{ status: string }>(
        `SELECT status FROM cv_generations WHERE user_id = $1 AND job_id = $2`, [userId, jobId]
      );
      check("status = failed", genRows[0]?.status === "failed");

      const { rows: usageRows } = await pool.query<{ used: string }>(
        `SELECT COALESCE(SUM(credits_charged), 0) AS used FROM cv_generations WHERE user_id = $1 AND status IN ('reserved','completed')`,
        [userId]
      );
      check("La cuota NO se cobró (0 créditos contados para este usuario)", Number(usageRows[0]?.used) === 0, `used=${usageRows[0]?.used}`);

      const rejectedGenerationId = (
        await pool.query<{ id: string }>(`SELECT id FROM cv_generations WHERE user_id = $1 AND job_id = $2`, [userId, jobId])
      ).rows[0]?.id;
      const { rows: ledgerRows } = await pool.query<{ count: string; total_cost: string }>(
        `SELECT COUNT(*), COALESCE(SUM(cost_usd),0) AS total_cost FROM llm_usage_ledger WHERE model = $1 AND cv_generation_id = $2`,
        [DRAFT_MODEL, rejectedGenerationId ?? null]
      );
      check("El ledger real tiene 2 filas de costo (el intento original + el retry, aunque no se cobraron al usuario)", Number(ledgerRows[0]?.count) === 2, `count=${ledgerRows[0]?.count}`);
      check("El costo real en USD del intento fallido SÍ quedó registrado (> 0)", Number(ledgerRows[0]?.total_cost) > 0, `cost=${ledgerRows[0]?.total_cost}`);
    }

    console.log(`\n🔍 [Test C] El retry recupera un intento malo: completed, cuota SÍ se cobra...`);
    {
      const userId = await makeProUser("retry-recovers");
      const jobId = await makeFictionalJob("retry-recovers");
      userIds.push(userId);
      jobIds.push(jobId);
      const client = fakeClient({
        [DRAFT_MODEL]: [JSON.stringify(BAD_DRAFT), JSON.stringify(VALID_DRAFT)],
        [CRITIQUE_MODEL]: [JSON.stringify(CRITIQUE_PASS), JSON.stringify(CRITIQUE_PASS)]
      });
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true });

      const result = await runCvGenerationPipeline({
        userId, tier: "pro", jobId, jobTitle: "Vacante Reintento Exitoso", jobCompany: "Empresa",
        modelOption: "standard", facts: FACTS, jobRequirements: "Requisitos de reintento.", gateway
      });
      check("Pipeline resuelve tras el retry", result.document.headline.text === "Dev");
      const draftCalls = client.calls.filter((c) => c.model === DRAFT_MODEL);
      check("Exactamente 2 llamadas a cv_draft", draftCalls.length === 2);
      check("El retry incluye el contexto de la falla anterior", draftCalls[1]!.user.includes("previous_attempt_issues"));

      const { rows } = await pool.query<{ status: string; credits_charged: number }>(
        `SELECT status, credits_charged FROM cv_generations WHERE id = $1`, [result.generationId]
      );
      check("status = completed", rows[0]?.status === "completed");
      check("credits_charged = 1 (Pro, sin importar el retry)", rows[0]?.credits_charged === 1);
    }

    console.log(`\n🔍 [Test D] La crítica sola (verdict:fail) dispara el retry aunque el validador ya haya aprobado...`);
    {
      const userId = await makeProUser("critique-triggers");
      const jobId = await makeFictionalJob("critique-triggers");
      userIds.push(userId);
      jobIds.push(jobId);
      const client = fakeClient({
        [DRAFT_MODEL]: [JSON.stringify(VALID_DRAFT), JSON.stringify(VALID_DRAFT)],
        [CRITIQUE_MODEL]: [JSON.stringify(CRITIQUE_FAIL), JSON.stringify(CRITIQUE_PASS)]
      });
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true });

      await runCvGenerationPipeline({
        userId, tier: "pro", jobId, jobTitle: "Vacante Critica Falla", jobCompany: "Empresa",
        modelOption: "standard", facts: FACTS, jobRequirements: "Requisitos de crítica.", gateway
      });
      check(
        "El validador solo (report.ok=true) NO fue suficiente para evitar el retry — la crítica también dispara",
        client.calls.filter((c) => c.model === DRAFT_MODEL).length === 2
      );
    }

    console.log(`\n🔍 [Test E] Sin cupo → QuotaExceededError, CERO llamadas a cualquier modelo...`);
    {
      const userId = await makeProUser("no-quota");
      const jobId = await makeFictionalJob("no-quota");
      userIds.push(userId);
      jobIds.push(jobId);
      // Agota la cuota real de este usuario con 3 reservas previas sobre otros 3 jobs.
      for (let i = 0; i < 3; i++) {
        const extraJobId = await makeFictionalJob(`no-quota-extra-${i}`);
        jobIds.push(extraJobId);
        const { reserveGenerationQuota } = await import("../src/cv/quota.js");
        await reserveGenerationQuota({ userId, tier: "pro", jobId: extraJobId, jobTitle: "x", jobCompany: "y", modelOption: "standard" });
      }

      const client = fakeClient({ [DRAFT_MODEL]: [JSON.stringify(VALID_DRAFT)], [CRITIQUE_MODEL]: [JSON.stringify(CRITIQUE_PASS)] });
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true });

      let thrown: unknown;
      try {
        await runCvGenerationPipeline({
          userId, tier: "pro", jobId, jobTitle: "Vacante Sin Cupo", jobCompany: "Empresa",
          modelOption: "standard", facts: FACTS, jobRequirements: "x", gateway
        });
      } catch (e) {
        thrown = e;
      }
      check("Lanza QuotaExceededError", thrown instanceof QuotaExceededError, String(thrown));
      check("Cero llamadas a cualquier modelo (rechazado ANTES del LLM)", client.calls.length === 0, `calls=${client.calls.length}`);
    }

    console.log(
      `\n🔍 [Test F] Fase 11 (§10 fila 11): "premium" se rechaza ANTES de reservar cualquier cuota — ` +
        `ni siquiera se crea una fila en cv_generations (no hay pipeline real detrás todavía)...`
    );
    {
      const userId = await makeProMaxUser("option-unavailable");
      const jobId = await makeFictionalJob("option-unavailable");
      userIds.push(userId);
      jobIds.push(jobId);
      const client = fakeClient({ [DRAFT_MODEL]: [JSON.stringify(VALID_DRAFT)], [CRITIQUE_MODEL]: [JSON.stringify(CRITIQUE_PASS)] });
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true });

      let thrown: unknown;
      try {
        await runCvGenerationPipeline({
          userId,
          tier: "pro_max",
          proMaxCreditCost: MODEL_OPTION_CREDIT_COST.premium,
          jobId,
          jobTitle: "Vacante Premium No Disponible",
          jobCompany: "Empresa",
          modelOption: "premium",
          facts: FACTS,
          jobRequirements: "Requisitos.",
          gateway
        });
      } catch (e) {
        thrown = e;
      }
      check("Lanza ModelOptionNotAvailableError", thrown instanceof ModelOptionNotAvailableError, String(thrown));
      check("Cero llamadas a cualquier modelo — el gate corre ANTES de reservar", client.calls.length === 0, `calls=${client.calls.length}`);

      const { rows: genRows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM cv_generations WHERE user_id = $1 AND job_id = $2`,
        [userId, jobId]
      );
      check("Cero filas creadas en cv_generations — nunca se llegó a reservar", Number(genRows[0]!.count) === 0, genRows[0]!.count);

      const { rows: usageRows } = await pool.query<{ used: string }>(
        `SELECT COALESCE(SUM(credits_charged), 0) AS used FROM cv_generations WHERE user_id = $1 AND status IN ('reserved','completed')`,
        [userId]
      );
      check("Nada cobrado (used=0)", Number(usageRows[0]?.used) === 0, `used=${usageRows[0]?.used}`);
    }

    console.log(
      `\n🔍 [Test G] Fase 11: el gemelo de regeneración — pedir "premium" sobre una generación ` +
        `'completed' existente NUNCA la toca (ni reserva, ni revierte; simplemente no llega a eso)...`
    );
    {
      const userId = await makeProMaxUser("regen-option-unavailable");
      const jobId = await makeFictionalJob("regen-option-unavailable");
      userIds.push(userId);
      jobIds.push(jobId);
      const client = fakeClient({
        [DRAFT_MODEL]: [JSON.stringify(VALID_DRAFT)],
        [CRITIQUE_MODEL]: [JSON.stringify(CRITIQUE_PASS)]
      });
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true });

      // Genera una fila 'completed' real primero (modelOption: "standard").
      const initial = await runCvGenerationPipeline({
        userId, tier: "pro_max", proMaxCreditCost: MODEL_OPTION_CREDIT_COST.standard, jobId,
        jobTitle: "Vacante Regen Premium No Disponible", jobCompany: "Empresa",
        modelOption: "standard", facts: FACTS, jobRequirements: "Requisitos.", gateway
      });
      const { rows: beforeRows } = await pool.query<{ status: string; credits_charged: number }>(
        `SELECT status, credits_charged FROM cv_generations WHERE id = $1`, [initial.generationId]
      );
      check("Setup: la generación inicial quedó completed con 3 créditos", beforeRows[0]?.status === "completed" && beforeRows[0]?.credits_charged === 3);

      client.calls.length = 0; // reset para medir solo lo que pasa en el intento de regenerar

      let thrown: unknown;
      try {
        await runCvRegenerationPipeline({
          userId, tier: "pro_max", proMaxCreditCost: MODEL_OPTION_CREDIT_COST.premium,
          generationId: initial.generationId, modelOption: "premium",
          facts: FACTS, jobTitle: "Vacante Regen Premium No Disponible", jobCompany: "Empresa",
          jobRequirements: "Requisitos.", gateway
        });
      } catch (e) {
        thrown = e;
      }
      check("Lanza ModelOptionNotAvailableError", thrown instanceof ModelOptionNotAvailableError, String(thrown));
      check("Cero llamadas a cualquier modelo", client.calls.length === 0, `calls=${client.calls.length}`);

      const { rows: afterRows } = await pool.query<{ status: string; credits_charged: number }>(
        `SELECT status, credits_charged FROM cv_generations WHERE id = $1`, [initial.generationId]
      );
      check(
        "La fila NUNCA se tocó — status sigue completed, credits_charged sigue en 3 (no hubo reserva que revertir)",
        afterRows[0]?.status === "completed" && afterRows[0]?.credits_charged === 3,
        JSON.stringify(afterRows[0])
      );
    }
  } finally {
    await cleanup(userIds, jobIds, cacheKeysBefore);
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] Orquestación de generación verificada (cliente fake, Postgres real).`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  process.exit(1);
});
