/**
 * Validation suite for the company-reputation batch pipeline
 * (docs/COMPANY-REPUTATION-PLAN.md): the generalized executeWithResilience<T>,
 * company-reputation-repository.ts's upsert/lookup, and (Fase R2) the Merco
 * Talento fetcher's HTML parsing.
 *
 * Deliberately no live network call to Merco (or any real source) in this
 * suite — parseMercoTalentoHtml() is tested against real, saved fixtures
 * instead (tests/fixtures/merco-talento-sample.html, a trimmed but faithful
 * excerpt of the real public ranking page captured this session). The real
 * end-to-end fetch is verified once by hand during manual QA
 * (docs/QA-CHECKLIST-REPUTATION.md), same reasoning tests/validate-adapters.ts
 * already accepts for its own live characterization tests, kept separate
 * from this file's read/write-only-test-rows convention.
 *
 * This suite is entirely read/write against test-only rows it creates and
 * cleans up itself, same security posture as tests/validate-seo-job-pages.ts:
 * this project has no separate test database (the same DATABASE_URL backs
 * local dev and production), so every write here targets only
 * `company_reputation`/`company_reputation_alias`/`source_circuit_state`
 * with fake, clearly-marked identifiers, and every row is deleted in a
 * `finally`. Never touches `jobs`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { executeWithResilience, isSourceDegraded } from "../src/engine/resilient-fetch.js";
import {
  upsertReputationScores,
  upsertReputationAliases,
  getReputationForCompanies
} from "../src/db/company-reputation-repository.js";
import { REPUTATION_SOURCES } from "../src/sources/reputation/index.js";
import { ReputationScoreInput } from "../src/sources/reputation/types.js";
import { parseMercoTalentoHtml } from "../src/sources/reputation/merco.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

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

// --- Part 2: REPUTATION_SOURCES has exactly the sources built so far ------

function runRegistryTests() {
  console.log(`\n--- Parte 2: registro de fuentes (Merco Talento, Fase R2 — nada más todavía) ---\n`);

  check(
    Array.isArray(REPUTATION_SOURCES) &&
      REPUTATION_SOURCES.length === 1 &&
      REPUTATION_SOURCES[0].name === "Merco Talento",
    "REPUTATION_SOURCES tiene exactamente el fetcher de Merco Talento (Fase R2) — GPTW/Computrabajo llegan en R3/R4.",
    `REPUTATION_SOURCES no tiene el estado esperado: ${JSON.stringify(REPUTATION_SOURCES.map((s) => s.name))}`
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

// --- Part 4: parseMercoTalentoHtml() against real, saved fixtures ---------

function runMercoParserTests() {
  console.log(`\n--- Parte 4: parseMercoTalentoHtml() contra fixtures reales (sin red) ---\n`);

  const realHtml = fs.readFileSync(path.join(FIXTURES_DIR, "merco-talento-sample.html"), "utf-8");
  const rows = parseMercoTalentoHtml(realHtml);

  check(
    rows.length === 200,
    `parseMercoTalentoHtml() parsea las 200 filas reales del fixture (obtuvo ${rows.length}).`,
    `parseMercoTalentoHtml() parseó ${rows.length} filas, se esperaban 200.`
  );
  check(
    rows[0].companyName === "BANCOLOMBIA" && rows[0].score === 10000,
    "La primera fila parseada coincide con el dato real (BANCOLOMBIA, 10000).",
    `La primera fila no coincide: ${JSON.stringify(rows[0])}`
  );
  check(
    rows.every((r) => r.source === "merco" && r.scoreScale === "merco-talento-index" && r.reviewCount === null),
    "Todas las filas traen source/scoreScale consistentes y reviewCount null (Merco no tiene ese dato).",
    "Alguna fila no trae los campos fijos esperados."
  );
  check(
    rows.some((r) => r.companyName === "NESTLÉ"),
    "Los nombres con entidades HTML numéricas se decodifican correctamente (ej. NESTLÉ, no NESTL&#201;).",
    `No se encontró "NESTLÉ" decodificado entre los nombres: ${rows.slice(0, 15).map((r) => r.companyName)}`
  );

  const fallbackHtml = fs.readFileSync(path.join(FIXTURES_DIR, "merco-fallback-sample.html"), "utf-8");
  let threwOnFallback = false;
  try {
    parseMercoTalentoHtml(fallbackHtml);
  } catch {
    threwOnFallback = true;
  }
  check(
    threwOnFallback,
    "parseMercoTalentoHtml() lanza error ante la página de fallback ('la página no existe') en vez de devolver datos parciales.",
    "parseMercoTalentoHtml() no lanzó error ante el fixture de fallback — riesgo de guardar datos corruptos/parciales."
  );
}

// --- Part 5: alias table + batched company lookup (own test rows only) ---

async function runAliasAndLookupTests() {
  console.log(`\n--- Parte 5: alias curados + getReputationForCompanies() (filas de prueba propias) ---\n`);

  const testCompany = `__TEST ALIAS COMPANY ${Date.now()}__`;
  const testRaw = `__test raw name ${Date.now()}__`;
  const testSource = "test";

  try {
    await upsertReputationScores([
      {
        companyName: testCompany,
        source: testSource,
        score: 88,
        scoreScale: "0-100",
        reviewCount: 5,
        sourceUrl: "https://example.com/alias-test"
      }
    ]);
    await upsertReputationAliases([
      { rawCompanyName: testRaw, source: testSource, canonicalName: testCompany }
    ]);

    const resolved = await getReputationForCompanies([testRaw, "__empresa sin alias, no debe aparecer__"]);
    const entries = resolved.get(testRaw);

    check(
      Boolean(entries) && entries!.length === 1 && entries![0].score === 88,
      "Una empresa con alias confirmado resuelve su reputación real vía el join alias→company_reputation.",
      `getReputationForCompanies() no resolvió la fila esperada: ${JSON.stringify(resolved)}`
    );
    check(
      !resolved.has("__empresa sin alias, no debe aparecer__"),
      "Una empresa sin alias confirmado no aparece en el resultado — nunca un fuzzy-match improvisado en tiempo de lectura.",
      "Una empresa sin alias apareció en el resultado — riesgo de dato inventado."
    );
  } finally {
    await pool.query(`DELETE FROM company_reputation_alias WHERE raw_company_name = $1 AND source = $2`, [
      testRaw,
      testSource
    ]);
    await pool.query(`DELETE FROM company_reputation WHERE company_name = $1 AND source = $2`, [
      testCompany,
      testSource
    ]);
  }
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Reputación de empleador (Fases R1 + R2)`);
  console.log(`==================================================`);

  await runResilienceTests();
  runRegistryTests();
  await runUpsertTests();
  runMercoParserTests();
  await runAliasAndLookupTests();

  console.log(`\n==================================================`);
  if (failures > 0) {
    console.error(`❌ [TEST SUITE FAILED] ${failures} verificación(es) fallaron.`);
    console.log(`==================================================\n`);
    process.exit(1);
  }
  console.log(`🎉 [TEST SUITE PASSED] Pipeline de reputación de empleador (esqueleto + Merco Talento) verificado.`);
  console.log(`==================================================\n`);
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  await pool.end();
  process.exit(1);
});
