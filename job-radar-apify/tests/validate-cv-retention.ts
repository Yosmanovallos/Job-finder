// Real Postgres, no LLM, no mocks — the retention job is pure SQL against
// real state (docs/CV-GENERATION-PLAN.md §8.3, Fase 9). Uses the `now`
// test seam on `cleanupExpiredCvData` (same idiom as `quota.ts`'s
// `usedInWindow`) so every case is anchored to a fixed reference instant
// instead of the real system clock — no flakiness, no waiting.
import crypto from "crypto";
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { getOrCreateUser, upgradeUserToPro } from "../src/db/job-repository.js";
import { cleanupExpiredCvData } from "../src/db/cv-retention-repository.js";
import { getCvFacts, getCvProfileStatus } from "../src/db/cv-profile-repository.js";

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

const NOW = new Date("2026-08-08T12:00:00.000Z");
const fixedNow = () => NOW;

interface SeededUser {
  userId: string;
  generationId: string;
}

async function seedUser(label: string, subscriptionEnd: Date | null): Promise<SeededUser> {
  const userId = crypto.randomUUID();
  await getOrCreateUser(userId, `cv_retention_${label}_${Date.now()}@example-test.com`);
  if (subscriptionEnd) {
    await upgradeUserToPro(userId, subscriptionEnd);
  }
  await pool.query(
    `INSERT INTO cv_profiles (user_id, raw_text, facts_json) VALUES ($1, $2, $3)`,
    [userId, `Texto crudo ficticio de prueba (${label}).`, JSON.stringify({ fake: "facts", label })]
  );
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO cv_generations
       (user_id, job_title, job_company, status, model_option, credits_charged, generated_document_json, document_json)
     VALUES ($1, $2, $3, 'completed', 'standard', 1, $4, $4)
     RETURNING id`,
    [userId, `Vacante Ficticia ${label}`, "Empresa Ficticia de Pruebas", JSON.stringify({ fake: "document", label })]
  );
  return { userId, generationId: rows[0]!.id };
}

async function cleanupUser(userId: string) {
  await pool.query(`DELETE FROM cv_generations WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]); // cascades to cv_profiles
}

async function getProfileState(userId: string) {
  const { rows } = await pool.query<{ raw_text: string | null; facts_json: unknown }>(
    `SELECT raw_text, facts_json FROM cv_profiles WHERE user_id = $1`,
    [userId]
  );
  return rows[0]!;
}

