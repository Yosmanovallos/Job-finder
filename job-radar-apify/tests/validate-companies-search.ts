import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { saveJobs } from "../src/db/job-repository.js";
import { pool } from "../src/db/client.js";
import { Job } from "../src/sources/types.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3977;
const BASE_URL = `http://localhost:${TEST_PORT}`;
// "Zz" prefix keeps this test's companies sorted away from real ones. Real
// cleanup is scoped by URL prefix (below), not by this company name prefix
// — the two placeholder-exclusion test rows deliberately use company =
// "Confidencial"/"Empresa confidencial", which wouldn't match a
// `company LIKE 'ZzTest%'` cleanup query.
const COMPANY_MANY = "ZzTest Corp Cinco";
const COMPANY_FEW = "ZzTest Corp Dos";
const COMPANY_ONE = "ZzTest Corp Uno";
// All count=1, same as COMPANY_ONE — exercises the alphabetical tiebreak
// (entries.sort's `|| a[0].localeCompare(b[0])`) and pagination together:
// without a stable tiebreak, two consecutive offset requests could
// reshuffle these four and silently duplicate or skip one across the
// page boundary.
const COMPANY_TIE_A = "ZzTest Corp Tie A";
const COMPANY_TIE_B = "ZzTest Corp Tie B";
const COMPANY_TIE_C = "ZzTest Corp Tie C";
const TEST_URL_PREFIX = "https://www.example.com/job/companies-search-";

async function cleanupTestJobs(): Promise<void> {
  await pool.query(`DELETE FROM jobs WHERE url LIKE $1`, [`${TEST_URL_PREFIX}%`]);
}

// maxAttempts bumped 40->80 (2026-08-12): same cold-tsx-startup fix as
// validate-seo-job-pages.ts — see that file's comment for the measurement.
async function waitForServer(maxAttempts = 80, delayMs = 250): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch (e) {
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
    } catch (e) {
      // Group may already be gone.
    }
  }
}

function makeJob(id: string, company: string): Job {
  return {
    jobId: id,
    title: `Vacante de prueba ${id}`,
    company,
    location: "Bogotá, Colombia",
    url: `${TEST_URL_PREFIX}${id}`,
    dateText: "Hace 1 día",
    source: "LinkedIn",
    publishedAt: new Date(Date.now() - 24 * 3600000).toISOString()
  };
}

