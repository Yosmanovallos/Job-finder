import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { saveJobs } from "../src/db/job-repository.js";
import { pool } from "../src/db/client.js";
import { buildCompanyPath } from "../src/lib/job-seo.js";
import { Job } from "../src/sources/types.js";
import {
  upsertCompanyReview,
  deleteCompanyReview,
  getCompanyReviews
} from "../src/db/company-reviews-repository.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3978;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_COMPANY = "Reseñas Test Corp";
const COMPANY_SLUG = buildCompanyPath(TEST_COMPANY).replace("/empresas/", "");

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("✅", msg);
}

// Repository-level assertions — run against the real DB, no Supabase JWT
// needed, so they aren't blocked by the "Confirm email" gate the HTTP
// section below hits. Uses its own two throwaway `users` rows (never a
// real account), cleaned up in the outer `finally`.
async function runRepositoryLevelChecks() {
  console.log(`\n🔍 [Repo] upsert / UNIQUE / hidden-status / delete (sin HTTP, sin JWT)...`);
  const repoCompany = "Reseñas Repo Test Corp";
  const userA = (
    await pool.query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `repo_test_a_${Date.now()}@mailinator.com`,
      "Test A"
    ])
  ).rows[0].id;
  const userB = (
    await pool.query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `repo_test_b_${Date.now()}@mailinator.com`,
      "Test B"
    ])
  ).rows[0].id;

  try {
    await upsertCompanyReview({ userId: userA, companyName: repoCompany, rating: 3, comment: "primera" });
    let result = await getCompanyReviews(repoCompany, userA);
    assert(result.count === 1 && result.average === 3, "upsert crea 1 fila con average correcto");
    assert(
      result.myReview?.rating === 3 && result.myReview.status === "visible",
      "myReview refleja la fila propia"
    );

    await upsertCompanyReview({ userId: userA, companyName: repoCompany, rating: 5, comment: "corregida" });
    result = await getCompanyReviews(repoCompany, userA);
    assert(result.count === 1, "segundo upsert del mismo usuario no acumula filas (UNIQUE user_id+company_name)");
    assert(
      result.myReview?.rating === 5 && result.myReview.comment === "corregida",
      "segundo upsert reescribe rating/comment in-place"
    );

    await upsertCompanyReview({ userId: userB, companyName: repoCompany, rating: 1, comment: null });
    result = await getCompanyReviews(repoCompany, userA);
    assert(result.count === 2 && result.average === 3, "dos usuarios distintos → 2 filas, average = (5+1)/2");

    await pool.query(
      `UPDATE company_user_reviews SET status = 'hidden' WHERE user_id = $1 AND company_name = $2`,
      [userB, repoCompany]
    );
    result = await getCompanyReviews(repoCompany, userA);
    assert(result.count === 1 && result.average === 5, "reseña oculta se excluye de count/average para otros viewers");
    result = await getCompanyReviews(repoCompany, userB);
    assert(result.myReview?.status === "hidden", "el autor de la reseña oculta sigue viéndola en myReview");
    assert(
      result.entries.every((e) => e.id !== result.myReview!.id),
      "la reseña oculta nunca aparece en entries, ni para su propio autor"
    );

    await upsertCompanyReview({ userId: userB, companyName: repoCompany, rating: 2, comment: "editada oculta" });
    result = await getCompanyReviews(repoCompany, userB);
    assert(result.myReview?.status === "hidden", "editar una reseña oculta no la re-muestra automáticamente");

    await deleteCompanyReview(userA, repoCompany);
    result = await getCompanyReviews(repoCompany, userA);
    assert(result.myReview === null && result.count === 0, "delete borra la fila (userB sigue hidden, no cuenta)");

    // DB-level range validation — the CHECK constraint, not just the HTTP
    // handler's own rating check.
    let rejected = false;
    try {
      await pool.query(
        `INSERT INTO company_user_reviews (user_id, company_name, rating) VALUES ($1, $2, 9)`,
        [userA, repoCompany]
      );
    } catch (e) {
      rejected = true;
    }
    assert(rejected, "CHECK (rating BETWEEN 1 AND 5) rechaza rating=9 a nivel de base de datos");

    console.log(`✅ [PASSED] Chequeos de repositorio (upsert/UNIQUE/hidden/delete/CHECK).`);
  } finally {
    await pool.query(`DELETE FROM company_user_reviews WHERE company_name = $1`, [repoCompany]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[userA, userB]]);
  }
}

