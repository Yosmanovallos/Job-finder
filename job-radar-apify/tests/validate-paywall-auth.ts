import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { saveJobs, clearRepository, getJobs, maskLockedFields } from "../src/db/job-repository.js";
import { Job } from "../src/sources/types.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3979;
const BASE_URL = `http://localhost:${TEST_PORT}`;

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
  // detached so it gets its own process group — `shell: true` spawns a
  // npx -> sh -> node tree, and killing only the top PID leaves the real
  // node process (and esbuild) running as orphans.
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

async function tryGetProSession(): Promise<string | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  // mailinator.com is a real, publicly-viewable inbox domain — Supabase's
  // email validator rejects "@example.com" outright ("Email address is
  // invalid"), which silently skipped Test 4 on every run before this fix.
  const email = `paywall_test_${Date.now()}@mailinator.com`;
  const password = `Test${Date.now()}!aA`;

  await supabase.auth.signUp({ email, password });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    console.warn(
      `ℹ️ [Test] No se pudo crear una sesión Pro automática (${error?.message || "sin sesión"}).`
    );
    console.warn(
      `   Si el proyecto Supabase tiene "Confirm email" activo, esta parte queda pendiente de verificación manual.`
    );
    return null;
  }

  return data.session.access_token;
}

async function runPaywallAuthValidation() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN DE PAYWALL DE FRESCURA 48H & AUTH (HTTP real)`);
  console.log(`==================================================\n`);

  await clearRepository();

  const now = new Date();
  const recentJob: Job = {
    jobId: "job_recent_1",
    title: "Desarrollador React Senior",
    company: "Tech Corp",
    location: "Bogotá, Colombia",
    url: "https://www.example.com/job/1",
    dateText: "Hace 2 horas",
    source: "LinkedIn",
    publishedAt: new Date(now.getTime() - 2 * 3600000).toISOString()
  };
  const olderJob: Job = {
    jobId: "job_older_2",
    title: "Analista de Datos",
    company: "Bancolombia",
    location: "Medellín, Colombia",
    url: "https://www.example.com/job/2",
    dateText: "Hace 3 días",
    source: "Computrabajo",
    publishedAt: new Date(now.getTime() - 72 * 3600000).toISOString()
  };

  await saveJobs([recentJob, olderJob], "Test Paywall");

  console.log(`🚀 [Test] Levantando servidor real en ${BASE_URL}...`);
  const server = startServer();

  try {
    await waitForServer();
    console.log(`✅ [Test] Servidor arriba.`);

    // Test 1: Anonymous GET /api/jobs must mask the <48h job's sensitive fields
    console.log(`\n🔍 [Test 1] GET /api/jobs sin autenticación...`);
    const anonRes = await fetch(`${BASE_URL}/api/jobs`);
    const anonBody = await anonRes.json();
    const anonRecent = anonBody.jobs.find((j: any) => j.title === recentJob.title);
    const anonOlder = anonBody.jobs.find((j: any) => j.title === olderJob.title);

    if (
      !anonRecent ||
      anonRecent.company !== null ||
      anonRecent.location !== null ||
      anonRecent.url !== null
    ) {
      console.error(
        `❌ [FAILED] La vacante <48h debe llegar con company/location/url = null para un anónimo.`
      );
      process.exit(1);
    }
    console.log(
      `✅ [PASSED] Vacante <48h llega enmascarada (title/source visibles, resto oculto).`
    );

    if (!anonOlder || anonOlder.company !== olderJob.company || anonOlder.url !== olderJob.url) {
      console.error(`❌ [FAILED] La vacante >48h debe llegar completa y pública.`);
      process.exit(1);
    }
    console.log(`✅ [PASSED] Vacante >48h llega completa para todos.`);

    // Test 1b: maskLockedFields must clear isLocked for 'pro', not just unmask
    // fields — otherwise the frontend still renders the PaywallCard overlay
    // for Pro users on a <48h job even though the real data came through.
    console.log(`\n🔍 [Test 1b] maskLockedFields(jobs, 'pro') debe apagar isLocked...`);
    const rawJobs = await getJobs();
    const rawRecent = rawJobs.find((j: any) => j.title === recentJob.title);
    if (!rawRecent?.isLocked) {
      console.error(`❌ [FAILED] La vacante <48h debería llegar de getJobs() con isLocked=true.`);
      process.exit(1);
    }
    const proJobs = maskLockedFields(rawJobs, "pro");
    const proRecent = proJobs.find((j: any) => j.title === recentJob.title);
    if (proRecent.isLocked !== false) {
      console.error(
        `❌ [FAILED] Para tier 'pro', isLocked debe quedar en false — llegó ${proRecent.isLocked}.`
      );
      process.exit(1);
    }
    console.log(`✅ [PASSED] Un usuario Pro ya no ve isLocked=true en ninguna vacante.`);

    // Test 2: GET /api/me without a token must be 401
    console.log(`\n🔍 [Test 2] GET /api/me sin token...`);
    const meRes = await fetch(`${BASE_URL}/api/me`);
    if (meRes.status !== 401) {
      console.error(`❌ [FAILED] /api/me sin token debe responder 401, respondió ${meRes.status}.`);
      process.exit(1);
    }
    console.log(`✅ [PASSED] /api/me exige autenticación.`);

    // Test 3: POST /api/run-scraper without a token must be 401 (no anonymous scraping)
    console.log(`\n🔍 [Test 3] POST /api/run-scraper sin token...`);
    const scraperRes = await fetch(`${BASE_URL}/api/run-scraper`, { method: "POST" });
    if (scraperRes.status !== 401) {
      console.error(
        `❌ [FAILED] /api/run-scraper sin token debe responder 401, respondió ${scraperRes.status}.`
      );
      process.exit(1);
    }
    console.log(`✅ [PASSED] /api/run-scraper exige autenticación.`);

    // Test 4: real Pro session (best-effort — depends on Supabase email-confirmation settings)
    console.log(`\n🔍 [Test 4] GET /api/jobs con una sesión real...`);
    const accessToken = await tryGetProSession();
    if (accessToken) {
      const authedRes = await fetch(`${BASE_URL}/api/jobs`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const authedBody = await authedRes.json();
      const authedRecent = authedBody.jobs.find((j: any) => j.title === recentJob.title);
      // A freshly created user is 'free' tier — should still be masked.
      if (!authedRecent || authedRecent.company !== null) {
        console.error(
          `❌ [FAILED] Un usuario free autenticado también debe ver la vacante <48h enmascarada.`
        );
        process.exit(1);
      }
      console.log(
        `✅ [PASSED] Usuario free autenticado sigue viendo el paywall (el tier se resuelve en el servidor, no por estar logueado).`
      );
    } else {
      console.log(
        `⚠️ [SKIPPED] Verificación con sesión Pro real — requiere confirmar manualmente en Supabase (ver aviso arriba).`
      );
    }

    console.log(`\n==================================================`);
    console.log(
      `🎉 [TEST SUITE PASSED] Paywall de Frescura 48h verificado contra el servidor HTTP real.`
    );
    console.log(`==================================================\n`);
  } finally {
    killServerTree(server);
    await clearRepository();
  }

  process.exit(0);
}

runPaywallAuthValidation().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  process.exit(1);
});