async function runCompaniesSearchValidation() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN DE GET /api/companies/search (Fase E4)`);
  console.log(`==================================================\n`);

  // Scoped cleanup only (never clearRepository() — ver docs/SESSION-NOTES.md,
  // este repo apunta a la base de datos real).
  await cleanupTestJobs();

  const jobs: Job[] = [
    ...Array.from({ length: 5 }, (_, i) => makeJob(`csearch_many_${i}`, COMPANY_MANY)),
    ...Array.from({ length: 2 }, (_, i) => makeJob(`csearch_few_${i}`, COMPANY_FEW)),
    makeJob("csearch_one_0", COMPANY_ONE),
    makeJob("csearch_tie_a_0", COMPANY_TIE_A),
    makeJob("csearch_tie_b_0", COMPANY_TIE_B),
    makeJob("csearch_tie_c_0", COMPANY_TIE_C),
    makeJob("csearch_confidencial_0", "Confidencial"),
    makeJob("csearch_empresa_confidencial_0", "Empresa confidencial")
  ];
  await saveJobs(jobs, "Test Companies Search");

  console.log(`🚀 [Test] Levantando servidor real en ${BASE_URL}...`);
  const server = startServer();

  // process.exit() inside a try skips its finally entirely — see the same
  // fix/comment in validate-company-reviews.ts. Every failure below is now
  // a thrown Error so cleanup + killServerTree always run before the outer
  // .catch() exits non-zero.
  try {
    await waitForServer();
    console.log(`✅ [Test] Servidor arriba.`);

    // Test 1: substring match, case-insensitive
    console.log(`\n🔍 [Test 1] q="zztest corp" hace match por substring, insensible a mayúsculas...`);
    const res1 = await fetch(`${BASE_URL}/api/companies/search?q=zztest%20corp`);
    const body1 = await res1.json();
    const names1 = body1.companies.map((c: any) => c.company);
    if (!names1.includes(COMPANY_MANY) || !names1.includes(COMPANY_FEW) || !names1.includes(COMPANY_ONE)) {
      throw new Error(`[Test 1] Esperaba las 3 empresas ZzTest en el resultado. Body: ${JSON.stringify(body1)}`);
    }
    console.log(`✅ [PASSED] Substring case-insensitive funciona.`);

    // Test 2: excludes the two exact placeholder strings — exact-match
    // only, by design (regla 5 de AGENTS.md: no fusión difusa de nombres
    // casi-duplicados). Real data has other casing variants ("Empresa
    // Confidencial" con C mayúscula, "CONFIDENCIAL", etc.) that are
    // legitimately different strings and are NOT expected to be excluded —
    // this only asserts the two literal placeholders never appear.
    console.log(`\n🔍 [Test 2] Los dos placeholders exactos nunca aparecen (variantes de casing sí)...`);
    const res2 = await fetch(`${BASE_URL}/api/companies/search?q=confidencial&limit=50`);
    const body2 = await res2.json();
    const names2 = body2.companies.map((c: any) => c.company);
    if (names2.includes("Confidencial") || names2.includes("Empresa confidencial")) {
      throw new Error(`[Test 2] Los placeholders exactos no deben aparecer nunca. Body: ${JSON.stringify(body2)}`);
    }
    console.log(`✅ [PASSED] Los dos placeholders exactos están excluidos (case-sensitive, sin fuzzy-merge).`);

    // Test 3: ordered by count descending
    console.log(`\n🔍 [Test 3] Orden por conteo de vacantes descendente...`);
    const res3 = await fetch(`${BASE_URL}/api/companies/search?q=zztest%20corp`);
    const body3 = await res3.json();
    const order3 = body3.companies.map((c: any) => c.company);
    const idxMany = order3.indexOf(COMPANY_MANY);
    const idxFew = order3.indexOf(COMPANY_FEW);
    const idxOne = order3.indexOf(COMPANY_ONE);
    if (!(idxMany < idxFew && idxFew < idxOne)) {
      throw new Error(`[Test 3] Esperaba orden Cinco(5) > Dos(2) > Uno(1). Body: ${JSON.stringify(body3.companies)}`);
    }
    const countMany = body3.companies.find((c: any) => c.company === COMPANY_MANY)?.count;
    if (countMany !== 5) {
      throw new Error(`[Test 3] ${COMPANY_MANY} debía tener count=5, llegó ${countMany}.`);
    }
    console.log(`✅ [PASSED] Orden descendente por conteo correcto, conteos exactos.`);

    // Test 4: limit cap
    console.log(`\n🔍 [Test 4] limit respeta el tope (y el tope máximo de 100)...`);
    const res4 = await fetch(`${BASE_URL}/api/companies/search?q=zztest%20corp&limit=2`);
    const body4 = await res4.json();
    if (body4.companies.length !== 2) {
      throw new Error(`[Test 4] Con limit=2 esperaba 2 resultados, llegaron ${body4.companies.length}.`);
    }
    const res4b = await fetch(`${BASE_URL}/api/companies/search?limit=9999`);
    const body4b = await res4b.json();
    if (body4b.companies.length > 100) {
      throw new Error(`[Test 4] limit debe capearse en 100, llegaron ${body4b.companies.length}.`);
    }
    console.log(`✅ [PASSED] limit se respeta y se capea en 100.`);

    // Test 5: q vacío o de 1 char devuelve sugerencias top-N globales (no vacío)
    console.log(`\n🔍 [Test 5] q vacío devuelve sugerencias (top-N global), no un array vacío...`);
    const res5 = await fetch(`${BASE_URL}/api/companies/search?limit=5`);
    const body5 = await res5.json();
    if (!Array.isArray(body5.companies) || body5.companies.length === 0) {
      throw new Error(`[Test 5] q vacío debía devolver sugerencias top-N, llegó: ${JSON.stringify(body5)}`);
    }
    console.log(`✅ [PASSED] q vacío devuelve top-N global (${body5.companies.length} resultados).`);

    // Test 6: stable alphabetical tiebreak on equal counts + offset paging
    // — Cinco(5), Dos(2), then the 4 count=1 companies in alphabetical
    // order (Tie A, Tie B, Tie C, Uno). Fetched two ways: one request for
    // all 6, and two paged requests (limit=3 offset=0, limit=3 offset=3)
    // — both must produce the exact same sequence, proving no company is
    // duplicated or skipped across the page boundary.
    console.log(`\n🔍 [Test 6] Tiebreak alfabético estable + paginación por offset...`);
    const expectedOrder = [
      COMPANY_MANY,
      COMPANY_FEW,
      COMPANY_TIE_A,
      COMPANY_TIE_B,
      COMPANY_TIE_C,
      COMPANY_ONE
    ];
    const resFull = await fetch(`${BASE_URL}/api/companies/search?q=zztest%20corp&limit=6`);
    const bodyFull = await resFull.json();
    const orderFull = bodyFull.companies.map((c: any) => c.company);
    if (JSON.stringify(orderFull) !== JSON.stringify(expectedOrder)) {
      throw new Error(
        `[Test 6] Orden esperado ${JSON.stringify(expectedOrder)}, llegó ${JSON.stringify(orderFull)}.`
      );
    }

    const resPage1 = await fetch(`${BASE_URL}/api/companies/search?q=zztest%20corp&limit=3&offset=0`);
    const bodyPage1 = await resPage1.json();
    const resPage2 = await fetch(`${BASE_URL}/api/companies/search?q=zztest%20corp&limit=3&offset=3`);
    const bodyPage2 = await resPage2.json();
    const pagedOrder = [
      ...bodyPage1.companies.map((c: any) => c.company),
      ...bodyPage2.companies.map((c: any) => c.company)
    ];
    if (JSON.stringify(pagedOrder) !== JSON.stringify(expectedOrder)) {
      throw new Error(
        `[Test 6] Paginado por offset debía coincidir con el orden completo. Esperado ${JSON.stringify(expectedOrder)}, llegó ${JSON.stringify(pagedOrder)}.`
      );
    }
    if (bodyPage1.total !== 6 || bodyPage2.total !== 6) {
      throw new Error(`[Test 6] total debía ser 6 en ambas páginas. Llegó ${bodyPage1.total} / ${bodyPage2.total}.`);
    }
    if (bodyPage1.hasMore !== true || bodyPage2.hasMore !== false) {
      throw new Error(
        `[Test 6] hasMore debía ser true en la página 1 y false en la página 2. Llegó ${bodyPage1.hasMore} / ${bodyPage2.hasMore}.`
      );
    }
    console.log(`✅ [PASSED] Tiebreak alfabético estable y paginación sin duplicados ni huecos.`);

    console.log(`\n==================================================`);
    console.log(`🎉 [TEST SUITE PASSED] GET /api/companies/search (Fase E4) verificado contra el servidor HTTP real.`);
    console.log(`==================================================\n`);
  } finally {
    killServerTree(server);
    await cleanupTestJobs();
  }

  process.exit(0);
}

runCompaniesSearchValidation().catch((err) => {
  console.error("❌ [FAILED]", err?.message || err);
  process.exit(1);
});
