import "./require-isolated-database.js";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VerifiedSession } from "../src/auth/verify-session.js";
import { pool } from "../src/db/client.js";
import { APPLICATIONS_MAX_PER_USER } from "../src/lib/resume-applications.js";
import { CONSENT_ITEMS, RESUME_POLICY_VERSION, emptyResumeFacts } from "../src/lib/resume-studio.js";
import { handleResumeRoute } from "../src/server/routes/resume.js";

// AI Resume Studio R4b — «Mis postulaciones» against the disposable
// PostgreSQL (doc 11 §5.1, doc 08 §3). Schema (RLS, no public grants,
// CHECKs), the CRUD with upsert by vacancy link, T-IDOR for applications
// (someone else's id = 404 on every verb, references to someone else's
// adaptation or resume = 404), FREE (no pass and an exhausted quota never
// block the tracker), and the holder's rights: export includes the cards,
// «borrar todo», «revocar» and turning «guardar en mi cuenta» off delete them.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_HTTP_PORT);
const BASE = `http://127.0.0.1:${PORT}`;
const USER_A = "4b000000-0000-4000-8000-00000000000a";
const USER_B = "4b000000-0000-4000-8000-00000000000b";
const USER_C = "4b000000-0000-4000-8000-00000000000c";
const USER_D = "4b000000-0000-4000-8000-00000000000d";
const TOKENS: Record<string, string> = { "token-a": USER_A, "token-b": USER_B, "token-c": USER_C, "token-d": USER_D };
const ADAPTATION_A = "4b0000aa-0000-4000-8000-000000000001";
const ADAPTATION_B = "4b0000bb-0000-4000-8000-000000000002";
const JOB_URL = "https://empleos.example.com/vacante/analista-123";

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
  return { status: res.status, data, headers: res.headers };
}

async function consent(token: string, storage: boolean) {
  return call("POST", "/api/resume/consent", token, {
    policyVersion: RESUME_POLICY_VERSION,
    decisions: Object.fromEntries(CONSENT_ITEMS.map((item) => [item.purpose, item.purpose === "cloud_storage" ? storage : true]))
  });
}

async function rows(userId: string) {
  return (await pool.query(`SELECT * FROM rs_applications WHERE user_id = $1 ORDER BY created_at`, [userId])).rows;
}

