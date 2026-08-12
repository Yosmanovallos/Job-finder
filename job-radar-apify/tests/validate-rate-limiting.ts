import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { checkRateLimit } from "../src/lib/security-monitor.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3976;
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

async function runRateLimitingValidation() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN DE RATE LIMITING + AUTO-BLOCK (Fases L1-L3)`);
  console.log(`==================================================\n`);

  // Test 0: real bug found live 2026-08-08 while manually testing the CV
  // editor — `checkRateLimit` used to share ONE counter per IP regardless
  // of caller, so the lenient "general" limit (checked on every /api/*
  // request) and the strict "sensitive" limit (checked only on
  // checkout/CV-generate/etc.) were secretly the same bucket: a handful of
  // ordinary GETs from normal browsing was enough to make the FIRST
  // sensitive action of a session 429, with zero sensitive calls actually
  // made. Pure function test (no server, no auth needed) — exercises
  // `checkRateLimit` directly, the same function server.ts calls for both
  // limits, just with the `scope` argument that isolates them.
  console.log(`🔍 [Test 0] Dos scopes distintos en la misma IP no comparten contador...`);
  {
    const ip = `test-scope-isolation-${Date.now()}`;
    // Satura el scope "general" (límite bajo de prueba: 5) — simula una
    // sesión de navegación normal.
    for (let i = 0; i < 5; i++) {
      const ok = checkRateLimit(ip, 5, 60_000, "general");
      if (!ok) throw new Error(`[Test 0] La solicitud general #${i + 1}/5 debería haber pasado.`);
    }
    const generalNowBlocked = checkRateLimit(ip, 5, 60_000, "general");
    if (generalNowBlocked) {
      throw new Error(
        `[Test 0] El scope "general" debería estar agotado tras 5 solicitudes con límite 5.`
      );
    }
    // La primera solicitud SENSIBLE de esta IP, en un scope distinto, debe
    // pasar — antes del fix, el contador ya estaba en 5+ por el tráfico
    // general y esto fallaba con cero solicitudes sensibles reales hechas.
    const sensitiveFirstAttempt = checkRateLimit(ip, 10, 60_000, "sensitive");
    if (!sensitiveFirstAttempt) {
      throw new Error(
        `[Test 0] La primera solicitud del scope "sensitive" no debería fallar solo porque el scope "general" ya está agotado — los contadores están cruzados.`
      );
    }
  }
  console.log(
    `✅ [PASSED] Agotar el scope "general" no afecta al scope "sensitive" de la misma IP.`
  );

  console.log(`\n🚀 [Test] Levantando servidor real en ${BASE_URL}...`);
  const server = startServer();

  try {
    await waitForServer();
    console.log(`✅ [Test] Servidor arriba.`);

    // Test 1: /api/health is exempt from the general rate limit — hosting
    // platforms poll it frequently; it must never itself get rate-limited
    // by routine polling, only by an active IP block (Test 3).
    console.log(`\n🔍 [Test 1] /api/health nunca cuenta contra el límite general...`);
    for (let i = 0; i < 15; i++) {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.status !== 200) {
        throw new Error(
          `[Test 1] /api/health debería siempre responder 200, llegó ${res.status} en el intento ${i + 1}.`
        );
      }
    }
    console.log(`✅ [PASSED] 15 hits seguidos a /api/health, todos 200.`);

    // Test 2: the general /api/* limit trips at exactly GENERAL_API_RATE_LIMIT
    // (120) within the window — this same IP already made 0 requests toward
    // that counter (health checks are exempt), so the first 120 hits to a
    // real counted endpoint must succeed and the 121st must be 429.
    console.log(`\n🔍 [Test 2] Límite general de /api/* dispara exactamente en 120/min...`);
    let firstRejectedAt = -1;
    for (let i = 1; i <= 125; i++) {
      const res = await fetch(`${BASE_URL}/api/companies/search?limit=1`);
      if (res.status === 429 && firstRejectedAt === -1) firstRejectedAt = i;
    }
    if (firstRejectedAt !== 121) {
      throw new Error(
        `[Test 2] Esperaba que el request #121 fuera el primer 429, el primero fue el #${firstRejectedAt}.`
      );
    }
    console.log(`✅ [PASSED] El request #121 fue el primer 429 (límite = 120 exactos).`);

    // Test 3: sustained rate-limit rejections (already past 120 above) push
    // this IP's suspicious-event count past BLOCK_THRESHOLD (40) — once
    // blocked, even /api/health (normally exempt from the rate check) must
    // be rejected too, since the block check runs before anything else,
    // unconditionally, for every path.
    console.log(
      `\n🔍 [Test 3] Tras cruzar el umbral de bloqueo, incluso /api/health queda bloqueado...`
    );
    for (let i = 0; i < 45; i++) {
      await fetch(`${BASE_URL}/api/companies/search?limit=1`);
    }
    const healthAfterBlock = await fetch(`${BASE_URL}/api/health`);
    if (healthAfterBlock.status !== 429) {
      throw new Error(
        `[Test 3] Con la IP ya bloqueada, /api/health debería responder 429, llegó ${healthAfterBlock.status}.`
      );
    }
    const body = await healthAfterBlock.json();
    if (!body.error) {
      throw new Error(
        `[Test 3] La respuesta 429 de bloqueo debería traer un mensaje de error. Body: ${JSON.stringify(body)}`
      );
    }
    console.log(
      `✅ [PASSED] IP bloqueada — hasta rutas exentas del límite general quedan rechazadas.`
    );

    console.log(`\n==================================================`);
    console.log(
      `🎉 [TEST SUITE PASSED] Rate limiting + auto-block verificados contra el servidor HTTP real.`
    );
    console.log(`==================================================\n`);
  } finally {
    killServerTree(server);
  }

  process.exit(0);
}

runRateLimitingValidation().catch((err) => {
  console.error("❌ [FAILED]", err?.message || err);
  process.exit(1);
});
