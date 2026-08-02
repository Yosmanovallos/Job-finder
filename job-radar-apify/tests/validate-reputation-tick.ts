/**
 * Validation suite for the company-reputation batch pipeline
 * (docs/COMPANY-REPUTATION-PLAN.md): the generalized executeWithResilience<T>,
 * company-reputation-repository.ts's upsert/lookup, the Merco Talento
 * fetcher's HTML parsing (Fase R2), the GPTW Colombia fetcher's
 * date-filtering logic (Fase R3), and Computrabajo's redirect-unwrap +
 * evaluations-page parser (Fase R4).
 *
 * Deliberately no live network call to any real source in this suite —
 * parseMercoTalentoHtml()/filterCurrentCertifications()/parseComputrabajoEvaluationsPage()
 * are tested against real, saved fixtures instead
 * (tests/fixtures/merco-talento-sample.html,
 * tests/fixtures/gptw-certificaciones-sample.json,
 * tests/fixtures/computrabajo-evaluaciones-sample.html — all trimmed but
 * faithful excerpts of the real public data captured this session). The
 * real end-to-end fetch is verified once by hand during manual QA
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
import { spawn, ChildProcess } from "child_process";
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { executeWithResilience, isSourceDegraded } from "../src/engine/resilient-fetch.js";
import {
  upsertReputationScores,
  upsertReputationAliases,
  getReputationForCompanies,
  resolveCompanyBySlug
} from "../src/db/company-reputation-repository.js";
import { REPUTATION_SOURCES } from "../src/sources/reputation/index.js";
import { ReputationScoreInput } from "../src/sources/reputation/types.js";
import { parseMercoTalentoHtml } from "../src/sources/reputation/merco.js";
import { filterCurrentCertifications } from "../src/sources/reputation/gptw.js";
import {
  unwrapGoogleRedirect,
  extractCompanySlugFromJobPageHtml,
  parseComputrabajoEvaluationsPage
} from "../src/sources/reputation/computrabajo.js";
import { buildCompanyPath } from "../src/lib/job-seo.js";

// Own port, distinct from validate-seo-job-pages.ts's (3981) so both can
// run without EADDRINUSE if ever invoked together.
const TEST_PORT = 3982;
const BASE_URL = `http://localhost:${TEST_PORT}`;

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
  console.log(
    `\n--- Parte 1: executeWithResilience<T> genérico (circuit breaker real, filas de prueba) ---\n`
  );

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
    const results = await executeWithResilience<ReputationScoreInput>(
      fakeSource,
      async () => fakeRows
    );
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
  console.log(
    `\n--- Parte 2: registro de fuentes (Merco Talento + GPTW + Computrabajo, Fases R2-R4) ---\n`
  );

  const names = REPUTATION_SOURCES.map((s) => s.name);
  check(
    Array.isArray(REPUTATION_SOURCES) &&
      names.length === 3 &&
      names.includes("Merco Talento") &&
      names.includes("Great Place to Work Colombia") &&
      names.includes("Computrabajo"),
    "REPUTATION_SOURCES tiene exactamente Merco Talento + Great Place to Work Colombia + Computrabajo (Fases R2-R4).",
    `REPUTATION_SOURCES no tiene el estado esperado: ${JSON.stringify(names)}`
  );
}

// --- Part 3: upsertReputationScores — insert + upsert semantics -----------

async function runUpsertTests() {
  console.log(
    `\n--- Parte 3: upsertReputationScores() (escribe y borra sus propias filas de prueba) ---\n`
  );

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
    rows.every(
      (r) =>
        r.source === "merco" && r.scoreScale === "merco-talento-index" && r.reviewCount === null
    ),
    "Todas las filas traen source/scoreScale consistentes y reviewCount null (Merco no tiene ese dato).",
    "Alguna fila no trae los campos fijos esperados."
  );
  check(
    rows.some((r) => r.companyName === "NESTLÉ"),
    "Los nombres con entidades HTML numéricas se decodifican correctamente (ej. NESTLÉ, no NESTL&#201;).",
    `No se encontró "NESTLÉ" decodificado entre los nombres: ${rows.slice(0, 15).map((r) => r.companyName)}`
  );

  const fallbackHtml = fs.readFileSync(
    path.join(FIXTURES_DIR, "merco-fallback-sample.html"),
    "utf-8"
  );
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

// --- Part 5: alias table + batched, multi-source company lookup (own test rows only) ---

async function runAliasAndLookupTests() {
  console.log(
    `\n--- Parte 5: alias curados + getReputationForCompanies() (filas de prueba propias) ---\n`
  );

  const testCompany = `__TEST ALIAS COMPANY ${Date.now()}__`;
  const testRaw = `__test raw name ${Date.now()}__`;
  const testSource = "test";
  // A second source's canonical name for the SAME raw company deliberately
  // differs (real sources rarely agree on exact spelling — see Merco's
  // "BANCOLOMBIA" vs GPTW's "Bancolombia") — this is exactly the real
  // scenario R3 introduced: Accenture/Deloitte/Compensar/etc. now have
  // both a Merco and a GPTW alias for the same raw jobs.company value.
  const testSource2 = "test2";
  const testCompany2 = `__TEST ALIAS COMPANY 2 ${Date.now()}__`;

  try {
    await upsertReputationScores([
      {
        companyName: testCompany,
        source: testSource,
        score: 88,
        scoreScale: "0-100",
        reviewCount: 5,
        sourceUrl: "https://example.com/alias-test"
      },
      {
        companyName: testCompany2,
        source: testSource2,
        score: null,
        scoreScale: "certified",
        reviewCount: null,
        sourceUrl: "https://example.com/alias-test-2"
      }
    ]);
    await upsertReputationAliases([
      { rawCompanyName: testRaw, source: testSource, canonicalName: testCompany },
      { rawCompanyName: testRaw, source: testSource2, canonicalName: testCompany2 }
    ]);

    const resolved = await getReputationForCompanies([
      testRaw,
      "__empresa sin alias, no debe aparecer__"
    ]);
    const entries = resolved.get(testRaw);

    check(
      Boolean(entries) && entries!.length === 2,
      "Una empresa con alias confirmado en DOS fuentes resuelve las DOS entradas (caso real desde R3: Accenture/Deloitte/etc. tienen alias de Merco y GPTW a la vez).",
      `getReputationForCompanies() no resolvió las 2 filas esperadas: ${JSON.stringify(resolved)}`
    );
    check(
      Boolean(entries?.find((e) => e.source === testSource && e.score === 88)) &&
        Boolean(entries?.find((e) => e.source === testSource2 && e.score === null)),
      "Cada entrada mantiene el score/escala de su propia fuente — nunca se mezclan/promedian entre sí.",
      `Las entradas de las 2 fuentes no coinciden con lo esperado: ${JSON.stringify(entries)}`
    );
    check(
      !resolved.has("__empresa sin alias, no debe aparecer__"),
      "Una empresa sin alias confirmado no aparece en el resultado — nunca un fuzzy-match improvisado en tiempo de lectura.",
      "Una empresa sin alias apareció en el resultado — riesgo de dato inventado."
    );
  } finally {
    await pool.query(
      `DELETE FROM company_reputation_alias WHERE raw_company_name = $1 AND source IN ($2, $3)`,
      [testRaw, testSource, testSource2]
    );
    await pool.query(`DELETE FROM company_reputation WHERE company_name = $1 AND source = $2`, [
      testCompany,
      testSource
    ]);
    await pool.query(`DELETE FROM company_reputation WHERE company_name = $1 AND source = $2`, [
      testCompany2,
      testSource2
    ]);
  }
}

// --- Part 6: filterCurrentCertifications() against a real GPTW fixture ---
//
// The fixture (tests/fixtures/gptw-certificaciones-sample.json) is the
// real, live response this session for /wp-json/wp/v2/certificaciones:
// the ~154 rows within the 395-day validity window as of 2026-08-01, plus
// 5 genuinely old (Feb 2021) rows — so this exercises the actual date
// cutoff against real data, not synthetic dates. `now` is pinned to when
// the fixture was captured so the test stays deterministic regardless of
// when it's actually run later.

function runGptwParserTests() {
  console.log(`\n--- Parte 6: filterCurrentCertifications() contra el fixture real de GPTW ---\n`);

  const fixture = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, "gptw-certificaciones-sample.json"), "utf-8")
  );
  const fixedNow = new Date("2026-08-01T00:00:00Z");
  const current = filterCurrentCertifications(fixture, fixedNow);

  check(
    current.length === 154,
    `filterCurrentCertifications() conserva las 154 certificaciones vigentes reales del fixture (obtuvo ${current.length}).`,
    `filterCurrentCertifications() devolvió ${current.length} filas, se esperaban 154.`
  );
  check(
    !current.some((r) => r.companyName.includes("Ladrillera Santafé")),
    "Las certificaciones viejas (2021, fuera de la ventana de 395 días) quedan excluidas — nunca se muestran como vigentes.",
    "Una certificación de 2021 pasó el filtro de vigencia — riesgo de mostrar una insignia vencida como actual."
  );
  check(
    current.every(
      (r) => r.source === "gptw" && r.score === null && r.scoreScale === "gptw-certified"
    ),
    "Todas las filas traen source/score/scoreScale consistentes (GPTW es binaria: nunca un score inventado).",
    "Alguna fila no trae los campos fijos esperados para una fuente sin score continuo."
  );
  check(
    current.some((r) => r.companyName === "Dr. Reddy’s") &&
      current.some((r) => r.companyName === "Autogermana & Compañías"),
    "Los nombres con entidades HTML numéricas se decodifican correctamente (ej. &#8217; → ', &#038; → &).",
    `No se encontraron los nombres decodificados esperados entre: ${current.slice(0, 10).map((r) => r.companyName)}`
  );
}

// --- Part 7: resolveCompanyBySlug() (empresas/:slug) -----------------------
//
// Uses real, permanent seed data (scripts/seed-merco-aliases.ts already
// ran "Bancolombia" → "BANCOLOMBIA" into production) instead of test-only
// rows — same reasoning as the Merco/GPTW parser tests trusting real
// fixtures: this is stable curated data, not something that flakes.

async function runCompanySlugTests() {
  console.log(`\n--- Parte 7: resolveCompanyBySlug() (/empresas/:slug) ---\n`);

  const resolved = await resolveCompanyBySlug("bancolombia");
  check(
    resolved === "Bancolombia",
    `resolveCompanyBySlug("bancolombia") resuelve al nombre real curado ("Bancolombia").`,
    `resolveCompanyBySlug("bancolombia") devolvió "${resolved}", se esperaba "Bancolombia".`
  );

  const notFound = await resolveCompanyBySlug("esto-no-es-una-empresa-real-de-verdad");
  check(
    notFound === null,
    "Un slug que no matchea ningún alias confirmado devuelve null — nunca un fuzzy-match.",
    `resolveCompanyBySlug() devolvió "${notFound}" para un slug inventado, se esperaba null.`
  );
}

// --- Part 8: GET /api/companies/:slug end-to-end ---------------------------

async function waitForServer(maxAttempts = 40, delayMs = 250): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`El servidor no respondió en ${maxAttempts * delayMs}ms`);
}

function startServer(): ChildProcess {
  const serverPath = path.join(__dirname, "..", "src", "server.ts");
  return spawn("npx", ["tsx", serverPath], {
    cwd: path.join(__dirname, ".."),
    shell: true,
    detached: true,
    env: { ...process.env, PORT: String(TEST_PORT) }
  });
}

function killServerTree(server: ChildProcess): void {
  if (server.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // Group may already be gone.
    }
  }
}

async function runCompanyEndpointTests() {
  console.log(
    `\n--- Parte 8: GET /api/companies/:slug contra un servidor real (solo lectura) ---\n`
  );

  const server = startServer();
  try {
    await waitForServer();

    const slug = buildCompanyPath("Bancolombia").replace("/empresas/", "");
    const apiPath = `/api/companies/${slug}`;
    const res = await fetch(`${BASE_URL}${apiPath}`);
    const body = await res.json();
    check(
      res.status === 200 && body.companyName === "Bancolombia" && Array.isArray(body.reputation),
      `GET ${apiPath} responde 200 con la empresa real y su reputación.`,
      `GET respondió ${res.status} o con forma inesperada: ${JSON.stringify(body).slice(0, 300)}`
    );
    check(
      body.reputation.some((r: any) => r.source === "merco" && typeof r.score === "number"),
      "La reputación de Bancolombia incluye el score real de Merco Talento.",
      `No se encontró la entrada de Merco esperada: ${JSON.stringify(body.reputation)}`
    );

    const notFoundRes = await fetch(`${BASE_URL}/api/companies/esto-no-es-una-empresa-real`);
    check(
      notFoundRes.status === 404,
      "Un slug de empresa inventado responde 404 real.",
      `Un slug inventado respondió ${notFoundRes.status} en vez de 404.`
    );

    // A real company with NO curated reputation must still resolve (the
    // resolveCompanyNameFromJobs fallback in server.ts) — every company a
    // job actually links to gets a working page, never a dead link, even
    // without a reputation section. Picks whatever real company the first
    // page of /api/jobs actually has, rather than hardcoding a name that
    // could rotate out of the live corpus.
    const jobsRes = await fetch(`${BASE_URL}/api/jobs?limit=50`);
    const jobsBody = await jobsRes.json();
    const noReputationJob = jobsBody.jobs.find(
      (j: any) => j.company && (j.reputation || []).length === 0
    );
    if (noReputationJob) {
      const fallbackSlug = buildCompanyPath(noReputationJob.company).replace("/empresas/", "");
      const fallbackRes = await fetch(`${BASE_URL}/api/companies/${fallbackSlug}`);
      const fallbackBody = await fallbackRes.json();
      check(
        fallbackRes.status === 200 &&
          fallbackBody.companyName === noReputationJob.company &&
          fallbackBody.reputation.length === 0 &&
          fallbackBody.jobs.length > 0,
        `Una empresa real sin reputación curada ("${noReputationJob.company}") igual resuelve 200 con sus vacantes reales, reputation vacío (nunca inventado).`,
        `El fallback no resolvió correctamente para "${noReputationJob.company}": ${fallbackRes.status}, ${JSON.stringify(fallbackBody).slice(0, 300)}`
      );
    } else {
      console.warn(
        "⚠️ [SKIPPED] No se encontró en la primera página ninguna vacante de una empresa sin reputación — normal si el corpus cambió, no es una falla."
      );
    }
  } finally {
    killServerTree(server);
  }
}

// --- Part 9: Computrabajo — unwrapGoogleRedirect() + evaluations parser ---
//
// The fixture (tests/fixtures/computrabajo-evaluaciones-sample.html) is a
// trimmed but faithful excerpt of a real
// co.computrabajo.com/soletanche/evaluaciones response captured live this
// session (score 4,6 with the real Spanish decimal comma, 569 real
// reviews) — same "real, saved fixture, no live network in this suite"
// convention as Merco/GPTW. The live end-to-end discovery (job page →
// slug → Referer-gated evaluations fetch) is only verified by hand in
// manual QA (docs/QA-CHECKLIST-REPUTATION.md §5) — it can't be exercised
// safely in an automated suite that might run repeatedly, given this
// session's own observation that Computrabajo escalates blocking under
// short-window repeated requests.

function runComputrabajoParserTests() {
  console.log(
    `\n--- Parte 9: Computrabajo — unwrapGoogleRedirect() + parser (fixture real, sin red) ---\n`
  );

  const wrapped =
    "https://www.google.com/url?q=https%3A%2F%2Fco.computrabajo.com%2Fsoletanche%2Fempleos&sa=D";
  check(
    unwrapGoogleRedirect(wrapped) === "https://co.computrabajo.com/soletanche/empleos",
    "unwrapGoogleRedirect() extrae la URL real de un wrapper de Google.",
    `unwrapGoogleRedirect() devolvió "${unwrapGoogleRedirect(wrapped)}", no la URL real esperada.`
  );

  const plainUrl = "https://co.computrabajo.com/soletanche/empleos";
  check(
    unwrapGoogleRedirect(plainUrl) === plainUrl,
    "unwrapGoogleRedirect() deja intacta una URL que ya no está envuelta.",
    `unwrapGoogleRedirect() modificó una URL que no tenía wrapper: "${unwrapGoogleRedirect(plainUrl)}".`
  );

  // Real fixture: a job page whose "Mostrar los N salarios" widget is
  // absent (no salary submissions for this posting) — an earlier version
  // of extractCompanySlugFromJobPageHtml() keyed off that widget instead
  // of the universal offer-grid-article-company-url anchor, and silently
  // returned null for real, resolvable companies like this one
  // (Computrabajo lists it as "Concentrix"; its actual profile slug is
  // the legacy name "convergys" — verified live end-to-end: that slug's
  // /evaluaciones page really does resolve real reputation data).
  const jobPageHtml = fs.readFileSync(
    path.join(FIXTURES_DIR, "computrabajo-job-page-sample.html"),
    "utf-8"
  );
  const extractedSlug = extractCompanySlugFromJobPageHtml(jobPageHtml);
  check(
    extractedSlug === "convergys",
    `extractCompanySlugFromJobPageHtml() encuentra el slug real vía offer-grid-article-company-url ("convergys"), no el widget condicional de salarios.`,
    `extractCompanySlugFromJobPageHtml() devolvió "${extractedSlug}", se esperaba "convergys".`
  );
  check(
    extractCompanySlugFromJobPageHtml("<html><body>sin ningún link de empresa</body></html>") === null,
    "extractCompanySlugFromJobPageHtml() devuelve null cuando no hay ningún link de empresa — nunca un slug inventado.",
    "extractCompanySlugFromJobPageHtml() encontró un slug en una página sin ningún link de empresa."
  );

  const html = fs.readFileSync(
    path.join(FIXTURES_DIR, "computrabajo-evaluaciones-sample.html"),
    "utf-8"
  );
  const finalUrl = "https://co.computrabajo.com/soletanche/evaluaciones";
  const parsed = parseComputrabajoEvaluationsPage(html, finalUrl, "soletanche");

  check(
    parsed !== null && parsed.score === 4.6 && parsed.reviewCount === 569,
    `parseComputrabajoEvaluationsPage() lee el score real con coma decimal española (4,6 → 4.6) y el conteo real de reseñas (569): ${JSON.stringify(parsed)}.`,
    `parseComputrabajoEvaluationsPage() no devolvió los valores reales esperados: ${JSON.stringify(parsed)}`
  );
  check(
    parsed?.source === "computrabajo" && parsed?.scoreScale === "1-5",
    "El resultado trae source/scoreScale fijos y consistentes.",
    `El resultado no trae los campos fijos esperados: ${JSON.stringify(parsed)}`
  );

  // Same real fixture, but with a finalUrl that doesn't match the
  // requested slug — this is exactly the "200 that silently landed on
  // the homepage instead of the real company page" failure mode observed
  // live this session (e.g. /alpina/evaluaciones), which a status-code-only
  // check would miss entirely.
  const redirectedAway = parseComputrabajoEvaluationsPage(
    html,
    "https://co.computrabajo.com/",
    "soletanche"
  );
  check(
    redirectedAway === null,
    "Si la URL final tras seguir redirects no es la página de evaluaciones esperada, el parser devuelve null en vez de confiar en el contenido.",
    `El parser no detectó una redirección silenciosa a la home: ${JSON.stringify(redirectedAway)}`
  );
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Reputación de empleador (Fases R1-R4 + /empresas/:slug)`);
  console.log(`==================================================`);

  await runResilienceTests();
  runRegistryTests();
  await runUpsertTests();
  runMercoParserTests();
  await runAliasAndLookupTests();
  runGptwParserTests();
  await runCompanySlugTests();
  await runCompanyEndpointTests();
  runComputrabajoParserTests();

  console.log(`\n==================================================`);
  if (failures > 0) {
    console.error(`❌ [TEST SUITE FAILED] ${failures} verificación(es) fallaron.`);
    console.log(`==================================================\n`);
    process.exit(1);
  }
  console.log(
    `🎉 [TEST SUITE PASSED] Pipeline de reputación de empleador (esqueleto + Merco Talento + GPTW + Computrabajo) verificado.`
  );
  console.log(`==================================================\n`);
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  await pool.end();
  process.exit(1);
});
