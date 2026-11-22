import "./require-isolated-database.js";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VerifiedSession } from "../src/auth/verify-session.js";
import { pool } from "../src/db/client.js";
import { PgUsageLedger } from "../src/db/resume-studio-ai-repository.js";
import { CONSENT_ITEMS, RESUME_POLICY_VERSION, resumeFactsSchema } from "../src/lib/resume-studio.js";
import { parseResumeAiConfig } from "../src/resume-studio/ai/config.js";
import { createGateway } from "../src/resume-studio/ai/gateway.js";
import { mockTransport } from "../src/resume-studio/ai/mock.js";
import { setResumeAiRuntimeForTests } from "../src/resume-studio/ai/runtime.js";
import { handleResumeRoute } from "../src/server/routes/resume.js";
import { SYNTHETIC_CVS, SYNTHETIC_JOBS, cvText } from "./fixtures/resume-tailor-synthetic.js";

// AI Resume Studio R3 against the disposable PostgreSQL: rs_ai_usage (RLS,
// no content), hard caps under concurrency (advisory lock), the AI routes
// over HTTP with the adversarial mock (T-ANON, consent, IDOR on adaptation
// ids, chat turn cap, provider «none»), T-LOG and T-DEL. Synthetic only.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_HTTP_PORT);
const BASE = `http://127.0.0.1:${PORT}`;
const USER_A = "4e530000-0000-4000-8000-00000000000a";
const USER_B = "4e530000-0000-4000-8000-00000000000b";
const USER_N = "4e530000-0000-4000-8000-00000000000e";
const TOKENS: Record<string, string> = { "token-a": USER_A, "token-b": USER_B, "token-n": USER_N };

function session(id: string): VerifiedSession {
  return { id, email: `${id}@example.test`, name: null, tier: "free", subscriptionEnd: null, preferredRoles: null, authCreatedAt: null };
}