async function main() {
  console.log("\n🧪 SUITE: Resume Studio R4b («Mis postulaciones»: CRUD, T-IDOR, gratis, borrar/exportar/revocar)\n");
  for (const role of ["anon", "authenticated"]) {
    await pool.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  }
  const schema = await readFile(path.join(__dirname, "..", "src", "db", "schema.sql"), "utf8");
  const users = /CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/.exec(schema)?.[0];
  const block = /-- BEGIN resume-studio\r?\n([\s\S]*?)-- END resume-studio/.exec(schema)?.[1];
  assert.ok(users && block);
  await pool.query(users);
  await pool.query(block);
  await pool.query(block);
  for (const id of [USER_A, USER_B, USER_C, USER_D]) {
    await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, `${id}@example.test`]);
  }

  // 0. Table shape.
  const rls = await pool.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'rs_applications'`);
  assert.equal(rls.rows[0]?.relrowsecurity, true);
  const grants = await pool.query(`SELECT 1 FROM information_schema.role_table_grants WHERE table_name = 'rs_applications' AND grantee IN ('anon', 'authenticated')`);
  assert.equal(grants.rowCount, 0);
  await assert.rejects(pool.query(`INSERT INTO rs_applications (user_id, job_title, status) VALUES ($1, 'X', 'hired')`, [USER_A]), /check/i);
  await assert.rejects(pool.query(`INSERT INTO rs_applications (user_id, job_title, job_url) VALUES ($1, 'X', 'javascript:alert(1)')`, [USER_A]), /check/i);
  await assert.rejects(pool.query(`INSERT INTO rs_applications (user_id, job_title, score_after) VALUES ($1, 'X', 101)`, [USER_A]), /check/i);
  await assert.rejects(pool.query(`INSERT INTO rs_applications (user_id, job_title) VALUES ($1, '  ')`, [USER_A]), /check/i);
  console.log("✅ [PASSED] Esquema R4b: bloque idempotente, RLS activo, 0 permisos para anon/authenticated, CHECKs de estado, link, puntaje y cargo.");

  // Synthetic adaptations (R3 ledger 'start' rows) — no AI call needed.
  await pool.query(`INSERT INTO rs_ai_usage (user_id, adaptation_id, purpose, status) VALUES ($1, $2, 'start', 'start'), ($3, $4, 'start', 'start')`, [
    USER_A,
    ADAPTATION_A,
    USER_B,
    ADAPTATION_B
  ]);

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
    // Session and consent.
    assert.equal((await call("GET", "/api/resume/applications")).status, 401);
    assert.equal((await call("POST", "/api/resume/applications", undefined, { job: { title: "X" } })).status, 401);
    let res = await call("POST", "/api/resume/applications", "token-a", { job: { title: "Analista" } });
    assert.equal(res.status, 403);
    assert.equal(res.data.code, "consent_required");
    assert.equal((await consent("token-c", false)).status, 201);
    res = await call("POST", "/api/resume/applications", "token-c", { job: { title: "Analista" } });
    assert.equal(res.status, 403);
    assert.equal(res.data.code, "storage_consent_required");
    res = await call("GET", "/api/resume/applications", "token-c");
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.applications, []);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    console.log("✅ [PASSED] Sesión (401) y autorizaciones: escribir pide las obligatorias y «guardar en mi cuenta» (403 con código); leer no.");

    for (const token of ["token-a", "token-b", "token-d"]) assert.equal((await consent(token, true)).status, 201);

    // FREE: A has no pass and an exhausted free quota; the tracker doesn't care.
    await pool.query(
      `INSERT INTO rs_adaptation_quota (bucket, period_start, used) VALUES ($1, date_trunc('month', NOW()), 9999) ON CONFLICT DO NOTHING`,
      [`free:${USER_A}`]
    );
    assert.equal((await pool.query(`SELECT 1 FROM rs_entitlements WHERE user_id = $1`, [USER_A])).rowCount, 0);

    // CRUD + upsert by link.
    res = await call("POST", "/api/resume/applications", "token-a", { job: { title: "Diseñador gráfico Jr.", company: "Estudio Norte" } });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.created, true);
    assert.equal(res.data.application.status, "saved");
    assert.equal(res.data.application.hasCv, false);
    const plainId = res.data.application.id;

    const facts = emptyResumeFacts();
    facts.basics.fullName = "Persona Sintética";
    facts.basics.headline = "Analista de datos";
    res = await call("POST", "/api/resume/applications", "token-a", {
      job: { title: "Analista de datos", company: "Empresa Sintética", url: `${JOB_URL}#aplicar` },
      adaptationId: ADAPTATION_A,
      scoreBefore: 28,
      scoreAfter: 70,
      facts
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    const jobId = res.data.application.id;
    assert.equal(res.data.application.job.url, JOB_URL, "link guardado sin fragmento");
    assert.equal(res.data.application.appliedAt, null);
    assert.deepEqual(res.data.application.facts, facts);

    // «Marcar como postulé» from the same link → same card, now applied.
    res = await call("POST", "/api/resume/applications", "token-a", { job: { title: "Analista de datos", url: JOB_URL.replace("empleos.example.com", "EMPLEOS.example.com") }, status: "applied" });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.created, false);
    assert.equal(res.data.application.id, jobId);
    assert.equal(res.data.application.status, "applied");
    assert.ok(res.data.application.appliedAt);
    assert.equal(res.data.application.scoreAfter, 70, "lo que no llega se conserva");
    assert.equal(res.data.application.job.company, "Empresa Sintética");
    assert.equal(res.data.application.hasCv, true);
    assert.equal((await rows(USER_A)).length, 2);

    // List: summaries only (no CV content), GET one: with the CV.
    res = await call("GET", "/api/resume/applications", "token-a");
    assert.equal(res.status, 200);
    assert.equal(res.data.applications.length, 2);
    assert.ok(res.data.applications.every((a: Record<string, unknown>) => !("facts" in a)));
    res = await call("GET", `/api/resume/applications/${jobId}`, "token-a");
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.application.facts, facts);
    console.log("✅ [PASSED] CRUD: crear (201), mismo link = misma tarjeta (guardar → «Postulé»), lista sin el CV, detalle con el CV adaptado y los puntajes.");

    // Move through the board: applied → interview (applied_at kept) + note.
    const appliedAt = res.data.application.appliedAt;
    res = await call("PATCH", `/api/resume/applications/${jobId}`, "token-a", { status: "interview", note: "Ronda 1 el martes" });
    assert.equal(res.status, 200);
    assert.equal(res.data.application.status, "interview");
    assert.equal(res.data.application.note, "Ronda 1 el martes");
    assert.equal(res.data.application.appliedAt, appliedAt);
    res = await call("PATCH", `/api/resume/applications/${plainId}`, "token-a", { status: "discarded" });
    assert.equal(res.data.application.appliedAt, null, "descartar sin postular no inventa fecha de postulación");
    for (const bad of [{}, { status: "hired" }, { status: "offer", jobTitle: "X" }, { note: "a".repeat(281) }]) {
      assert.equal((await call("PATCH", `/api/resume/applications/${jobId}`, "token-a", bad)).status, 400, JSON.stringify(bad).slice(0, 40));
    }
    assert.equal((await call("PUT", `/api/resume/applications/${jobId}`, "token-a", { status: "offer" })).status, 405);
    assert.equal((await call("PUT", "/api/resume/applications", "token-a", {})).status, 405);
    console.log("✅ [PASSED] Mover: Postulé → Entrevista conserva la fecha de postulación; nota corta; cuerpos inválidos 400, verbos ajenos 405.");

    // T-IDOR for applications.
    const before = (await rows(USER_A)).find((r) => r.id === jobId);
    for (const [method, body] of [["GET"], ["PATCH", { status: "offer" }], ["DELETE"]] as const) {
      res = await call(method, `/api/resume/applications/${jobId}`, "token-b", body);
      assert.equal(res.status, 404, `B ${method} sobre la postulación de A`);
    }
    assert.deepEqual((await rows(USER_A)).find((r) => r.id === jobId), before, "la fila de A no cambió");
    res = await call("GET", "/api/resume/applications", "token-b");
    assert.deepEqual(res.data.applications, [], "B nunca ve las tarjetas de A");
    res = await call("GET", "/api/resume/applications/4b000000-0000-4000-8000-0000000000ff", "token-a");
    assert.equal(res.status, 404, "id inventado = 404, igual que uno ajeno");
    assert.equal((await call("GET", "/api/resume/applications/not-a-uuid", "token-a")).status, 404);
    assert.equal((await call("GET", `/api/resume/applications/${jobId}/extra`, "token-a")).status, 404);
    // Smuggled owner, someone else's adaptation or resume.
    res = await call("POST", "/api/resume/applications", "token-b", { job: { title: "X" }, userId: USER_A });
    assert.equal(res.status, 400);
    res = await call("POST", "/api/resume/applications", "token-b", { job: { title: "X", url: "https://otra.example.com/1" }, adaptationId: ADAPTATION_A });
    assert.equal(res.status, 404);
    assert.equal(res.data.code, "reference_not_found");
    res = await call("POST", "/api/resume/applications", "token-b", { job: { title: "X" }, adaptationId: "4b0000cc-0000-4000-8000-000000000003" });
    assert.equal(res.status, 404);
    const resumeA = await call("POST", "/api/resume/resumes", "token-a", { title: "Base A", templateId: "clasica", facts });
    assert.equal(resumeA.status, 201);
    res = await call("POST", "/api/resume/applications", "token-b", { job: { title: "X" }, resumeId: resumeA.data.resume.id, resumeVersionNo: 1 });
    assert.equal(res.status, 404);
    // B saving A's job URL creates B's OWN card (the unique key is per user).
    res = await call("POST", "/api/resume/applications", "token-b", { job: { title: "Analista de datos", url: JOB_URL }, adaptationId: ADAPTATION_B });
    assert.equal(res.status, 201);
    assert.notEqual(res.data.application.id, jobId);
    assert.equal((await rows(USER_A)).find((r) => r.id === jobId)?.status, "interview");
    assert.equal((await rows(USER_B)).length, 1);
    console.log("✅ [PASSED] T-IDOR postulaciones: GET/PATCH/DELETE ajenos = 404 sin cambios; lista aislada; userId en el cuerpo 400; adaptación u hoja de vida ajena 404; mismo link en otra cuenta = tarjeta propia.");

    // A's own resume reference is accepted.
    res = await call("POST", "/api/resume/applications", "token-a", {
      job: { title: "Community Manager", url: "https://empleos.example.com/vacante/cm-9" },
      resumeId: resumeA.data.resume.id,
      resumeVersionNo: 1,
      status: "offer"
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.application.resumeId, resumeA.data.resume.id);
    assert.ok(res.data.application.appliedAt, "Oferta implica que hubo postulación");
    const quota = await pool.query(`SELECT used FROM rs_adaptation_quota WHERE bucket = $1`, [`free:${USER_A}`]);
    assert.equal(Number(quota.rows[0].used), 9999, "el tracker no consume ni mira el cupo");
    console.log("✅ [PASSED] Gratis: sin pase y con el cupo gratis agotado, crear, mover y guardar CV adaptado funciona; nunca 402 y el cupo no cambia.");

    // Per-user cap.
    await pool.query(
      `INSERT INTO rs_applications (user_id, job_title) SELECT $1, 'Relleno ' || g FROM generate_series(1, $2::int) g`,
      [USER_D, APPLICATIONS_MAX_PER_USER]
    );
    res = await call("POST", "/api/resume/applications", "token-d", { job: { title: "Una más" } });
    assert.equal(res.status, 409);
    assert.equal(res.data.code, "limit");
    assert.equal((await call("GET", "/api/resume/applications", "token-d")).data.applications.length, APPLICATIONS_MAX_PER_USER);
    console.log(`✅ [PASSED] Tope: ${APPLICATIONS_MAX_PER_USER} postulaciones por usuario (409 limit), la lista queda acotada.`);

    // Delete one.
    assert.equal((await call("DELETE", `/api/resume/applications/${plainId}`, "token-a")).status, 204);
    assert.equal((await call("GET", `/api/resume/applications/${plainId}`, "token-a")).status, 404);

    // Export includes the cards (with the adapted CV); B's export doesn't see A's.
    res = await call("GET", "/api/resume/export", "token-a");
    assert.equal(res.status, 200);
    assert.equal(res.data.applications.length, 2);
    const exported = res.data.applications.find((a: { id: string }) => a.id === jobId);
    assert.deepEqual(exported.facts, facts);
    assert.equal(exported.note, "Ronda 1 el martes");
    res = await call("GET", "/api/resume/export", "token-b");
    assert.equal(res.data.applications.length, 1);
    assert.ok(res.data.applications.every((a: { id: string }) => a.id !== jobId));

    // «Borrar todo» removes them.
    res = await call("DELETE", "/api/resume/data", "token-a");
    assert.equal(res.status, 200);
    assert.equal(res.data.deleted.applications, 2);
    assert.equal((await rows(USER_A)).length, 0);
    assert.equal((await rows(USER_B)).length, 1, "borrar todo de A no toca a B");

    // «Revocar» removes them.
    res = await call("POST", "/api/resume/consent", "token-b", { policyVersion: RESUME_POLICY_VERSION, revoke: true });
    assert.equal(res.status, 201);
    assert.equal((await rows(USER_B)).length, 0);

    // Turning «guardar en mi cuenta» off removes them too.
    assert.equal((await call("POST", "/api/resume/applications", "token-a", { job: { title: "Otra" } })).status, 201);
    assert.equal((await consent("token-a", false)).status, 201);
    assert.equal((await rows(USER_A)).length, 0);
    console.log("✅ [PASSED] Derechos: exportar incluye las postulaciones con su CV (solo las propias); borrar todo, revocar y quitar «guardar en mi cuenta» las borran.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch((error) => {
  console.error("❌ [FAILED]", error);
  process.exit(1);
});
