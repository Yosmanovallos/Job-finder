import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/client.js";
import type { VerifiedSession } from "../src/auth/verify-session.js";
import { handleResumeRoute } from "../src/server/routes/resume.js";
import {
  createResume,
  getResume,
  listResumeVersions,
  updateResume,
  ResumeStudioUnavailableError
} from "../src/db/resume-studio-repository.js";
import { CONSENT_ITEMS, RESUME_POLICY_VERSION, RESUME_VERSIONS_KEPT, emptyResumeFacts, type ResumeInput } from "../src/lib/resume-studio.js";

// AI Resume Studio R1 (ADR 0017; doc 09 §5 T-IDOR, T-DEL). Runs the real
// route handler and repository against the disposable PostgreSQL. A real
// Supabase session can't exist here, so the handler gets a session resolver
// that maps two synthetic bearer tokens to two synthetic users; everything
// after that (consent checks, user_id filters, SQL) is the production code.
// Synthetic data only: no real names, emails or phones.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_HTTP_PORT);
const BASE = `http://127.0.0.1:${PORT}`;
const USER_A = "4e500000-0000-4000-8000-00000000000a";
const USER_B = "4e500000-0000-4000-8000-00000000000b";
const TOKENS: Record<string, string> = { "token-a": USER_A, "token-b": USER_B };

function session(id: string): VerifiedSession {
  return { id, email: `${id}@example.test`, name: null, tier: "free", subscriptionEnd: null, preferredRoles: null, authCreatedAt: null };
}

async function readSchema(): Promise<string> {
  return readFile(path.join(__dirname, "..", "src", "db", "schema.sql"), "utf8");
}

async function applyBlock(): Promise<void> {
  const block = /-- BEGIN resume-studio\r?\n([\s\S]*?)-- END resume-studio/.exec(await readSchema())?.[1];
  assert.ok(block, "schema.sql no contiene el bloque resume-studio");
  await pool.query(block);
}

function sampleInput(name: string, role = "Auxiliar contable"): ResumeInput {
  const facts = emptyResumeFacts();
  facts.basics = { fullName: name, headline: role, email: "persona@example.test", phone: "+57 300 000 0000", city: "Bogotá", links: [] };
  facts.summary = "Perfil sintético de prueba.";
  facts.experience = [
    {
      id: "exp-1",
      source: "user",
      sourceSpan: null,
      role,
      company: "Empresa Ficticia S.A.S.",
      city: "Bogotá",
      startDate: "2022-01",
      endDate: "",
      current: true,
      bullets: [{ id: "b-1", source: "user", sourceSpan: null, text: "Conciliaciones bancarias mensuales." }]
    }
  ];
  facts.skills = [{ id: "sk-1", source: "user", sourceSpan: null, name: "Excel" }];
  return { title: "Mi hoja de vida", templateId: "clasica", facts };
}

async function call(method: string, url: string, token?: string, body?: unknown, contentType = "application/json") {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": contentType } : {})
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, headers: res.headers, data };
}

const count = async (sql: string, params: unknown[]) => Number((await pool.query<{ n: string }>(sql, params)).rows[0].n);

