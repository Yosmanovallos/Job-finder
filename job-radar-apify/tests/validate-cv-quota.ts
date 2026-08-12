// Real Postgres, no LLM, no mocks — the quota reservation layer never
// calls a model, so there's nothing to fake here. Proves the concurrency
// guarantee the user originally asked for ("no poder hackear ese consumo
// de tokens"): N simultaneous requests against a low quota only ever let
// exactly quota-many through.
import crypto from "crypto";
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { getOrCreateUser, upgradeUserToPro, upgradeUserToProMax } from "../src/db/job-repository.js";
import { saveJobs } from "../src/db/job-repository.js";
import type { Job } from "../src/sources/types.js";
import {
  reserveGenerationQuota,
  reserveRegenerationQuota,
  completeGeneration,
  failGeneration,
  getQuotaStatus,
  QuotaExceededError,
  GenerationConflictError,
  PRO_GENERATIONS_PER_WINDOW,
  PRO_MAX_CREDITS_PER_WINDOW,
  PRO_CREDIT_COST,
  MODEL_OPTION_CREDIT_COST
} from "../src/cv/quota.js";

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

async function makeProUser(label: string): Promise<string> {
  const id = crypto.randomUUID();
  await getOrCreateUser(id, `cv_quota_${label}_${Date.now()}@example-test.com`);
  await upgradeUserToPro(id, new Date(Date.now() + 20 * 24 * 3600 * 1000));
  return id;
}

async function makeProMaxUser(label: string): Promise<string> {
  const id = crypto.randomUUID();
  await getOrCreateUser(id, `cv_quota_promax_${label}_${Date.now()}@example-test.com`);
  await upgradeUserToProMax(id, new Date(Date.now() + 20 * 24 * 3600 * 1000));
  return id;
}