async function getGenerationState(generationId: string) {
  const { rows } = await pool.query<{
    generated_document_json: unknown;
    document_json: unknown;
    job_title: string;
    credits_charged: number;
    status: string;
  }>(
    `SELECT generated_document_json, document_json, job_title, credits_charged, status
     FROM cv_generations WHERE id = $1`,
    [generationId]
  );
  return rows[0]!;
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Retención de datos de CV (Fase 9, §8.3)`);
  console.log(`==================================================\n`);

  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

  console.log(`🔍 [Test 1] Suscripción vencida hace más de 30 días de gracia → se limpia...`);
  const expired = await seedUser("expired", daysAgo(31)); // 31 days ago = 1 day past the 30-day grace
  console.log(`\n🔍 [Test 2] Suscripción vencida DENTRO de los 30 días de gracia → no se toca...`);
  const inGrace = await seedUser("in-grace", daysAgo(10));
  console.log(`\n🔍 [Test 3] Usuario nunca fue Pro (subscription_end NULL) → no se toca...`);
  const neverPro = await seedUser("never-pro", null);

  try {
    const result = await cleanupExpiredCvData(fixedNow);
    check("cleanupExpiredCvData corrió sin lanzar", true);

    console.log(`\n📊 Resultado del job: ${JSON.stringify(result)}`);
    check("profilesCleared === 1 (solo la fila vencida hace 31 días)", result.profilesCleared === 1, String(result.profilesCleared));
    check("generationsCleared === 1 (solo esa misma fila)", result.generationsCleared === 1, String(result.generationsCleared));

    const expiredProfile = await getProfileState(expired.userId);
    check("[expired] raw_text quedó NULL", expiredProfile.raw_text === null, String(expiredProfile.raw_text));
    check(
      "[expired] facts_json NO se tocó (§8.3 lo permite conservar)",
      JSON.stringify(expiredProfile.facts_json) === JSON.stringify({ fake: "facts", label: "expired" }),
      JSON.stringify(expiredProfile.facts_json)
    );
    const expiredGen = await getGenerationState(expired.generationId);
    check("[expired] generated_document_json quedó NULL", expiredGen.generated_document_json === null);
    check("[expired] document_json quedó NULL", expiredGen.document_json === null);
    check(
      "[expired] metadata de auditoría (job_title/credits_charged/status) NO se tocó",
      expiredGen.job_title === "Vacante Ficticia expired" && expiredGen.credits_charged === 1 && expiredGen.status === "completed"
    );

    const inGraceProfile = await getProfileState(inGrace.userId);
    check("[in-grace] raw_text SIGUE presente (dentro de la ventana de gracia)", inGraceProfile.raw_text !== null, String(inGraceProfile.raw_text));
    const inGraceGen = await getGenerationState(inGrace.generationId);
    check("[in-grace] generated_document_json SIGUE presente", inGraceGen.generated_document_json !== null);
    check("[in-grace] document_json SIGUE presente", inGraceGen.document_json !== null);

    const neverProProfile = await getProfileState(neverPro.userId);
    check("[never-pro] raw_text SIGUE presente (nunca hubo subscription_end)", neverProProfile.raw_text !== null, String(neverProProfile.raw_text));
    const neverProGen = await getGenerationState(neverPro.generationId);
    check("[never-pro] generated_document_json SIGUE presente", neverProGen.generated_document_json !== null);

    console.log(`\n🔍 [Test 4] Correr el job una segunda vez es idempotente (nada nuevo que limpiar)...`);
    const secondRun = await cleanupExpiredCvData(fixedNow);
    check("Segunda corrida: profilesCleared === 0", secondRun.profilesCleared === 0, String(secondRun.profilesCleared));
    check("Segunda corrida: generationsCleared === 0", secondRun.generationsCleared === 0, String(secondRun.generationsCleared));

    console.log(`\n🔍 [Test 5] --dry-run (AGENTS.md regla 10): mismos conteos, cero escritura...`);
    const dryRunTarget = await seedUser("dry-run", daysAgo(45));
    const dryRunResult = await cleanupExpiredCvData(fixedNow, true);
    check("dry-run reporta profilesCleared === 1 (la fila recién sembrada)", dryRunResult.profilesCleared === 1, String(dryRunResult.profilesCleared));
    const dryRunProfile = await getProfileState(dryRunTarget.userId);
    check("dry-run NO escribió: raw_text sigue presente", dryRunProfile.raw_text !== null, String(dryRunProfile.raw_text));
    const dryRunGen = await getGenerationState(dryRunTarget.generationId);
    check("dry-run NO escribió: generated_document_json sigue presente", dryRunGen.generated_document_json !== null);
    await cleanupUser(dryRunTarget.userId);

    console.log(`\n🔍 [Test 6] Tras limpiar, getCvFacts/getCvProfileStatus rechazan los facts obsoletos (hallazgo real, corregido)...`);
    const staleFactsUser = await seedUser("stale-facts", daysAgo(31));
    // seedUser's default facts_json ({fake:"facts",...}) doesn't pass
    // CvFactsSchema — replace it with a real, schema-valid CvFacts so a
    // null return from getCvFacts below can only mean "raw_text is gone",
    // never a coincidental schema-validation failure.
    await pool.query(`UPDATE cv_profiles SET facts_json = $2 WHERE user_id = $1`, [
      staleFactsUser.userId,
      JSON.stringify({
        contact: { name: "Ana Ficticia Prueba", email: null, phone: null, location: null, linkedin: null },
        summary_raw: null,
        experience: [],
        skills: [],
        education: [],
        certifications: [],
        languages: []
      })
    ]);
    await cleanupExpiredCvData(fixedNow); // clears this user's raw_text, keeps facts_json (§8.3)
    const staleStatus = await getCvProfileStatus(staleFactsUser.userId);
    check(
      "getCvProfileStatus: hasFacts=false pese a que facts_json sigue poblado (raw_text ya no está)",
      staleStatus.exists === true && staleStatus.hasFacts === false,
      JSON.stringify(staleStatus)
    );
    const staleFacts = await getCvFacts(staleFactsUser.userId);
    check(
      "getCvFacts devuelve null — nunca generaría un CV real con hechos de un CV ya borrado por retención",
      staleFacts === null,
      JSON.stringify(staleFacts)
    );
    await cleanupUser(staleFactsUser.userId);
  } finally {
    await cleanupUser(expired.userId);
    await cleanupUser(inGrace.userId);
    await cleanupUser(neverPro.userId);
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] Retención de CV verificada contra Postgres real.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado:", err);
  process.exit(1);
});
