/**
 * Validation suite for the company-reputation batch pipeline skeleton
 * (docs/COMPANY-REPUTATION-PLAN.md, Fase R1): the generalized
 * executeWithResilience<T>, company-reputation-repository.ts's upsert, and
 * scripts/run-reputation-tick.ts end-to-end with zero fetchers registered.
 *
 * No real fetcher exists yet (Fase R2 adds the first one, Merco Talento) —
 * this suite is entirely read/write against test-only rows it creates and
 * cleans up itself, same security posture as tests/validate-seo-job-pages.ts:
 * this project has no separate test database (the same DATABASE_URL backs
 * local dev and production), so every write here targets only
 * `company_reputation`/`source_circuit_state` with fake, clearly-marked
 * identifiers, and every row is deleted in a `finally`. Never touches `jobs`.
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { executeWithResilience, isSourceDegraded } from "../src/engine/resilient-fetch.js";
import { upsertReputationScores } from "../src/db/company-reputation-repository.js";
import { REPUTATION_SOURCES } from "../src/sources/reputation/index.js";
import { ReputationScoreInput } from "../src/sources/reputation/types.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;

function check(condition: boolean, passMsg: string, failMsg: string) {
  if (condition) {
    console.log(`✅ [PASSED] ${passMsg}`);
  } else {
    console.error(`❌ [FAILED] ${failMsg}`);
    failures++;
  }
}

// --- Part 1: executeWithResilience<T> is genuinely generic, not Job-only ---

async function runResilienceTests() {
  console.log(`\n--- Parte 1: executeWithResilience<T> genérico (circuit breaker real, filas de prueba) ---\n`);

  const fakeSource = `__test-reputation-source-${Date.now()}__`;

  try {
    const fakeRows: ReputationScoreInput[] = [
      {
        companyName: "EMPRESA DE PRUEBA S.A.S",
        source: "test",
        score: 99,
        scoreScale: "0-100",
        reviewCount: 1,
        sourceUrl: "https://example.com/prueba"
      }
    ];
    const results = await executeWithResilience<ReputationScoreInput>(fakeSource, async () => fakeRows);
    check(
      results === fakeRows,
      "executeWithResilience<ReputationScoreInput>() pasa un tipo distinto a Job sin problema (genérico real, no solo de nombre).",
      "executeWithResilience<ReputationScoreInput>() no devolvió el resultado esperado."
    );

    const degradedAfterSuccess = await isSourceDegraded(fakeSource);
    check(
      degradedAfterSuccess === false,
      "Una fuente que respondió con éxito no queda marcada como degradada.",
      "Una fuente exitosa quedó marcada como degradada — no debería."
    );

    // recordFailure() persists ONE failure per executeWithResilience() call
    // that exhausts its own internal retries — not once per retry attempt
    // (see schema.sql's comment on source_circuit_state: 3 consecutive
    // failures ACROSS TICKS trip the breaker, since each GitHub Actions
    // tick is a fresh process). So tripping it here means 3 separate calls
    // (maxRetries=1 each, so every call fails fast), same as 3 real ticks
    // in a row would — not 3 retries inside a single call.
    const failingFetcher = async (): Promise<ReputationScoreInput[]> => {
      throw new Error("fallo simulado de prueba");
    };
    for (let i = 0; i < 3; i++) {
      await executeWithResilience<ReputationScoreInput>(fakeSource, failingFetcher, 1);
    }
    const degradedAfterFailures = await isSourceDegraded(fakeSource);
    check(
      degradedAfterFailures === true,
      "Tras 3 fallos consecutivos, la fuente de prueba queda marcada como degradada (mismo circuit breaker que ya usan los 13 adaptadores de vacantes).",
      "La fuente de prueba no quedó degradada tras 3 fallos consecutivos."
    );
  } finally {
    await pool.query(`DELETE FROM source_circuit_state WHERE source_name = $1`, [fakeSource]);
  }
}

// --- Part 2: REPUTATION_SOURCES is deliberately empty in Fase R1 ----------

function runRegistryTests() {
  console.log(`\n--- Parte 2: registro de fuentes (debe estar vacío hasta la Fase R2) ---\n`);

  check(
    Array.isArray(REPUTATION_SOURCES) && REPUTATION_SOURCES.length === 0,
    "REPUTATION_SOURCES está vacío — ningún fetcher real corre todavía (Fase R2 registra el primero, Merco Talento).",
    `REPUTATION_SOURCES tiene ${REPUTATION_SOURCES.length} entrada(s) — se esperaba 0 en esta fase.`
  );
}

// --- Part 3: upsertReputationScores — insert + upsert semantics -----------

async function runUpsertTests() {
  console.log(`\n--- Parte 3: upsertReputationScores() (escribe y borra sus propias filas de prueba) ---\n`);

  const testCompany = `__TEST COMPANY ${Date.now()}__`;
  const testSource = "test";

  try {
    await upsertReputationScores([
      {
        companyName: testCompany,
        source: testSource,
        score: 50,
        scoreScale: "0-100",
        reviewCount: 10,
        sourceUrl: "https://example.com/v1"
      }
    ]);

    const firstRead = await pool.query(
      `SELECT score, review_count, source_url FROM company_reputation WHERE company_name = $1 AND source = $2`,
      [testCompany, testSource]
    );
    check(
      firstRead.rows.length === 1 &&
        Number(firstRead.rows[0].score) === 50 &&
        firstRead.rows[0].review_count === 10,
      "upsertReputationScores() inserta una fila nueva con los valores correctos.",
      `La fila insertada no tiene los valores esperados: ${JSON.stringify(firstRead.rows)}`
    );

    // Same (company_name, source) key, different values — must update in
    // place (ON CONFLICT), never create a second row.
    await upsertReputationScores([
      {
        companyName: testCompany,
        source: testSource,
        score: 75,
        scoreScale: "0-100",
        reviewCount: 20,
        sourceUrl: "https://example.com/v2"
      }
    ]);

    const secondRead = await pool.query(
      `SELECT score, review_count, source_url FROM company_reputation WHERE company_name = $1 AND source = $2`,
      [testCompany, testSource]
    );
    check(
      secondRead.rows.length === 1 &&
        Number(secondRead.rows[0].score) === 75 &&
        secondRead.rows[0].review_count === 20 &&
        secondRead.rows[0].source_url === "https://example.com/v2",
      "Un segundo upsertReputationScores() con la misma (company_name, source) actualiza la fila en vez de duplicarla.",
      `El upsert no actualizó correctamente la fila existente: ${JSON.stringify(secondRead.rows)}`
    );
  } finally {
    await pool.query(`DELETE FROM company_reputation WHERE company_name = $1 AND source = $2`, [
      testCompany,
      testSource
    ]);
  }
}

// --- Part 4: the real script runs cleanly end-to-end with 0 sources -------

function runScriptEndToEnd(): Promise<void> {
  console.log(`\n--- Parte 4: scripts/run-reputation-tick.ts corre limpio de punta a punta (0 fuentes) ---\n`);

  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, "..", "scripts", "run-reputation-tick.ts");
    const child = spawn("npx", ["tsx", scriptPath], {
      cwd: path.join(__dirname, ".."),
      shell: true,
      env: process.env
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.on("close", (code) => {
      check(
        code === 0,
        "run-reputation-tick.ts termina con código 0 (todo el cableado compila y corre sin errores).",
        `run-reputation-tick.ts terminó con código ${code}. Salida: ${stdout.slice(-500)}`
      );
      check(
        stdout.includes("0 fuente(s) registrada(s)") && stdout.includes("Total upserted: 0"),
        "run-reputation-tick.ts reporta 0 fuentes y 0 filas actualizadas — estado real y honesto de la Fase R1.",
        `La salida no reportó el estado vacío esperado: ${stdout.slice(-500)}`
      );
      resolve();
    });
  });
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Reputación de empleador, Fase R1 (esqueleto)`);
  console.log(`==================================================`);

  await runResilienceTests();
  runRegistryTests();
  await runUpsertTests();
  await runScriptEndToEnd();

  console.log(`\n==================================================`);
  if (failures > 0) {
    console.error(`❌ [TEST SUITE FAILED] ${failures} verificación(es) fallaron.`);
    console.log(`==================================================\n`);
    process.exit(1);
  }
  console.log(`🎉 [TEST SUITE PASSED] Esqueleto de reputación de empleador verificado.`);
  console.log(`==================================================\n`);
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  await pool.end();
  process.exit(1);
});