async function waitForServer(maxAttempts = 40, delayMs = 250): Promise<void> {
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

async function trySignUpSession(label: string): Promise<string | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const email = `company_review_${label}_${Date.now()}@mailinator.com`;
  const password = `Test${Date.now()}!aA`;

  await supabase.auth.signUp({ email, password });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    console.warn(
      `⚠️ [Test] No se pudo crear una sesión real (${error?.message || "sin sesión"}) — requiere confirmar manualmente en Supabase.`
    );
    return null;
  }
  return data.session.access_token;
}

async function runCompanyReviewsValidation() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN DE RESEÑAS DE EMPRESA (Fase E2, HTTP real)`);
  console.log(`==================================================\n`);

  // Scoped cleanup only — this repo's dev DB is the real production DB
  // (see docs/SESSION-NOTES.md), so this test never calls the full-table
  // clearRepository(); it only ever touches its own TEST_COMPANY rows.
  await pool.query(`DELETE FROM jobs WHERE company = $1`, [TEST_COMPANY]);
  await pool.query(`DELETE FROM company_user_reviews WHERE company_name = $1`, [TEST_COMPANY]);

  const job: Job = {
    jobId: "job_review_test_1",
    title: "Analista de Pruebas",
    company: TEST_COMPANY,
    location: "Bogotá, Colombia",
    url: "https://www.example.com/job/review-test",
    dateText: "Hace 3 días",
    source: "LinkedIn",
    publishedAt: new Date(Date.now() - 72 * 3600000).toISOString()
  };
  await saveJobs([job], "Test Reviews");

  console.log(`🚀 [Test] Levantando servidor real en ${BASE_URL}...`);
  const server = startServer();

  // Set instead of exiting mid-try — process.exit() inside a try skips its
  // finally entirely, which is exactly how a prior run of this file leaked
  // the detached :3978 server AND its "Reseñas Test Corp" job row straight
  // into the real production `jobs` table (this repo's dev DB IS prod, see
  // docs/SESSION-NOTES.md). Every early-exit below is now either a thrown
  // Error (failure — finally still runs, then the outer .catch() below
  // exits 1) or, for the auth-gated skip, a flag checked after the
  // try/finally block has already completed.
  let authTestsSkipped = false;

  try {
    await waitForServer();
    console.log(`✅ [Test] Servidor arriba.`);

    await runRepositoryLevelChecks();

    // Test 1: POST sin token → 401
    console.log(`\n🔍 [Test 1] POST /reviews sin autenticación...`);
    const anonPost = await fetch(`${BASE_URL}/api/companies/${COMPANY_SLUG}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 5 })
    });
    if (anonPost.status !== 401) {
      throw new Error(`[Test 1] Esperaba 401, llegó ${anonPost.status}.`);
    }
    console.log(`✅ [PASSED] POST /reviews exige autenticación.`);

    // Test 2: DELETE sin token → 401
    console.log(`\n🔍 [Test 2] DELETE /reviews sin autenticación...`);
    const anonDelete = await fetch(`${BASE_URL}/api/companies/${COMPANY_SLUG}/reviews`, {
      method: "DELETE"
    });
    if (anonDelete.status !== 401) {
      throw new Error(`[Test 2] Esperaba 401, llegó ${anonDelete.status}.`);
    }
    console.log(`✅ [PASSED] DELETE /reviews exige autenticación.`);

    const token = await trySignUpSession("main");
    if (!token) {
      // Same accepted gap as validate-paywall-auth.ts's Test 4: this
      // Supabase project has "Confirm email" on, so signUp() never yields
      // a usable session here. Everything below this line — the 404 for
      // an invented slug, rating/comment validation, upsert-via-HTTP,
      // GET's userReviews, DELETE — stays UNVERIFIED by this run. Only
      // the repo-level checks above and the two anonymous 401s just ran.
      authTestsSkipped = true;
      console.log(
        `\n⚠️ [SKIPPED] El resto de la suite requiere una sesión real de Supabase — ver aviso arriba.`
      );
    } else {
      const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      // Test 3: 404 real para un slug inventado
      console.log(`\n🔍 [Test 3] POST /reviews contra un slug que no existe...`);
      const notFoundRes = await fetch(`${BASE_URL}/api/companies/empresa-que-no-existe-xyz/reviews`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ rating: 5 })
      });
      if (notFoundRes.status !== 404) {
        throw new Error(`[Test 3] Esperaba 404, llegó ${notFoundRes.status}.`);
      }
      console.log(`✅ [PASSED] Slug inexistente responde 404.`);

      // Test 4: validación de rating fuera de rango
      console.log(`\n🔍 [Test 4] rating fuera de rango (0 y 6)...`);
      for (const badRating of [0, 6, 3.5]) {
        const res = await fetch(`${BASE_URL}/api/companies/${COMPANY_SLUG}/reviews`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ rating: badRating })
        });
        if (res.status !== 400) {
          throw new Error(`[Test 4] rating=${badRating} debería ser 400, llegó ${res.status}.`);
        }
      }
      console.log(`✅ [PASSED] rating fuera de [1,5] o no entero se rechaza con 400.`);

      // Test 5: comment demasiado largo
      console.log(`\n🔍 [Test 5] comment de más de 1000 caracteres...`);
      const longComment = "a".repeat(1001);
      const longRes = await fetch(`${BASE_URL}/api/companies/${COMPANY_SLUG}/reviews`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ rating: 4, comment: longComment })
      });
      if (longRes.status !== 400) {
        throw new Error(`[Test 5] comment de 1001 chars debería ser 400, llegó ${longRes.status}.`);
      }
      console.log(`✅ [PASSED] comment > 1000 caracteres se rechaza con 400.`);

      // Test 6: upsert real + actualización in-place (no acumula filas)
      console.log(`\n🔍 [Test 6] upsert crea la reseña, un segundo POST la actualiza in-place...`);
      const firstPost = await fetch(`${BASE_URL}/api/companies/${COMPANY_SLUG}/reviews`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ rating: 3, comment: "Primera versión" })
      });
      const firstBody = await firstPost.json();
      if (
        firstPost.status !== 200 ||
        firstBody.userReviews.count !== 1 ||
        firstBody.userReviews.myReview.rating !== 3
      ) {
        throw new Error(`[Test 6] Primer POST debería crear 1 reseña visible con rating 3. Body: ${JSON.stringify(firstBody)}`);
      }

      const secondPost = await fetch(`${BASE_URL}/api/companies/${COMPANY_SLUG}/reviews`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ rating: 5, comment: "Versión corregida" })
      });
      const secondBody = await secondPost.json();
      if (
        secondBody.userReviews.count !== 1 ||
        secondBody.userReviews.myReview.rating !== 5 ||
        secondBody.userReviews.myReview.comment !== "Versión corregida"
      ) {
        throw new Error(
          `[Test 6] El segundo POST debía reescribir la misma fila (UNIQUE user_id+company_name), no acumular. Body: ${JSON.stringify(secondBody)}`
        );
      }
      console.log(`✅ [PASSED] UNIQUE(user_id, company_name) respetado: reescribe, nunca acumula.`);

      // Test 7: GET /api/companies/:slug expone userReviews con el promedio real
      console.log(`\n🔍 [Test 7] GET /api/companies/:slug incluye userReviews...`);
      const companyRes = await fetch(`${BASE_URL}/api/companies/${COMPANY_SLUG}`, {
        headers: authHeaders
      });
      const companyBody = await companyRes.json();
      if (companyBody.userReviews.count !== 1 || companyBody.userReviews.average !== 5) {
        throw new Error(`[Test 7] userReviews.average debería ser 5. Body: ${JSON.stringify(companyBody.userReviews)}`);
      }
      console.log(`✅ [PASSED] GET /api/companies/:slug incluye userReviews con el promedio correcto.`);

      // Test 8: status='hidden' (moderación manual vía SQL) se excluye de
      // entries pero sigue visible en myReview para su propio autor.
      console.log(`\n🔍 [Test 8] Reseña oculta a mano (status='hidden')...`);
      await pool.query(`UPDATE company_user_reviews SET status = 'hidden' WHERE company_name = $1`, [
        TEST_COMPANY
      ]);
      const hiddenRes = await fetch(`${BASE_URL}/api/companies/${COMPANY_SLUG}`, {
        headers: authHeaders
      });
      const hiddenBody = await hiddenRes.json();
      if (hiddenBody.userReviews.count !== 0 || hiddenBody.userReviews.entries.length !== 0) {
        throw new Error(
          `[Test 8] Una reseña 'hidden' no debe contar ni aparecer en entries. Body: ${JSON.stringify(hiddenBody.userReviews)}`
        );
      }
      if (!hiddenBody.userReviews.myReview || hiddenBody.userReviews.myReview.status !== "hidden") {
        throw new Error(
          `[Test 8] El propio autor debe seguir viendo su reseña oculta en myReview. Body: ${JSON.stringify(hiddenBody.userReviews)}`
        );
      }
      console.log(`✅ [PASSED] status='hidden' se excluye de entries/count pero el autor sigue viendo la suya.`);

      // restore visible for the delete test below
      await pool.query(`UPDATE company_user_reviews SET status = 'visible' WHERE company_name = $1`, [
        TEST_COMPANY
      ]);

      // Test 9: DELETE borra la reseña propia
      console.log(`\n🔍 [Test 9] DELETE /reviews borra la reseña propia...`);
      const deleteRes = await fetch(`${BASE_URL}/api/companies/${COMPANY_SLUG}/reviews`, {
        method: "DELETE",
        headers: authHeaders
      });
      const deleteBody = await deleteRes.json();
      if (
        deleteRes.status !== 200 ||
        deleteBody.userReviews.count !== 0 ||
        deleteBody.userReviews.myReview !== null
      ) {
        throw new Error(`[Test 9] Tras DELETE, count debe ser 0 y myReview null. Body: ${JSON.stringify(deleteBody)}`);
      }
      console.log(`✅ [PASSED] DELETE borra la reseña propia y el estado queda limpio.`);
    }
  } finally {
    killServerTree(server);
    await pool.query(`DELETE FROM company_user_reviews WHERE company_name = $1`, [TEST_COMPANY]);
    await pool.query(`DELETE FROM jobs WHERE company = $1`, [TEST_COMPANY]);
  }

  console.log(`\n==================================================`);
  if (authTestsSkipped) {
    console.log(`🎉 [TEST SUITE PASSED PARCIALMENTE] Solo se verificó 401 sin sesión + chequeos de repositorio.`);
  } else {
    console.log(`🎉 [TEST SUITE PASSED] Reseñas de empresa (Fase E2) verificadas contra el servidor HTTP real.`);
  }
  console.log(`==================================================\n`);
  process.exit(0);
}

runCompanyReviewsValidation().catch((err) => {
  console.error("❌ [FAILED]", err?.message || err);
  process.exit(1);
});