async function makeFictionalJobs(n: number, label: string): Promise<string[]> {
  const jobs: Job[] = Array.from({ length: n }, (_, i) => ({
    jobId: `cv_quota_fixture_${label}_${i}_${Date.now()}`,
    title: `Vacante Ficticia de Prueba ${label} ${i}`,
    company: "Empresa Ficticia de Pruebas",
    location: "Remoto",
    url: `https://example-test.invalid/cv-quota-fixture/${label}/${i}/${Date.now()}`,
    dateText: "hoy",
    source: "LinkedIn" // KNOWN_SOURCES en job-validator.ts exige un source real
  }));
  await saveJobs(jobs, "TestFixture");
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM jobs WHERE url = ANY($1) ORDER BY array_position($1::text[], url)`,
    [jobs.map((j) => j.url)]
  );
  return rows.map((r) => r.id);
}

async function cleanupUser(userId: string) {
  await pool.query(`DELETE FROM cv_generations WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

async function cleanupJobs(jobIds: string[]) {
  if (jobIds.length === 0) return;
  await pool.query(`DELETE FROM jobs WHERE id = ANY($1)`, [jobIds]);
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Reserva transaccional de cuota (src/cv/quota.ts, sin LLM)`);
  console.log(`==================================================\n`);

  const userConflict = await makeProUser("conflict");
  const jobsConflict = await makeFictionalJobs(1, "conflict");
  const userLimit = await makeProUser("limit");
  const jobsLimit = await makeFictionalJobs(4, "limit");
  const userRace = await makeProUser("race");
  const jobsRace = await makeFictionalJobs(5, "race");

  try {
    console.log(`🔍 [Grupo 1] Manejo de conflicto por (user_id, job_id)...`);
    {
      const r1 = await reserveGenerationQuota({
        userId: userConflict,
        tier: "pro",
        jobId: jobsConflict[0]!,
        jobTitle: "Vacante",
        jobCompany: "Empresa",
        modelOption: "standard"
      });
      check("Primera reserva exitosa", typeof r1.id === "string");

      try {
        await reserveGenerationQuota({
          userId: userConflict,
          tier: "pro",
          jobId: jobsConflict[0]!,
          jobTitle: "Vacante",
          jobCompany: "Empresa",
          modelOption: "standard"
        });
        check("Reservar de nuevo mientras status=reserved lanza GenerationConflictError", false, "no lanzó nada");
      } catch (e) {
        check("Reservar de nuevo mientras status=reserved lanza GenerationConflictError", e instanceof GenerationConflictError, String(e));
      }

      await failGeneration(r1.id);
      const r2 = await reserveGenerationQuota({
        userId: userConflict,
        tier: "pro",
        jobId: jobsConflict[0]!,
        jobTitle: "Vacante",
        jobCompany: "Empresa",
        modelOption: "standard"
      });
      check("Tras marcar failed, re-reservar la MISMA fila funciona (correr dos veces seguidas no rompe nada)", r2.id === r1.id, `r1=${r1.id} r2=${r2.id}`);

      await completeGeneration(r2.id, { fake: "document" });
      try {
        await reserveGenerationQuota({
          userId: userConflict,
          tier: "pro",
          jobId: jobsConflict[0]!,
          jobTitle: "Vacante",
          jobCompany: "Empresa",
          modelOption: "standard"
        });
        check("Reservar de nuevo tras completed lanza GenerationConflictError (regenerar no es Fase 4)", false, "no lanzó nada");
      } catch (e) {
        check("Reservar de nuevo tras completed lanza GenerationConflictError (regenerar no es Fase 4)", e instanceof GenerationConflictError, String(e));
      }
    }

    console.log(`\n🔍 [Grupo 2] Límite real de cuota (${PRO_GENERATIONS_PER_WINDOW}/ventana) — secuencial...`);
    {
      for (let i = 0; i < PRO_GENERATIONS_PER_WINDOW; i++) {
        const r = await reserveGenerationQuota({
          userId: userLimit,
          tier: "pro",
          jobId: jobsLimit[i]!,
          jobTitle: "Vacante",
          jobCompany: "Empresa",
          modelOption: "standard"
        });
        check(`Reserva ${i + 1}/${PRO_GENERATIONS_PER_WINDOW} exitosa`, typeof r.id === "string");
      }
      try {
        await reserveGenerationQuota({
          userId: userLimit,
          tier: "pro",
          jobId: jobsLimit[PRO_GENERATIONS_PER_WINDOW]!,
          jobTitle: "Vacante",
          jobCompany: "Empresa",
          modelOption: "standard"
        });
        check(`La reserva ${PRO_GENERATIONS_PER_WINDOW + 1} lanza QuotaExceededError`, false, "no lanzó nada");
      } catch (e) {
        check(`La reserva ${PRO_GENERATIONS_PER_WINDOW + 1} lanza QuotaExceededError`, e instanceof QuotaExceededError, String(e));
      }
    }

    console.log(`\n🔍 [Grupo 3] N solicitudes SIMULTÁNEAS contra cuota baja — exactamente ${PRO_GENERATIONS_PER_WINDOW} pasan...`);
    {
      const attempts = await Promise.allSettled(
        jobsRace.map((jobId) =>
          reserveGenerationQuota({
            userId: userRace,
            tier: "pro",
            jobId,
            jobTitle: "Vacante concurrente",
            jobCompany: "Empresa",
            modelOption: "standard"
          })
        )
      );
      const succeeded = attempts.filter((a) => a.status === "fulfilled");
      const rejected = attempts.filter((a) => a.status === "rejected");
      check(
        `Exactamente ${PRO_GENERATIONS_PER_WINDOW} de ${jobsRace.length} solicitudes simultáneas tuvieron éxito`,
        succeeded.length === PRO_GENERATIONS_PER_WINDOW,
        `succeeded=${succeeded.length}`
      );
      check(
        `Las ${jobsRace.length - PRO_GENERATIONS_PER_WINDOW} restantes fueron QuotaExceededError, no otro error`,
        rejected.every((a) => a.status === "rejected" && (a.reason as Error) instanceof QuotaExceededError),
        JSON.stringify(rejected.map((a) => (a as PromiseRejectedResult).reason?.message))
      );

      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM cv_generations WHERE user_id = $1 AND status = 'reserved'`,
        [userRace]
      );
      check(
        `La BD real confirma exactamente ${PRO_GENERATIONS_PER_WINDOW} filas 'reserved' (no una race condition escondida)`,
        Number(rows[0]!.count) === PRO_GENERATIONS_PER_WINDOW,
        `filas=${rows[0]!.count}`
      );
    }

    console.log(`\n🔍 [Grupo 4] getQuotaStatus (Fase 6) — lectura pura, nunca reserva nada...`);
    {
      const userStatus = await makeProUser("status");
      const jobsStatus = await makeFictionalJobs(2, "status");
      try {
        const before = await getQuotaStatus(userStatus, "pro");
        check(
          `Usuario nuevo: used=0, limit=${PRO_GENERATIONS_PER_WINDOW}, remaining=${PRO_GENERATIONS_PER_WINDOW}`,
          before.used === 0 && before.limit === PRO_GENERATIONS_PER_WINDOW && before.remaining === PRO_GENERATIONS_PER_WINDOW,
          JSON.stringify(before)
        );

        const { rows: beforeRows } = await pool.query<{ count: string }>(
          `SELECT COUNT(*) FROM cv_generations WHERE user_id = $1`,
          [userStatus]
        );
        check("Llamar getQuotaStatus no crea ninguna fila en cv_generations", Number(beforeRows[0]!.count) === 0, beforeRows[0]!.count);

        const r1 = await reserveGenerationQuota({
          userId: userStatus,
          tier: "pro",
          jobId: jobsStatus[0]!,
          jobTitle: "Vacante",
          jobCompany: "Empresa",
          modelOption: "standard"
        });
        const afterReserve = await getQuotaStatus(userStatus, "pro");
        check(
          `Tras 1 reserva: used=1, remaining=${PRO_GENERATIONS_PER_WINDOW - 1} (refleja lo reservado, no solo lo completado)`,
          afterReserve.used === 1 && afterReserve.remaining === PRO_GENERATIONS_PER_WINDOW - 1,
          JSON.stringify(afterReserve)
        );

        await completeGeneration(r1.id, { fake: "document" });
        const afterComplete = await getQuotaStatus(userStatus, "pro");
        check(
          "Tras completar (no re-reservar), used sigue en 1 — completar no cobra dos veces",
          afterComplete.used === 1,
          JSON.stringify(afterComplete)
        );

        await failGeneration(
          (
            await reserveGenerationQuota({
              userId: userStatus,
              tier: "pro",
              jobId: jobsStatus[1]!,
              jobTitle: "Vacante 2",
              jobCompany: "Empresa",
              modelOption: "standard"
            })
          ).id
        );
        const afterFail = await getQuotaStatus(userStatus, "pro");
        check(
          "Una reserva luego marcada failed nunca cuenta contra la cuota (used sigue en 1)",
          afterFail.used === 1,
          JSON.stringify(afterFail)
        );
      } finally {
        await cleanupUser(userStatus);
        await cleanupJobs(jobsStatus);
      }
    }

    console.log(`\n🔍 [Grupo 5] Pro Max — créditos por opción (§6.5.2, Fase 11)...`);
    {
      const userProMax = await makeProMaxUser("credits");
      const jobsProMax = await makeFictionalJobs(4, "credits");
      try {
        check(
          "MODEL_OPTION_CREDIT_COST refleja §6.5.2 (3/5/6)",
          MODEL_OPTION_CREDIT_COST.standard === 3 &&
            MODEL_OPTION_CREDIT_COST.premium === 5 &&
            MODEL_OPTION_CREDIT_COST.compare === 6,
          JSON.stringify(MODEL_OPTION_CREDIT_COST)
        );

        // Caso EXACTO del criterio de salida de Fase 11: Pro Max con 4
        // créditos restantes que pide "Comparar" (6) se rechaza ANTES de
        // generar nada, sin gastar. 2 x "premium" (5c c/u) = 10, deja
        // remaining=4 exactamente sobre los 14 del plan (§12 punto 8).
        for (let i = 0; i < 2; i++) {
          await reserveGenerationQuota({
            userId: userProMax,
            tier: "pro_max",
            jobId: jobsProMax[i]!,
            jobTitle: "Vacante",
            jobCompany: "Empresa",
            modelOption: "premium",
            proMaxCreditCost: MODEL_OPTION_CREDIT_COST.premium
          });
        }
        const statusBefore = await getQuotaStatus(userProMax, "pro_max");
        check(
          `Setup del caso exacto del plan: tras 2x Premium (5c c/u), used=10, remaining=4`,
          statusBefore.used === 10 && statusBefore.remaining === 4,
          JSON.stringify(statusBefore)
        );

        const compareJob = await makeFictionalJobs(1, "credits-compare");
        jobsProMax.push(...compareJob);
        let thrown: unknown;
        try {
          await reserveGenerationQuota({
            userId: userProMax,
            tier: "pro_max",
            jobId: compareJob[0]!,
            jobTitle: "Vacante Comparar",
            jobCompany: "Empresa",
            modelOption: "compare",
            proMaxCreditCost: MODEL_OPTION_CREDIT_COST.compare
          });
        } catch (e) {
          thrown = e;
        }
        check(
          'Pro Max con 4 créditos pidiendo "Comparar" (6) lanza QuotaExceededError, sin gastar nada',
          thrown instanceof QuotaExceededError,
          String(thrown)
        );

        const statusAfter = await getQuotaStatus(userProMax, "pro_max");
        check(
          "La cuota no cambió tras el rechazo (remaining sigue en 4, cero filas nuevas)",
          statusAfter.remaining === 4 && statusAfter.used === statusBefore.used,
          JSON.stringify(statusAfter)
        );

        const { rows: compareRows } = await pool.query<{ count: string }>(
          `SELECT COUNT(*) FROM cv_generations WHERE user_id = $1 AND job_id = $2`,
          [userProMax, compareJob[0]]
        );
        check(
          'Ninguna fila quedó "reserved" para el intento de Comparar rechazado',
          Number(compareRows[0]!.count) === 0,
          compareRows[0]!.count
        );
      } finally {
        await cleanupUser(userProMax);
        await cleanupJobs(jobsProMax);
      }
    }

    console.log(`\n🔍 [Grupo 6] Fase 14 (cutover de facturación) — regenerar con BYOK no cobra créditos, con el fallback del operador sigue cobrando igual que siempre...`);
    {
      const userByok = await makeProUser("byok-billing");
      const jobsByok = await makeFictionalJobs(1, "byok-billing");
      try {
        // Fila 'completed' sembrada directo (sin pipeline real, sin LLM) —
        // simula una generación previa ya cobrada (1 crédito, tier Pro).
        const { rows: seedRows } = await pool.query<{ id: string }>(
          `INSERT INTO cv_generations (user_id, job_id, job_title, job_company, status, model_option, credits_charged, document_json)
           VALUES ($1, $2, 'Vacante', 'Empresa', 'completed', 'standard', $3, '{}'::jsonb)
           RETURNING id`,
          [userByok, jobsByok[0], PRO_CREDIT_COST]
        );
        const generationId = seedRows[0]!.id;

        const statusInitial = await getQuotaStatus(userByok, "pro");
        check(
          "Setup: 1 generación previa ya cobrada, used=1",
          statusInitial.used === PRO_CREDIT_COST,
          JSON.stringify(statusInitial)
        );

        // Regenerar financiado con BYOK — 0 créditos, sin importar el tier.
        await reserveRegenerationQuota({
          userId: userByok,
          tier: "pro",
          generationId,
          modelOption: "standard",
          credentialSource: "user_byok"
        });
        const { rows: afterByok } = await pool.query<{ credits_charged: number; status: string }>(
          `SELECT credits_charged, status FROM cv_generations WHERE id = $1`,
          [generationId]
        );
        check(
          "Reserva BYOK: credits_charged NO subió (sigue en 1, la regeneración cuesta 0)",
          afterByok[0]!.credits_charged === PRO_CREDIT_COST,
          JSON.stringify(afterByok[0])
        );
        check("Reserva BYOK: la fila queda 'reserved' igual que cualquier reserva", afterByok[0]!.status === "reserved");
        const statusAfterByok = await getQuotaStatus(userByok, "pro");
        check(
          "getQuotaStatus tras BYOK: used sigue en 1 (la regeneración BYOK no se sumó)",
          statusAfterByok.used === PRO_CREDIT_COST,
          JSON.stringify(statusAfterByok)
        );

        // Simula que el pipeline terminó bien (sin correr el pipeline real
        // — completeGeneration ya está probado en Fase 7/9, no se repite
        // aquí) y confirma la reserva del PREVIO estado antes de probar el
        // camino de operador.
        await completeGeneration(generationId, {});

        // Regenerar financiado con el fallback del operador (ausente,
        // mismo default de siempre) — SÍ cobra, exactamente como hoy.
        await reserveRegenerationQuota({
          userId: userByok,
          tier: "pro",
          generationId,
          modelOption: "standard"
        });
        const { rows: afterOperator } = await pool.query<{ credits_charged: number }>(
          `SELECT credits_charged FROM cv_generations WHERE id = $1`,
          [generationId]
        );
        check(
          "Reserva con fallback del operador: credits_charged SÍ subió (1 → 2, cobra igual que siempre)",
          afterOperator[0]!.credits_charged === PRO_CREDIT_COST * 2,
          JSON.stringify(afterOperator[0])
        );
        const statusAfterOperator = await getQuotaStatus(userByok, "pro");
        check(
          "getQuotaStatus tras el fallback del operador: used=2",
          statusAfterOperator.used === PRO_CREDIT_COST * 2,
          JSON.stringify(statusAfterOperator)
        );
      } finally {
        await cleanupUser(userByok);
        await cleanupJobs(jobsByok);
      }
    }
  } finally {
    await cleanupUser(userConflict);
    await cleanupUser(userLimit);
    await cleanupUser(userRace);
    await cleanupJobs([...jobsConflict, ...jobsLimit, ...jobsRace]);
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] Reserva transaccional de cuota verificada contra Postgres real, incluida la carrera concurrente.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  process.exit(1);
});
