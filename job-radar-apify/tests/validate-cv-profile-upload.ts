// Real HTTP server + real Supabase auth + real Postgres, no mocks — same
// philosophy as tests/validate-paywall-auth.ts. Best-effort real session
// (depends on the Supabase project's "Confirm email" setting, exactly like
// that file); everything that needs a real authenticated user is skipped
// with a clear warning if signup doesn't return a usable session, never
// silently treated as a pass.
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { pool } from "../src/db/client.js";
import { upgradeUserToPro } from "../src/db/job-repository.js";
import { buildFictionalCvDocx, buildFictionalCvPdf, FICTIONAL_CV_LINES } from "./fixtures/build-cv-fixtures.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3981;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// maxAttempts bumped 40->80 (2026-08-12): same cold-tsx-startup fix as
// validate-seo-job-pages.ts — see that file's comment for the measurement.
async function waitForServer(maxAttempts = 80, delayMs = 250): Promise<void> {
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

async function tryGetTestSession(): Promise<{ accessToken: string; userId: string } | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const email = `cv_upload_test_${Date.now()}@mailinator.com`;
  const password = `Test${Date.now()}!aA`;

  await supabase.auth.signUp({ email, password });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.warn(`ℹ️ [Test] No se pudo crear una sesión de prueba (${error?.message || "sin sesión"}).`);
    return null;
  }
  return { accessToken: data.session.access_token, userId: data.session.user.id };
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Subida de CV /api/cv/profile (Fase 2a, HTTP real)`);
  console.log(`==================================================\n`);

  let failed = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (ok) {
      console.log(`✅ [PASSED] ${label}`);
    } else {
      console.error(`❌ [FAILED] ${label}${detail ? ` — ${detail}` : ""}`);
      failed++;
    }
  };

  console.log(`🚀 [Test] Levantando servidor real en ${BASE_URL}...`);
  const server = startServer();
  let testUserId: string | null = null;

  try {
    await waitForServer();
    console.log(`✅ [Test] Servidor arriba.`);

    console.log(`\n🔍 [Test 1] Sin token → 401 en las tres rutas...`);
    for (const method of ["GET", "POST", "DELETE"] as const) {
      const res = await fetch(`${BASE_URL}/api/cv/profile`, { method });
      check(`${method} /api/cv/profile sin token responde 401`, res.status === 401, `status=${res.status}`);
    }

    const session = await tryGetTestSession();
    if (!session) {
      console.log(
        `\n⚠️ [SKIPPED] El resto de la suite requiere una sesión Supabase real — probablemente "Confirm email" está activo en el proyecto. Verificar manualmente.`
      );
    } else {
      testUserId = session.userId;
      const authHeaders = { Authorization: `Bearer ${session.accessToken}` };

      console.log(`\n🔍 [Test 2] Usuario recién creado (tier 'free') → 403 al subir un CV...`);
      {
        const form = new FormData();
        form.append("file", new Blob([buildFictionalCvPdf()], { type: "application/pdf" }), "cv.pdf");
        const res = await fetch(`${BASE_URL}/api/cv/profile`, { method: "POST", headers: authHeaders, body: form });
        check("POST con tier free responde 403", res.status === 403, `status=${res.status}`);
      }

      await upgradeUserToPro(session.userId, new Date(Date.now() + 30 * 24 * 3600 * 1000));

      console.log(`\n🔍 [Test 3] GET antes de subir nada → exists:false...`);
      {
        const res = await fetch(`${BASE_URL}/api/cv/profile`, { headers: authHeaders });
        const body = await res.json();
        check("GET responde 200", res.status === 200, `status=${res.status}`);
        check("exists:false, hasFacts:false, updatedAt:null", body.exists === false && body.hasFacts === false && body.updatedAt === null, JSON.stringify(body));
      }

      console.log(`\n🔍 [Test 4] Sube un PDF ficticio válido → 200, texto real guardado, facts_json NULL...`);
      {
        const form = new FormData();
        form.append("file", new Blob([buildFictionalCvPdf()], { type: "application/pdf" }), "cv.pdf");
        const res = await fetch(`${BASE_URL}/api/cv/profile`, { method: "POST", headers: authHeaders, body: form });
        const body = await res.json();
        check("POST PDF responde 200", res.status === 200, `status=${res.status}`);
        check("truncated:false (texto corto)", body.truncated === false, JSON.stringify(body));

        const { rows } = await pool.query<{ raw_text: string; facts_json: unknown }>(
          `SELECT raw_text, facts_json FROM cv_profiles WHERE user_id = $1`,
          [session.userId]
        );
        check("Existe exactamente 1 fila en cv_profiles", rows.length === 1, `filas=${rows.length}`);
        check(
          "raw_text contiene el texto literal del PDF ficticio (nada inventado)",
          rows[0]?.raw_text.includes(FICTIONAL_CV_LINES[0]!) ?? false
        );
        check("facts_json es NULL (Etapa A es Fase 2b, no corre aquí)", rows[0]?.facts_json === null);
      }

      console.log(`\n🔍 [Test 5] GET después de subir → exists:true, hasFacts:false...`);
      {
        const res = await fetch(`${BASE_URL}/api/cv/profile`, { headers: authHeaders });
        const body = await res.json();
        check("exists:true, hasFacts:false, updatedAt es string", body.exists === true && body.hasFacts === false && typeof body.updatedAt === "string", JSON.stringify(body));
      }

      console.log(`\n🔍 [Test 6] Sube un DOCX ficticio largo (>6.000 chars extraídos) → truncated:true, UPSERT reemplaza la fila...`);
      {
        const longLines = Array.from(
          { length: 250 },
          (_, i) => `Línea de relleno ficticia número ${i} para forzar el truncado en este test de Fase 2a.`
        );
        const form = new FormData();
        form.append(
          "file",
          new Blob([buildFictionalCvDocx(longLines)], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          }),
          "cv.docx"
        );
        const res = await fetch(`${BASE_URL}/api/cv/profile`, { method: "POST", headers: authHeaders, body: form });
        const body = await res.json();
        check("POST DOCX largo responde 200", res.status === 200, `status=${res.status}`);
        check("truncated:true", body.truncated === true, JSON.stringify(body));

        const { rows } = await pool.query<{ raw_text: string }>(
          `SELECT raw_text FROM cv_profiles WHERE user_id = $1`,
          [session.userId]
        );
        check("Sigue existiendo exactamente 1 fila (UPSERT, no acumula)", rows.length === 1, `filas=${rows.length}`);
        check("raw_text quedó acotado a 6.000 caracteres", rows[0]?.raw_text.length === 6000, `len=${rows[0]?.raw_text.length}`);
      }

      console.log(`\n🔍 [Test 7] Archivo más grande que el tope de 2 MB → 413...`);
      {
        const oversized = Buffer.alloc(2 * 1024 * 1024 + 10, 65);
        const form = new FormData();
        form.append("file", new Blob([oversized], { type: "application/pdf" }), "cv.pdf");
        const res = await fetch(`${BASE_URL}/api/cv/profile`, { method: "POST", headers: authHeaders, body: form });
        check("Archivo de >2MB responde 413", res.status === 413, `status=${res.status}`);
      }

      console.log(`\n🔍 [Test 8] Content-Type no permitido (text/plain) → 400...`);
      {
        const form = new FormData();
        form.append("file", new Blob([Buffer.from("hola")], { type: "text/plain" }), "cv.txt");
        const res = await fetch(`${BASE_URL}/api/cv/profile`, { method: "POST", headers: authHeaders, body: form });
        check("MIME no permitido responde 400", res.status === 400, `status=${res.status}`);
      }

      console.log(`\n🔍 [Test 9] Content-Type PDF pero bytes no son un PDF real (magic bytes) → 400...`);
      {
        const form = new FormData();
        form.append("file", new Blob([Buffer.from("esto no es un pdf de verdad")], { type: "application/pdf" }), "cv.pdf");
        const res = await fetch(`${BASE_URL}/api/cv/profile`, { method: "POST", headers: authHeaders, body: form });
        check("PDF con magic bytes inválidos responde 400", res.status === 400, `status=${res.status}`);
      }

      console.log(`\n🔍 [Test 10] DELETE borra el CV crudo...`);
      {
        const res = await fetch(`${BASE_URL}/api/cv/profile`, { method: "DELETE", headers: authHeaders });
        check("DELETE responde 200", res.status === 200, `status=${res.status}`);

        const { rows } = await pool.query(`SELECT 1 FROM cv_profiles WHERE user_id = $1`, [session.userId]);
        check("La fila ya no existe en la base de datos real", rows.length === 0, `filas=${rows.length}`);

        const getRes = await fetch(`${BASE_URL}/api/cv/profile`, { headers: authHeaders });
        const getBody = await getRes.json();
        check("GET tras borrar responde exists:false", getBody.exists === false, JSON.stringify(getBody));
      }
    }
  } finally {
    killServerTree(server);
    if (testUserId) {
      // CASCADE en cv_profiles.user_id borra cualquier fila residual;
      // este DELETE solo toca la fila del usuario de prueba de esta corrida.
      await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
    }
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] /api/cv/profile verificado contra HTTP + Postgres reales.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  process.exit(1);
});
