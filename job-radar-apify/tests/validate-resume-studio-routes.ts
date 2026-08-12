// Fase 5 de docs/RESUME-STUDIO-PLAN.md — llama handleResumeStudioRoute()
// directamente (sin spawnear un servidor real) porque RESUME_STUDIO_ENABLED
// (config.ts) está en `false` — un servidor real spawneado con la config
// actual nunca llegaría a este módulo de rutas en absoluto (ver el mount
// point en server.ts). Llamar al handler directo prueba la lógica real de
// la ruta (auth, rate limit, validación, Postgres) sin depender de ese
// kill-switch ni de un puerto/proceso aparte. Usuario y token de Supabase
// REALES (misma cuenta de servicio que scripts/create-test-pro-user.ts) —
// verifySession() hace una llamada de red real a Supabase Auth, no se
// simula.
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

process.env.BYOK_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

const { pool } = await import("../src/db/client.js");
const { getOrCreateUser, upgradeUserToPro } = await import("../src/db/job-repository.js");
const { handleResumeStudioRoute } = await import("../src/server/routes/resume-studio.js");

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    console.log(`✅ [PASSED] ${label}`);
  } else {
    console.error(`❌ [FAILED] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

interface CapturedResponse {
  res: ServerResponse;
  status: () => number;
  body: () => any;
}

function fakeReq(authorization?: string): IncomingMessage {
  return { headers: authorization ? { authorization } : {} } as unknown as IncomingMessage;
}

async function reqWithBody(authorization: string, body: unknown): Promise<IncomingMessage> {
  const { Readable } = await import("node:stream");
  const stream = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage;
  (stream as unknown as { headers: Record<string, string> }).headers = { authorization };
  return stream;
}

function fakeRes(): CapturedResponse {
  let status = 0;
  let bodyText = "";
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(chunk?: string) {
      if (chunk) bodyText = chunk;
    }
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    body: () => (bodyText ? JSON.parse(bodyText) : undefined)
  };
}

async function createRealTestUserAndToken(label: string): Promise<{ userId: string; token: string; email: string }> {
  const url = process.env.VITE_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY!;
  const admin = createClient(url, serviceKey);

  const email = `resume-studio-route-${label}-${Date.now()}@example-test.com`;
  const password = `TestRS-${Date.now()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  await getOrCreateUser(data.user.id, email);
  await upgradeUserToPro(data.user.id, new Date(Date.now() + 20 * 24 * 3600 * 1000));

  const anonClient = createClient(url, anonKey);
  const { data: session, error: signInError } = await anonClient.auth.signInWithPassword({ email, password });
  if (signInError || !session.session) throw new Error(`No se pudo iniciar sesión: ${signInError?.message}`);

  return { userId: data.user.id, token: session.session.access_token, email };
}

async function cleanupUser(userId: string): Promise<void> {
  const url = process.env.VITE_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, serviceKey);
  await pool.query(`DELETE FROM user_ai_credentials WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await admin.auth.admin.deleteUser(userId).catch(() => {});
}

const CTX = (overrides: Partial<{ pathname: string; method: string }> = {}) => ({
  pathname: overrides.pathname ?? "/api/ai/providers",
  method: overrides.method ?? "GET",
  parsedUrl: new URL(`http://localhost${overrides.pathname ?? "/api/ai/providers"}`),
  clientIp: "203.0.113.7" // TEST-NET-3 (RFC 5737) — nunca una IP real, aislada de cualquier rate-limit compartido
});

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Rutas HTTP de Resume Studio + BYOK (Fase 5, Supabase real)`);
  console.log(`==================================================\n`);

  let userId = "";
  let token = "";

  try {
    const created = await createRealTestUserAndToken("main");
    userId = created.userId;
    token = created.token;

    console.log(`🔍 [Test 1] GET /api/ai/providers sin Authorization → 401...`);
    {
      const r = fakeRes();
      const handled = await handleResumeStudioRoute(fakeReq(), r.res, CTX());
      check("El handler lo maneja (true)", handled === true);
      check("401", r.status() === 401, `status=${r.status()}`);
    }

    console.log(`\n🔍 [Test 2] GET /api/ai/providers con token real y tier Pro → 200, lista los 5 proveedores registrados, ninguno conectado...`);
    {
      const r = fakeRes();
      await handleResumeStudioRoute(fakeReq(`Bearer ${token}`), r.res, CTX());
      check("200", r.status() === 200, `status=${r.status()}`);
      const body = r.body();
      check("Trae los 5 proveedores registrados en Fase 4", body.providers.length === 5, JSON.stringify(body.providers.map((p: any) => p.providerId)));
      check("Ninguno conectado todavía (usuario recién creado)", body.providers.every((p: any) => p.connected === false));
      check("Incluye google/anthropic/openai/openrouter/ollama", ["google", "anthropic", "openai", "openrouter", "ollama"].every((id) => body.providers.some((p: any) => p.providerId === id)));
    }

    console.log(`\n🔍 [Test 3] POST a un proveedor que no existe → 404, nunca intenta guardar nada...`);
    {
      const r = fakeRes();
      await handleResumeStudioRoute(fakeReq(`Bearer ${token}`), r.res, CTX({ pathname: "/api/ai/providers/no-existe/credentials", method: "POST" }));
      check("404", r.status() === 404, `status=${r.status()}`);
    }

    console.log(`\n🔍 [Test 4] POST con una key obviamente inválida contra Google (red real) → 422, nunca se guarda...`);
    {
      const r = fakeRes();
      await handleResumeStudioRoute(
        await reqWithBody(`Bearer ${token}`, { apiKey: "esto-no-es-una-api-key-real-de-google" }),
        r.res,
        CTX({ pathname: "/api/ai/providers/google/credentials", method: "POST" })
      );
      check("422 (validateCredentials real contra Google la rechaza)", r.status() === 422, `status=${r.status()} body=${JSON.stringify(r.body())}`);

      const { rows } = await pool.query(`SELECT 1 FROM user_ai_credentials WHERE user_id = $1 AND provider_id = 'google'`, [userId]);
      check("Nunca se guardó nada en Postgres (la validación falló ANTES del INSERT)", rows.length === 0);
    }

    console.log(`\n🔍 [Test 5] Conectar Google con la GEMINI_API_KEY REAL de este entorno (ya usada en el pipeline de CV) → 200, round-trip completo...`);
    {
      const hasRealKey = !!process.env.GEMINI_API_KEY;
      if (!hasRealKey) {
        console.log("   (sin GEMINI_API_KEY en este entorno — se omite, no se puede probar el camino feliz sin una key real)");
      } else {
        const connectRes = fakeRes();
        await handleResumeStudioRoute(
          await reqWithBody(`Bearer ${token}`, { apiKey: process.env.GEMINI_API_KEY, label: "Cuenta de prueba Fase 5" }),
          connectRes.res,
          CTX({ pathname: "/api/ai/providers/google/credentials", method: "POST" })
        );
        check("200 al conectar con una key real y válida", connectRes.status() === 200, `status=${connectRes.status()} body=${JSON.stringify(connectRes.body())}`);
        check("connected:true en la respuesta", connectRes.body()?.connected === true);
        check("last4 son los últimos 4 caracteres reales de la key", connectRes.body()?.last4 === process.env.GEMINI_API_KEY!.slice(-4));

        const listRes = fakeRes();
        await handleResumeStudioRoute(fakeReq(`Bearer ${token}`), listRes.res, CTX());
        const googleEntry = listRes.body().providers.find((p: any) => p.providerId === "google");
        check("GET /api/ai/providers ahora muestra google conectado", googleEntry?.connected === true, JSON.stringify(googleEntry));
        check("Con el label que se mandó al conectar", googleEntry?.label === "Cuenta de prueba Fase 5");

        const deleteRes = fakeRes();
        await handleResumeStudioRoute(fakeReq(`Bearer ${token}`), deleteRes.res, CTX({ pathname: "/api/ai/providers/google/credentials", method: "DELETE" }));
        check("200 al desconectar", deleteRes.status() === 200);

        const listAfterDelete = fakeRes();
        await handleResumeStudioRoute(fakeReq(`Bearer ${token}`), listAfterDelete.res, CTX());
        const googleAfter = listAfterDelete.body().providers.find((p: any) => p.providerId === "google");
        check("Tras desconectar, google vuelve a connected:false", googleAfter?.connected === false);
      }
    }

    console.log(`\n🔍 [Test 6] Body sin apiKey → 400, nunca llega a llamar al proveedor...`);
    {
      const r = fakeRes();
      await handleResumeStudioRoute(
        await reqWithBody(`Bearer ${token}`, { label: "sin apiKey" }),
        r.res,
        CTX({ pathname: "/api/ai/providers/anthropic/credentials", method: "POST" })
      );
      check("400", r.status() === 400, `status=${r.status()}`);
    }

    console.log(`\n🔍 [Test 7] Pathname que no calza con ninguna ruta de este módulo → false (el caller decide qué hacer)...`);
    {
      const r = fakeRes();
      const handled = await handleResumeStudioRoute(fakeReq(`Bearer ${token}`), r.res, CTX({ pathname: "/api/ai/algo-que-no-existe" }));
      check("Devuelve false, nunca escribe una respuesta", handled === false && r.status() === 0);
    }
  } finally {
    if (userId) await cleanupUser(userId);
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] Rutas de Resume Studio + BYOK verificadas con sesión real de Supabase.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  process.exit(1);
});