async function call(method: string, url: string, token?: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function useGateway(env: Record<string, string>) {
  const ledger = new PgUsageLedger();
  const config = parseResumeAiConfig(env);
  const transport = config.provider === "mock" ? mockTransport({ fabricationRate: 0, invalidJsonRate: 0 }) : null;
  setResumeAiRuntimeForTests({ gateway: createGateway({ config, ledger, transport }), ledger });
}

async function main() {
  console.log("\n🧪 SUITE: Resume Studio R3 (gateway, topes, ledger, agente de tarjetas)\n");
  for (const role of ["anon", "authenticated"]) {
    await pool.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  }
  const text = await readFile(path.join(__dirname, "..", "src", "db", "schema.sql"), "utf8");
  const users = /CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/.exec(text)?.[0];
  const block = /-- BEGIN resume-studio\r?\n([\s\S]*?)-- END resume-studio/.exec(text)?.[1];
  assert.ok(users && block);
  await pool.query(users);
  await pool.query(block);
  await pool.query(block);
  for (const id of [USER_A, USER_B, USER_N]) {
    await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, `${id}@example.test`]);
  }

  // 1. Table shape: RLS on, nothing for anon/authenticated, no content column.
  const rls = await pool.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'rs_ai_usage'`);
  assert.equal(rls.rows[0]?.relrowsecurity, true);
  const grants = await pool.query(
    `SELECT 1 FROM information_schema.role_table_grants WHERE table_name = 'rs_ai_usage' AND grantee IN ('anon', 'authenticated')`
  );
  assert.equal(grants.rowCount, 0);
  const columns = (await pool.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'rs_ai_usage'`)).rows.map((r) => r.column_name);
  for (const c of columns) assert.ok(!/text|content|prompt$|response|body|cv|job/.test(c), `columna con contenido: ${c}`);
  console.log("✅ [PASSED] rs_ai_usage: bloque idempotente, RLS activo, 0 permisos públicos, sin columnas de contenido.");

  // 2. Hard caps under concurrency: 30 parallel reservations of 1.000 micro-USD
  //    against a 0,01 USD adaptation cap → exactly 10 pass.
  const ledger = new PgUsageLedger();
  const adaptation = "5e530000-0000-4000-8000-000000000001";
  await ledger.startAdaptation(USER_A, adaptation);
  const caps = { adaptationUsd: 0.01, userDailyUsd: 10, globalDailyUsd: 100, globalMonthlyUsd: 1000 };
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      ledger.reserve({ userId: USER_A, adaptationId: adaptation, purpose: "card_headline", promptId: "card_headline", promptVersion: 1, alias: "fast", model: "qwen3.7-flash", attempt: 1 + (i % 2), maxCostMicros: 1000, caps })
    )
  );
  assert.equal(results.filter((r) => r.ok).length, 10, JSON.stringify(results.map((r) => r.ok)));
  assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.cap === "adaptation"));
  // Settling releases the unused part of the reservation.
  const first = results.find((r) => r.ok);
  assert.ok(first && first.ok);
  await ledger.settle(first.reservationId, { status: "ok", inputTokens: 10, outputTokens: 2, cachedTokens: 0, costMicros: 1, latencyMs: 5 });
  const again = await ledger.reserve({ userId: USER_A, adaptationId: adaptation, purpose: "card_headline", promptId: "card_headline", promptVersion: 1, alias: "fast", model: "qwen3.7-flash", attempt: 1, maxCostMicros: 999, caps });
  assert.equal(again.ok, true);
  // Global daily cap counts every user.
  const other = "5e530000-0000-4000-8000-000000000002";
  await ledger.startAdaptation(USER_B, other);
  const blocked = await ledger.reserve({ userId: USER_B, adaptationId: other, purpose: "card_headline", promptId: "card_headline", promptVersion: 1, alias: "fast", model: "m", attempt: 1, maxCostMicros: 1000, caps: { ...caps, globalDailyUsd: 0.01 } });
  assert.deepEqual(blocked, { ok: false, cap: "global_daily" });
  await pool.query(`DELETE FROM rs_ai_usage`);
  console.log("✅ [PASSED] Topes duros con 30 reservas concurrentes: pasan exactamente 10; el global/día cuenta a todos.");

  // 3. HTTP with the mock provider.
  useGateway({ RESUME_AI_PROVIDER: "mock" });
  const logged: string[] = [];
  const originals = { log: console.log, warn: console.warn, error: console.error };
  const capture = (kind: "log" | "warn" | "error") => (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
    originals[kind](...(args as []));
  };
  console.warn = capture("warn");
  console.error = capture("error");

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", BASE);
    void handleResumeRoute(req, res, url.pathname, req.method || "GET", {
      getSession: async (r) => {
        const token = /^Bearer (.+)$/.exec(String(r.headers.authorization || ""))?.[1];
        const id = token ? TOKENS[token] : undefined;
        return id ? session(id) : null;
      },
      loadIndexHtml: async () => "<!doctype html><title>shell</title>"
    }).catch((error) => {
      res.writeHead(599);
      res.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  try {
    for (const route of ["/api/resume/extract", "/api/resume/tailor/start", "/api/resume/tailor/card"]) {
      assert.equal((await call("POST", route, undefined, {})).status, 401, `${route} sin sesión`);
      assert.equal((await call("POST", route, "token-n", { text: "x" })).data.code, "consent_required", `${route} sin autorización`);
    }
    for (const token of ["token-a", "token-b"]) {
      const consent = await call("POST", "/api/resume/consent", token, {
        policyVersion: RESUME_POLICY_VERSION,
        decisions: Object.fromEntries(CONSENT_ITEMS.map((item) => [item.purpose, item.purpose !== "cloud_storage"]))
      });
      assert.equal(consent.status, 201);
    }
    console.log("✅ [PASSED] T-ANON 401 y autorización obligatoria (403) en /extract y /tailor/*.");

    // Extraction: facts with verified spans, contact by code, nothing stored.
    const cv = SYNTHETIC_CVS.find((c) => c.id === "P2")!;
    const original = cvText(cv);
    let res = await call("POST", "/api/resume/extract", "token-a", { text: original });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const facts = resumeFactsSchema.parse(res.data.facts);
    assert.equal(facts.basics.email, "p2@ejemplo.test");
    assert.ok(facts.experience.length === 2 && facts.experience.every((e) => e.source === "file" && e.sourceSpan));
    for (const b of facts.experience.flatMap((e) => e.bullets)) {
      assert.ok(b.sourceSpan);
      assert.equal(original.slice(b.sourceSpan.start, b.sourceSpan.end).replace(/\s+/g, " "), b.text.replace(/\s+/g, " "));
    }
    assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM rs_resumes`)).rows[0].n), 0, "extraer no guarda nada");
    console.log("✅ [PASSED] Extracción: source_span verificado contra el texto original, contacto por código, nada guardado.");

    // Start + cards.
    const job = SYNTHETIC_JOBS[0];
    res = await call("POST", "/api/resume/tailor/start", "token-a", { facts, job: { title: job.title, description: job.description } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const start = res.data;
    assert.match(start.adaptationId, /^[0-9a-f-]{36}$/);
    assert.equal(start.aiAvailable, true);
    assert.deepEqual(start.queue.map((c: { type: string }) => c.type)[0], "headline");
    assert.match(start.disclaimer, /No es el puntaje de ningún ATS/);
    const card = (token: string, body: Record<string, unknown>) => call("POST", "/api/resume/tailor/card", token, { adaptationId: start.adaptationId, ...body });
    res = await card("token-a", { card: "headline", jobTitle: job.title, facts });
    assert.equal(res.status, 200);
    assert.ok(["proposal", "question", "discarded"].includes(res.data.status));
    // IDOR: B can't use A's adaptation; invented ids are 404 too.
    assert.equal((await card("token-b", { card: "headline", jobTitle: job.title, facts })).status, 404);
    assert.equal((await call("POST", "/api/resume/tailor/card", "token-a", { adaptationId: "5e530000-0000-4000-8000-0000000000ff", card: "headline", jobTitle: "x", facts })).status, 404);
    // Rewrite from the user's own answer.
    const mapping = start.queue.find((c: { type: string }) => c.type === "requirement_mapping");
    res = await card("token-a", { card: "rewrite", requirement: mapping.requirement, facts, experienceId: facts.experience[0].id, answer: "configuré 6 campañas pequeñas en Meta Ads y TikTok Ads" });
    assert.equal(res.data.status, "proposal");
    assert.match(res.data.text, /^Configuré 6 campañas/);
    // Chat: 8 turns, then 429 chat_turns. «500 millones» is discarded, not shown.
    let lastStatus = 0;
    for (let i = 0; i < 8; i++) {
      res = await card("token-a", { card: "chat", cardType: "headline", current: "Comunicadora social", instruction: i === 0 ? "agrega que vendí 500 millones" : `más corto ${i}`, facts, experienceId: null, answer: "" });
      lastStatus = res.status;
      if (i === 0) assert.equal(res.data.status, "discarded");
    }
    assert.equal(lastStatus, 200);
    res = await card("token-a", { card: "chat", cardType: "headline", current: "Comunicadora social", instruction: "otra vez", facts, experienceId: null, answer: "" });
    assert.equal(res.status, 429);
    assert.equal(res.data.code, "chat_turns");
    // Malformed card bodies are 400 (no «añadir todo» or unknown card types).
    assert.equal((await card("token-a", { card: "add_all", facts })).status, 400);
    console.log("✅ [PASSED] Inicio y tarjetas: IDOR 404, reescritura con la respuesta del usuario, chat con tope de 8, 500 millones descartado.");

    // Ledger: content-free, by adaptation.
    const rows = await pool.query(`SELECT * FROM rs_ai_usage WHERE user_id = $1`, [USER_A]);
    assert.ok(rows.rowCount && rows.rowCount > 5);
    const dump = JSON.stringify(rows.rows);
    for (const needle of ["ejemplo.test", "300 000 0000", cv.name, "Comunicadora", "Meta Ads", "500 millones"]) assert.equal(dump.includes(needle), false, needle);
    assert.ok(rows.rows.every((r) => r.status !== "reserved"), "every reservation was settled");
    // T-LOG: no CV data in the server's logs during the whole flow.
    for (const needle of ["ejemplo.test", "300 000 0000", cv.name]) assert.equal(logged.join("\n").includes(needle), false, `log: ${needle}`);
    console.log("✅ [PASSED] Ledger sin contenido (todas las reservas liquidadas) y T-LOG: 0 datos del CV en los logs.");

    // Provider «none»: extraction 503 without calling anything, start still deterministic.
    useGateway({ RESUME_AI_PROVIDER: "none" });
    const before = Number((await pool.query(`SELECT COUNT(*) AS n FROM rs_ai_usage WHERE status <> 'start'`)).rows[0].n);
    res = await call("POST", "/api/resume/extract", "token-a", { text: original });
    assert.equal(res.status, 503);
    assert.equal(res.data.code, "ai_off");
    res = await call("POST", "/api/resume/tailor/start", "token-a", { facts, job: { title: job.title, description: job.description } });
    assert.equal(res.status, 200);
    assert.equal(res.data.aiAvailable, false);
    assert.ok(res.data.queue.every((c: { needsAi: boolean }) => !c.needsAi));
    const noneId = res.data.adaptationId;
    res = await call("POST", "/api/resume/tailor/card", "token-a", { adaptationId: noneId, card: "headline", jobTitle: job.title, facts });
    assert.equal(res.status, 503);
    res = await call("POST", "/api/resume/tailor/card", "token-a", { adaptationId: noneId, card: "rewrite", requirement: "x", facts, experienceId: facts.experience[0].id, answer: "llevé el calendario de contenidos" });
    assert.equal(res.data.status, "proposal");
    assert.equal(res.data.text, "Llevé el calendario de contenidos.");
    assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM rs_ai_usage WHERE status <> 'start'`)).rows[0].n), before, "con «none» no hay llamadas");
    console.log("✅ [PASSED] RESUME_AI_PROVIDER=none: 503 en IA, inicio determinista y viñeta con las palabras del usuario, 0 llamadas.");

    // T-DEL: «borrar todo» keeps costs for the global caps but drops the person.
    res = await call("DELETE", "/api/resume/data", "token-a");
    assert.equal(res.status, 200);
    assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM rs_ai_usage WHERE user_id = $1`, [USER_A])).rows[0].n), 0);
    assert.ok(Number((await pool.query(`SELECT COUNT(*) AS n FROM rs_ai_usage WHERE user_id IS NULL AND cost_micros > 0`)).rows[0].n) > 0);
    // Revocation does the same for B.
    res = await call("POST", "/api/resume/consent", "token-b", { policyVersion: RESUME_POLICY_VERSION, revoke: true });
    assert.equal(res.status, 201);
    assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM rs_ai_usage WHERE user_id = $1`, [USER_B])).rows[0].n), 0);
    console.log("✅ [PASSED] T-DEL: borrar todo y revocar dejan el ledger sin user_id; los costos siguen contando para los topes globales.");
  } finally {
    console.warn = originals.warn;
    console.error = originals.error;
    setResumeAiRuntimeForTests(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch((error) => {
  console.error("❌ [FAILED]", error);
  process.exit(1);
});