async function main() {
  console.log("\n🧪 SUITE: Resume Studio R1 (rs_*, autorización, versiones, T-IDOR, T-DEL)\n");

  // Before the migration, the repository reports "unavailable" (the API's 503).
  await assert.rejects(getResume(USER_A, USER_A), ResumeStudioUnavailableError);
  console.log("✅ [PASSED] Sin tablas: ResumeStudioUnavailableError (503).");

  // 1. Additive block: idempotent, RLS on, no public grants, insert-only consents.
  for (const role of ["anon", "authenticated"]) {
    await pool.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  }
  const users = /CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/.exec(await readSchema())?.[0];
  assert.ok(users, "schema.sql no contiene la tabla users");
  await pool.query(users);
  await applyBlock();
  await applyBlock();
  for (const table of ["rs_consents", "rs_resumes", "rs_resume_versions"]) {
    const rls = await pool.query(`SELECT relrowsecurity FROM pg_class WHERE relname = $1`, [table]);
    assert.equal(rls.rows[0]?.relrowsecurity, true, `RLS debe estar activo en ${table}`);
    const grants = await pool.query(
      `SELECT 1 FROM information_schema.role_table_grants WHERE table_name = $1 AND grantee IN ('anon', 'authenticated')`,
      [table]
    );
    assert.equal(grants.rowCount, 0, `${table}: anon/authenticated sin permisos`);
  }
  for (const [id, email] of [[USER_A, "rs-a@example.test"], [USER_B, "rs-b@example.test"]]) {
    await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, email]);
  }
  console.log("✅ [PASSED] Bloque idempotente; RLS activo y 0 permisos públicos en las 3 tablas.");

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
    // 2. Page shell and anonymous API.
    const page = await call("GET", "/hoja-de-vida");
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(page.headers.get("cache-control"), "private, no-store");
    for (const [method, url] of [
      ["GET", "/api/resume/consent"],
      ["GET", "/api/resume/resumes"],
      ["POST", "/api/resume/resumes"],
      ["GET", "/api/resume/export"],
      ["DELETE", "/api/resume/data"]
    ] as const) {
      const res = await call(method, url, undefined, method === "POST" ? {} : undefined);
      assert.equal(res.status, 401, `${method} ${url} sin sesión debe ser 401`);
      assert.equal(res.headers.get("cache-control"), "private, no-store");
    }
    console.log("✅ [PASSED] Página noindex/no-store; API sin sesión = 401.");

    // 3. Consent: required boxes, policy version, insert-only, hash of the text.
    let res = await call("POST", "/api/resume/resumes", "token-a", sampleInput("Persona A"));
    assert.equal(res.status, 403);
    assert.equal(res.data.code, "consent_required");
    res = await call("POST", "/api/resume/consent", "token-a", {
      policyVersion: RESUME_POLICY_VERSION,
      decisions: { cv_processing: true, terms: false, cloud_storage: true }
    });
    assert.equal(res.status, 400, "sin una obligatoria debe ser 400");
    res = await call("POST", "/api/resume/consent", "token-a", {
      policyVersion: "v1999-01",
      decisions: { cv_processing: true, terms: true, cloud_storage: true }
    });
    assert.equal(res.status, 409, "versión desconocida de la política debe ser 409");
    res = await call("POST", "/api/resume/consent", "token-a", {
      policyVersion: RESUME_POLICY_VERSION,
      decisions: { cv_processing: true, terms: true, cloud_storage: false }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.required, true);
    assert.equal(res.data.storage, false);
    res = await call("POST", "/api/resume/resumes", "token-a", sampleInput("Persona A"));
    assert.equal(res.status, 403);
    assert.equal(res.data.code, "storage_consent_required", "sin la casilla opcional no se guarda en el servidor");
    res = await call("POST", "/api/resume/consent", "token-a", {
      policyVersion: RESUME_POLICY_VERSION,
      decisions: { cv_processing: true, terms: true, cloud_storage: true }
    });
    assert.equal(res.data.storage, true);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM rs_consents WHERE user_id = $1`, [USER_A]), 6, "revocar/cambiar = filas nuevas");
    const hashes = await pool.query<{ purpose: string; text_hash: string }>(
      `SELECT DISTINCT purpose, text_hash FROM rs_consents WHERE user_id = $1`,
      [USER_A]
    );
    for (const row of hashes.rows) {
      const item = CONSENT_ITEMS.find((i) => i.purpose === row.purpose)!;
      assert.equal(row.text_hash, createHash("sha256").update(item.text, "utf8").digest("hex"));
    }
    await assert.rejects(pool.query(`UPDATE rs_consents SET granted = TRUE WHERE user_id = $1`, [USER_A]), /solo de inserción/);
    await assert.rejects(pool.query(`DELETE FROM rs_consents WHERE user_id = $1`, [USER_A]), /solo de inserción/);
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'rs_consents'`
    );
    assert.ok(!columns.rows.some((c) => /ip|agent/.test(c.column_name)), "rs_consents no guarda IP ni user agent");
    console.log("✅ [PASSED] Autorización: 2 obligatorias + 1 opcional, versión y hash del texto, solo inserción.");

    // 4. Validation, body limits, one base resume.
    res = await call("POST", "/api/resume/resumes", "token-a", {
      ...sampleInput("Persona A"),
      facts: { ...sampleInput("Persona A").facts, basics: { ...sampleInput("Persona A").facts.basics, photo: "data:x", cedula: "123" } }
    });
    assert.equal(res.status, 400, "campos no previstos (foto, cédula) se rechazan");
    assert.ok(!JSON.stringify(res.data).includes("123"), "los errores no devuelven valores enviados");
    res = await call("POST", "/api/resume/resumes", "token-a", "x".repeat(70 * 1024));
    assert.equal(res.status, 413);
    res = await call("POST", "/api/resume/resumes", "token-a", JSON.stringify(sampleInput("Persona A")), "text/plain");
    assert.equal(res.status, 415);
    res = await call("POST", "/api/resume/resumes", "token-a", sampleInput("Persona A"));
    assert.equal(res.status, 201);
    const resumeA = res.data.resume;
    assert.equal(resumeA.versionNo, 1);
    res = await call("POST", "/api/resume/resumes", "token-a", sampleInput("Persona A"));
    assert.equal(res.status, 409, "una sola hoja de vida base por usuario");
    console.log("✅ [PASSED] Esquema estricto, 413/415, una base por usuario.");

    // 5. Versions, optimistic concurrency, undo and restore as new versions.
    res = await call("PUT", `/api/resume/resumes/${resumeA.id}`, "token-a", { ...sampleInput("Persona A", "Analista contable"), expectedVersion: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.data.resume.versionNo, 2);
    res = await call("PUT", `/api/resume/resumes/${resumeA.id}`, "token-a", { ...sampleInput("Persona A", "Otro"), expectedVersion: 1 });
    assert.equal(res.status, 409);
    assert.equal(res.data.code, "version_conflict");
    res = await call("POST", `/api/resume/resumes/${resumeA.id}/undo`, "token-a", { expectedVersion: 2 });
    assert.equal(res.status, 200);
    assert.equal(res.data.resume.versionNo, 3);
    assert.equal(res.data.resume.facts.basics.headline, "Auxiliar contable", "deshacer vuelve al contenido de v1");
    res = await call("POST", `/api/resume/resumes/${resumeA.id}/restore`, "token-a", { versionNo: 2 });
    assert.equal(res.data.resume.versionNo, 4);
    assert.equal(res.data.resume.facts.basics.headline, "Analista contable");
    res = await call("GET", `/api/resume/resumes/${resumeA.id}/versions`, "token-a");
    assert.deepEqual(res.data.versions.map((v: { versionNo: number }) => v.versionNo), [4, 3, 2, 1]);
    console.log("✅ [PASSED] Versiones, conflicto 409, deshacer y restaurar sin reescribir historia.");

    // 6. T-IDOR-1..4: user B reads, edits, versions/undo/restores, deletes and exports A's CV → 404 / nothing.
    await call("POST", "/api/resume/consent", "token-b", {
      policyVersion: RESUME_POLICY_VERSION,
      decisions: { cv_processing: true, terms: true, cloud_storage: true }
    });
    const idor: [string, string, unknown?][] = [
      ["GET", `/api/resume/resumes/${resumeA.id}`],
      ["PUT", `/api/resume/resumes/${resumeA.id}`, { ...sampleInput("Intruso"), expectedVersion: 4 }],
      ["GET", `/api/resume/resumes/${resumeA.id}/versions`],
      ["POST", `/api/resume/resumes/${resumeA.id}/undo`, {}],
      ["POST", `/api/resume/resumes/${resumeA.id}/restore`, { versionNo: 1 }],
      ["DELETE", `/api/resume/resumes/${resumeA.id}`]
    ];
    for (const [method, url, body] of idor) {
      const attempt = await call(method, url, "token-b", body);
      assert.equal(attempt.status, 404, `T-IDOR: B ${method} ${url} debe ser 404`);
      assert.ok(!JSON.stringify(attempt.data).includes("Persona A"), "la respuesta no filtra datos de A");
    }
    res = await call("GET", "/api/resume/resumes", "token-b");
    assert.deepEqual(res.data.resumes, []);
    res = await call("GET", "/api/resume/export", "token-b");
    assert.equal(res.data.resumes.length, 0);
    assert.ok(!JSON.stringify(res.data).includes("Persona A"), "T-IDOR: la exportación de B no contiene datos de A");
    res = await call("GET", "/api/resume/resumes/not-a-uuid", "token-a");
    assert.equal(res.status, 404);
    const afterIdor = await getResume(USER_A, resumeA.id);
    assert.equal(afterIdor?.versionNo, 4, "el CV de A no cambió");
    assert.equal(afterIdor?.facts.basics.fullName, "Persona A");
    assert.equal(await getResume(USER_B, resumeA.id), null, "repositorio: B no ve el CV de A");
    assert.equal(await updateResume(USER_B, resumeA.id, 4, sampleInput("Intruso")), null);
    assert.equal(await listResumeVersions(USER_B, resumeA.id), null);
    console.log("✅ [PASSED] T-IDOR: B no lee, edita, restaura, borra ni exporta el CV de A (404).");

    // 7. Export of the holder's own data.
    res = await call("GET", "/api/resume/export", "token-a");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition") || "", /attachment/);
    assert.equal(res.data.resumes.length, 1);
    assert.equal(res.data.resumes[0].versions.length, 4);
    assert.equal(res.data.consents.length, 6);
    console.log("✅ [PASSED] Exportar JSON: CV, versiones y constancias del titular.");

    // 8. Version pruning (repository directly: the HTTP write limit is per user).
    const pruneUser = "4e500000-0000-4000-8000-00000000000c";
    await pool.query(`INSERT INTO users (id, email) VALUES ($1, 'rs-c@example.test') ON CONFLICT (id) DO NOTHING`, [pruneUser]);
    const pruned = await createResume(pruneUser, sampleInput("Persona C"));
    for (let version = 1; version <= RESUME_VERSIONS_KEPT + 5; version++) {
      await updateResume(pruneUser, pruned.id, version, sampleInput("Persona C", `Cargo ${version}`));
    }
    const kept = await listResumeVersions(pruneUser, pruned.id);
    assert.equal(kept?.length, RESUME_VERSIONS_KEPT, `máximo ${RESUME_VERSIONS_KEPT} versiones`);
    assert.equal(kept?.[0].versionNo, RESUME_VERSIONS_KEPT + 6);
    console.log(`✅ [PASSED] Se conservan las últimas ${RESUME_VERSIONS_KEPT} versiones.`);

    // 9. T-DEL: «borrar todo» leaves 0 resume rows for A, keeps A's consents and B's data.
    res = await call("POST", "/api/resume/resumes", "token-b", sampleInput("Persona B"));
    assert.equal(res.status, 201);
    const resumeB = res.data.resume;
    res = await call("DELETE", "/api/resume/data", "token-a");
    assert.equal(res.status, 200);
    assert.equal(res.data.deleted.resumes, 1);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM rs_resumes WHERE user_id = $1`, [USER_A]), 0);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM rs_resume_versions WHERE user_id = $1`, [USER_A]), 0);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM rs_resume_versions WHERE resume_id = $1`, [resumeA.id]), 0);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM rs_consents WHERE user_id = $1`, [USER_A]), 6, "las constancias se conservan");
    assert.equal((await getResume(USER_B, resumeB.id))?.facts.basics.fullName, "Persona B", "los datos de B siguen intactos");
    res = await call("DELETE", `/api/resume/resumes/${resumeB.id}`, "token-b");
    assert.equal(res.status, 204);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM rs_resume_versions WHERE resume_id = $1`, [resumeB.id]), 0, "las versiones se borran con su CV");
    // Deleting the account (users row) removes its resumes too; consents stay.
    await pool.query(`DELETE FROM users WHERE id = $1`, [pruneUser]);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM rs_resumes WHERE user_id = $1`, [pruneUser]), 0);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM rs_resume_versions WHERE user_id = $1`, [pruneUser]), 0);
    console.log("✅ [PASSED] T-DEL: borrar todo = 0 filas de CV y versiones; constancias y datos ajenos intactos.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
  console.log("\nResume Studio R1: OK.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
