import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Local-only dev login of the AI Resume Studio (src/auth/dev-auth.ts), with
// the REAL verifySession behind a real HTTP server on 127.0.0.1:
//
// - every guard: flag off, non-loopback DATABASE_URL, NODE_ENV=production,
//   non-sandbox Wompi key, foreign Host header, proxy header, a forged
//   rsdev_ token → 401 (and /dev-auth, /dev-login → 404);
// - a production-style build has no trace of the button; the launcher-style
//   build does (so the check means something);
// - with the mode on, the whole flow works end to end: link (pasted) → CV
//   → agent cards (mock AI) → Wompi sandbox checkout → confirm (stubbed
//   Wompi API) → clean DOCX → «Mis postulaciones». No Supabase variables
//   are set at all: the dev user never touches Supabase.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const PORT = Number(process.env.TEST_HTTP_PORT);
const BASE = `http://127.0.0.1:${PORT}`;
const DEV_ENV = {
  RESUME_STUDIO_DEV_AUTH: "1",
  NODE_ENV: "development",
  WOMPI_PUBLIC_KEY: "pub_test_devauthsynthetic"
};

function request(method: string, url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; data: any; bytes: Buffer }>((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    const req = http.request(
      `${BASE}${url}`,
      {
        method,
        headers: {
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          ...(payload ? { "Content-Type": "application/json", "Content-Length": String(payload.length) } : {}),
          ...(opts.headers ?? {})
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const bytes = Buffer.concat(chunks);
          let data: any = null;
          try {
            data = bytes.length && String(res.headers["content-type"] || "").includes("json") ? JSON.parse(bytes.toString("utf8")) : null;
          } catch {
            data = null;
          }
          resolve({ status: res.statusCode ?? 0, data, bytes });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function buildContains(extraEnv: Record<string, string>, needle: string): Promise<boolean> {
  const out = await mkdtemp(path.join(os.tmpdir(), "rs-devauth-build-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv, VITE_SUPABASE_URL: "http://127.0.0.1:9", VITE_SUPABASE_ANON_KEY: "x" };
    if (!("VITE_RESUME_STUDIO_DEV_AUTH" in extraEnv)) delete env.VITE_RESUME_STUDIO_DEV_AUTH;
    const result = spawnSync(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", out, "--emptyOutDir"], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 180000
    });
    assert.equal(result.status, 0, result.stderr?.slice(-2000));
    for (const file of await readdir(path.join(out, "assets"))) {
      if (file.endsWith(".js") && (await readFile(path.join(out, "assets", file), "utf8")).includes(needle)) return true;
    }
    return false;
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

async function main() {
  console.log("\n🧪 SUITE: Resume Studio — login de desarrollo solo local (guardas, bundle y flujo completo)\n");

  // 1. Production-style build: no trace. Launcher-style build: the button.
  const BUTTON = "Entrar como usuario de prueba (solo local)";
  assert.equal(await buildContains({}, BUTTON), false, "el build normal no debe incluir el login de desarrollo");
  assert.equal(await buildContains({}, "rs-dev-token"), false);
  assert.equal(await buildContains({ VITE_RESUME_STUDIO_DEV_AUTH: "1" }, BUTTON), true, "el build del lanzador sí lo incluye");
  console.log("✅ [PASSED] Bundle: el build normal no contiene el botón ni la clave del token; el del lanzador sí.");

  // Environment for the real verifySession: NO Supabase at all.
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_ANON_KEY;
  Object.assign(process.env, DEV_ENV);
  const realDatabaseUrl = process.env.DATABASE_URL!;
  assert.match(new URL(realDatabaseUrl).hostname, /^(127\.0\.0\.1|localhost|::1|\[::1\])$/);

  const { pool } = await import("../src/db/client.js");
  const { verifySession } = await import("../src/auth/verify-session.js");
  const { DEV_AUTH_USER } = await import("../src/auth/dev-auth.js");
  const { handleResumeRoute } = await import("../src/server/routes/resume.js");
  const { setWompiFetchForTests } = await import("../src/server/routes/resume-pass.js");
  const { PgUsageLedger } = await import("../src/db/resume-studio-ai-repository.js");
  const { parseResumeAiConfig } = await import("../src/resume-studio/ai/config.js");
  const { createGateway } = await import("../src/resume-studio/ai/gateway.js");
  const { mockTransport } = await import("../src/resume-studio/ai/mock.js");
  const { setResumeAiRuntimeForTests } = await import("../src/resume-studio/ai/runtime.js");
  const { CONSENT_ITEMS, RESUME_POLICY_VERSION, emptyResumeFacts } = await import("../src/lib/resume-studio.js");
  const { SYNTHETIC_CVS, SYNTHETIC_JOBS } = await import("./fixtures/resume-tailor-synthetic.js");

  for (const role of ["anon", "authenticated"]) {
    await pool.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  }
  const schema = await readFile(path.join(root, "src", "db", "schema.sql"), "utf8");
  const users = /CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/.exec(schema)?.[0];
  const transactions = /CREATE TABLE IF NOT EXISTS transactions \([\s\S]*?\n\);/.exec(schema)?.[0];
  const planColumn = /ALTER TABLE transactions ADD COLUMN IF NOT EXISTS plan [^;]+;/.exec(schema)?.[0];
  const block = /-- BEGIN resume-studio\r?\n([\s\S]*?)-- END resume-studio/.exec(schema)?.[1];
  assert.ok(users && transactions && planColumn && block);
  await pool.query(users);
  // verifySession's getOrCreateUser reads the later additive users columns too.
  for (const alter of schema.match(/ALTER TABLE users ADD COLUMN IF NOT EXISTS [^;]+;/g) ?? []) await pool.query(alter);
  await pool.query(transactions);
  await pool.query(planColumn);
  await pool.query(block);

  const config = parseResumeAiConfig({ RESUME_AI_PROVIDER: "mock" });
  const ledger = new PgUsageLedger();
  setResumeAiRuntimeForTests({ gateway: createGateway({ config, ledger, transport: mockTransport({ fabricationRate: 0, invalidJsonRate: 0 }) }), ledger });
  let wompiAnswer: Record<string, unknown> | null = null;
  setWompiFetchForTests(async () => ({ ok: wompiAnswer !== null, status: wompiAnswer ? 200 : 404, text: async () => JSON.stringify({ data: wompiAnswer }) }));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", BASE);
    void handleResumeRoute(req, res, url.pathname, req.method || "GET", {
      getSession: verifySession,
      loadIndexHtml: async () => "<!doctype html><title>shell</title>"
    }).catch((error) => {
      res.writeHead(599);
      res.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  const saved = { payments: process.env.RESUME_STUDIO_PAYMENTS };
  try {
    // 2. Mode on: status, login, a valid session for the fixed user.
    let res = await request("GET", "/api/resume/dev-auth");
    assert.equal(res.status, 200);
    assert.equal(res.data.userId, DEV_AUTH_USER.id);
    res = await request("POST", "/api/resume/dev-login");
    assert.equal(res.status, 200);
    const token: string = res.data.token;
    assert.match(token, /^rsdev_[0-9a-f]{64}$/);
    assert.equal((await request("POST", "/api/resume/dev-login")).data.token, token, "un token por proceso");
    const first = await request("GET", "/api/resume/consent", { token });
    assert.equal(first.status, 200, first.bytes.toString("utf8").slice(0, 500));
    const userRow = await pool.query(`SELECT email FROM users WHERE id = $1`, [DEV_AUTH_USER.id]);
    assert.equal(userRow.rows[0]?.email, "dev@localhost.test", "el usuario fijo vive en la base desechable");
    assert.equal((await request("GET", "/api/resume/dev-login")).status, 405);

    // 3. Every guard → 401 for the token, 404 for the dev routes.
    const guards: [string, () => void][] = [
      ["bandera apagada", () => delete process.env.RESUME_STUDIO_DEV_AUTH],
      ["bandera ≠ 1", () => (process.env.RESUME_STUDIO_DEV_AUTH = "true")],
      ["DATABASE_URL no loopback", () => (process.env.DATABASE_URL = "postgresql://u:p@db.example.supabase.co:5432/postgres")],
      ["DATABASE_URL inválida", () => (process.env.DATABASE_URL = "no-es-url")],
      ["NODE_ENV=production", () => (process.env.NODE_ENV = "production")],
      ["Wompi de producción", () => (process.env.WOMPI_PUBLIC_KEY = "pub_prod_live")],
      ["Wompi sin llave", () => delete process.env.WOMPI_PUBLIC_KEY]
    ];
    for (const [label, apply] of guards) {
      apply();
      assert.equal((await request("GET", "/api/resume/consent", { token })).status, 401, label);
      assert.equal((await request("GET", "/api/resume/dev-auth")).status, 404, label);
      assert.equal((await request("POST", "/api/resume/dev-login")).status, 404, label);
      Object.assign(process.env, DEV_ENV, { DATABASE_URL: realDatabaseUrl });
    }
    const requestGuards: [string, Record<string, string>][] = [
      ["Host ajeno (DNS rebinding)", { Host: "evil.example.com" }],
      ["Host con IP pública", { Host: "203.0.113.5:3000" }],
      ["X-Forwarded-For", { "X-Forwarded-For": "203.0.113.5" }],
      ["Forwarded", { Forwarded: "for=203.0.113.5" }]
    ];
    for (const [label, headers] of requestGuards) {
      assert.equal((await request("GET", "/api/resume/consent", { token, headers })).status, 401, label);
      assert.equal((await request("POST", "/api/resume/dev-login", { headers })).status, 404, label);
    }
    for (const forged of [`rsdev_${"0".repeat(64)}`, "rsdev_", `${token}x`, token.slice(0, -1)]) {
      assert.equal((await request("GET", "/api/resume/consent", { token: forged })).status, 401, "token inventado");
    }
    // A non-dev token with no Supabase configured is simply not a session.
    assert.equal((await request("GET", "/api/resume/consent", { token: "eyJhbGciOiJIUzI1NiJ9.x.y" })).status, 401);
    assert.equal((await request("GET", "/api/resume/consent", { token })).status, 200, "con todo restaurado vuelve a valer");
    console.log(
      `✅ [PASSED] Guardas: ${guards.length} de proceso y ${requestGuards.length} de petición → 401 con el token y 404 en /dev-auth y /dev-login; tokens inventados 401; sin Supabase configurado nunca se llama.`
    );

    // 4. End to end with the dev user: link → CV → cards → checkout → confirm → DOCX → postulación.
    process.env.RESUME_STUDIO_PAYMENTS = "true";
    res = await request("POST", "/api/resume/consent", {
      token,
      body: { policyVersion: RESUME_POLICY_VERSION, decisions: Object.fromEntries(CONSENT_ITEMS.map((item) => [item.purpose, true])) }
    });
    assert.equal(res.status, 201);
    const job = SYNTHETIC_JOBS[0];
    const jobUrl = "https://empleos.example.com/vacante/dev-auth-1";
    res = await request("POST", "/api/resume/job-link/paste", { token, body: { url: jobUrl, title: job.title, company: "Empresa Sintética", text: job.description } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const snapshot = res.data.snapshot;
    assert.equal(snapshot.title, job.title);

    const facts = emptyResumeFacts();
    facts.basics.fullName = SYNTHETIC_CVS[0].id;
    facts.basics.headline = "Asistente";
    res = await request("POST", "/api/resume/resumes", { token, body: { title: "Base de prueba", templateId: "clasica", facts } });
    assert.equal(res.status, 201);
    const base = res.data.resume;

    res = await request("POST", "/api/resume/tailor/start", { token, body: { facts, job: { title: snapshot.title, description: snapshot.description } } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const adaptationId: string = res.data.adaptationId;
    assert.ok(Array.isArray(res.data.queue));
    res = await request("POST", "/api/resume/tailor/card", { token, body: { adaptationId, card: "headline", jobTitle: snapshot.title, facts } });
    assert.equal(res.status, 200, JSON.stringify(res.data));

    res = await request("POST", "/api/resume/checkout", { token, body: { passId: "pass_7d" } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.publicKey, DEV_ENV.WOMPI_PUBLIC_KEY);
    const reference: string = res.data.reference;
    assert.equal((await request("POST", "/api/resume/download/docx", { token, body: { facts, templateId: "clasica" } })).status, 402);
    wompiAnswer = { id: "88-1-1", status: "APPROVED", reference, amount_in_cents: res.data.amountInCents, currency: "COP" };
    res = await request("POST", "/api/resume/checkout/confirm", { token, body: { transactionId: "88-1-1" } });
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "approved");
    res = await request("POST", "/api/resume/download/docx", { token, body: { facts, templateId: "clasica" } });
    assert.equal(res.status, 200);
    assert.equal(res.bytes.readUInt32LE(0), 0x04034b50, "un archivo Word (zip)");

    res = await request("POST", "/api/resume/applications", {
      token,
      body: {
        job: { title: snapshot.title, company: snapshot.company, url: snapshot.sourceUrl },
        adaptationId,
        resumeId: base.id,
        resumeVersionNo: base.versionNo,
        scoreBefore: 30,
        scoreAfter: 70,
        facts
      }
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    const card = res.data.application;
    res = await request("POST", "/api/resume/applications", { token, body: { job: { title: snapshot.title, url: snapshot.sourceUrl }, status: "applied" } });
    assert.equal(res.data.application.id, card.id);
    res = await request("PATCH", `/api/resume/applications/${card.id}`, { token, body: { status: "interview" } });
    assert.equal(res.data.application.status, "interview");
    assert.ok(res.data.application.appliedAt);
    console.log("✅ [PASSED] De punta a punta con el usuario de prueba: link → CV → tarjetas (IA mock) → checkout sandbox → confirmación → DOCX → postulación (Guardada → Postulé → Entrevista).");
  } finally {
    if (saved.payments === undefined) delete process.env.RESUME_STUDIO_PAYMENTS;
    else process.env.RESUME_STUDIO_PAYMENTS = saved.payments;
    setWompiFetchForTests(null);
    setResumeAiRuntimeForTests(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch((error) => {
  console.error("❌ [FAILED]", error);
  process.exit(1);
});
