import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "child_process";
import { readFile } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../src/db/client.js";
import { insertFeedback, listPublishedOpinions } from "../src/db/site-feedback-repository.js";

// "Opiniones y ayuda" (schema.sql's site-feedback block,
// scripts/migrate-site-feedback.ts). The code ships before the table
// exists, so this suite starts without it, checks the 503 fallback, applies
// the block itself (twice: idempotent) and then drives the real API.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = Number(process.env.TEST_HTTP_PORT);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const MARK = "ZzFeedback";
const USER_A = "fee0b000-0000-4000-8000-00000000000a";
const USER_B = "fee0b000-0000-4000-8000-00000000000b";

async function waitForServer(server: ChildProcess, maxAttempts = 80, delayMs = 250): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (server.exitCode !== null) throw new Error(`El servidor de prueba terminó con código ${server.exitCode}.`);
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

async function readSchema(): Promise<string> {
  return readFile(path.join(__dirname, "..", "src", "db", "schema.sql"), "utf8");
}

async function readBlock(): Promise<string> {
  const block = /-- BEGIN site-feedback\r?\n([\s\S]*?)-- END site-feedback/.exec(await readSchema())?.[1];
  assert.ok(block, "schema.sql no contiene el bloque site-feedback");
  return block;
}

async function applyBlock(): Promise<void> {
  await pool.query(await readBlock());
}

// The isolated database has no `users` table (production does): create it
// from schema.sql's own definition, as validate-saved-jobs.ts does.
async function ensureUsersTable(): Promise<void> {
  const statement = /CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/.exec(await readSchema())?.[0];
  assert.ok(statement, "schema.sql no contiene la tabla users");
  await pool.query(statement);
}

function post(body: unknown, contentType = "application/json") {
  return fetch(`${BASE_URL}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": contentType, "User-Agent": `${MARK}-agent` },
    body: JSON.stringify(body)
  });
}

async function tableExists(): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'site_feedback'`);
  return (result.rowCount ?? 0) > 0;
}

async function main() {
  console.log("\n🧪 SUITE: opiniones y reportes (/opiniones)\n");
  if (await tableExists()) await pool.query(`DROP TABLE site_feedback`);

  const server = spawn(process.execPath, [...process.execArgv, path.join(__dirname, "..", "src", "server.ts")], {
    cwd: process.cwd(),
    shell: false,
    stdio: "inherit",
    env: { ...process.env, PORT: String(TEST_PORT) }
  });
  try {
    await waitForServer(server);

    // 1. Only POST, only JSON.
    assert.equal((await fetch(`${BASE_URL}/api/feedback`)).status, 405);
    assert.equal((await post({ kind: "problem", category: "otro" }, "text/plain")).status, 415);
    console.log("✅ [PASSED] Solo POST con JSON (405 / 415).");

    // 2. Before the migration: 503, nothing else breaks.
    const before = await post({ kind: "problem", category: "no-carga" });
    assert.equal(before.status, 503);
    assert.equal(before.headers.get("cache-control"), "private, no-store");
    console.log("✅ [PASSED] Sin tabla: 503 (la página ofrece el correo).");

    // 3. Production path: the table first existed WITHOUT accounts (PR #105)
    // and may hold anonymous opinions. Re-applying the block adds user_id
    // without touching them; it is idempotent and stays locked down.
    for (const role of ["anon", "authenticated"]) {
      await pool.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    }
    await ensureUsersTable();
    const block = await readBlock();
    await pool.query(block.slice(0, block.indexOf("-- 2026-11-03")));
    await pool.query(
      `INSERT INTO site_feedback (kind, category, message, rating, display_name, status, published_at)
       VALUES ('opinion', 'me-sirvio', $1, 5, 'Nombre inventado', 'published', NOW())`,
      [`${MARK} anónima vieja`]
    );
    await applyBlock();
    await applyBlock();
    assert.equal((await pool.query(`SELECT 1 FROM site_feedback WHERE message = $1`, [`${MARK} anónima vieja`])).rowCount, 1, "la fila vieja sigue ahí");
    const rls = await pool.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'site_feedback'`);
    assert.equal(rls.rows[0]?.relrowsecurity, true, "RLS debe estar activo");
    const grants = await pool.query(
      `SELECT 1 FROM information_schema.role_table_grants WHERE table_name = 'site_feedback' AND grantee IN ('anon', 'authenticated')`
    );
    assert.equal(grants.rowCount, 0, "anon/authenticated no deben tener permisos");
    console.log("✅ [PASSED] Bloque idempotente, RLS activo, 0 permisos públicos.");

    // 4. Reports stay open to everyone (stars ignored without an account);
    // opinions without a session are refused and not stored.
    assert.equal(
      (await post({ kind: "problem", category: "busqueda", message: `${MARK} no carga`, rating: 2, attachContext: true, pagePath: "/dashboard?search=secreto", search: "contador" })).status,
      201
    );
    const anonymous = await post({ kind: "opinion", category: "me-sirvio", message: `${MARK}: opinión sin cuenta`, consentPublish: true, rating: 5 });
    assert.equal(anonymous.status, 401);
    const report = await pool.query(
      `SELECT page_path, search_text, user_agent, status, rating, user_id FROM site_feedback WHERE message = $1`,
      [`${MARK} no carga`]
    );
    assert.deepEqual(report.rows[0], { page_path: "/dashboard", search_text: "contador", user_agent: `${MARK}-agent`, status: "pending", rating: null, user_id: null });
    assert.equal((await pool.query(`SELECT 1 FROM site_feedback WHERE message = $1`, [`${MARK}: opinión sin cuenta`])).rowCount, 0);
    console.log("✅ [PASSED] Reporte anónimo sin estrellas; opinión sin cuenta = 401 y no se guarda.");

    // 5. Its own rate limit: 5 POSTs per IP every 10 minutes.
    assert.equal((await post({ kind: "problem", category: "otro" })).status, 201);
    assert.equal((await post({ kind: "problem", category: "otro" })).status, 429);
    console.log("✅ [PASSED] Límite de envíos por IP (429).");

    // 6. With an account: one opinion per account, editing sends it back to
    // review, and the table itself refuses a new opinion without an account.
    for (const [id, email] of [[USER_A, "zzfeedback-a@example.test"], [USER_B, "zzfeedback-b@example.test"]]) {
      await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, email]);
    }
    const opinion = (message: string, rating: number, displayName: string) => ({
      kind: "opinion" as const,
      category: "me-sirvio",
      message,
      rating,
      displayName,
      city: null,
      pagePath: null,
      search: null
    });
    await insertFeedback(opinion(`${MARK}: primera versión`, 3, "Ana P."), null, USER_A);
    await insertFeedback(opinion(`${MARK}: <b>me ahorra tiempo</b>`, 5, "Ana P."), null, USER_A);
    const own = await pool.query(`SELECT message, rating, status FROM site_feedback WHERE user_id = $1 AND kind = 'opinion'`, [USER_A]);
    assert.deepEqual(own.rows, [{ message: `${MARK}: <b>me ahorra tiempo</b>`, rating: 5, status: "pending" }], "una sola opinión por cuenta");
    assert.deepEqual(await listPublishedOpinions(), [], "nada se publica solo");
    await pool.query(`UPDATE site_feedback SET status = 'published', published_at = NOW(), team_reply = 'Gracias.' WHERE user_id = $1`, [USER_A]);
    await insertFeedback(opinion(`${MARK}: <b>me ahorra tiempo</b>`, 5, "Ana P."), null, USER_A);
    const edited = await pool.query(`SELECT status, published_at, team_reply FROM site_feedback WHERE user_id = $1`, [USER_A]);
    assert.deepEqual(edited.rows[0], { status: "pending", published_at: null, team_reply: null }, "editar la vuelve a revisión");
    await pool.query(`UPDATE site_feedback SET status = 'published', published_at = NOW(), team_reply = 'Gracias.' WHERE user_id = $1`, [USER_A]);
    // A published 2-star opinion counts the same as a 5-star one (no gating).
    await insertFeedback(opinion(`${MARK}: pocas ofertas en mi ciudad`, 2, "Luis P."), null, USER_B);
    await pool.query(`UPDATE site_feedback SET status = 'published', published_at = NOW() - INTERVAL '1 day' WHERE user_id = $1`, [USER_B]);
    await assert.rejects(
      pool.query(`INSERT INTO site_feedback (kind, category, message, rating, display_name) VALUES ('opinion', 'me-sirvio', $1, 4, 'X')`, [`${MARK} sin cuenta`]),
      /check/i,
      "la tabla no acepta opiniones nuevas sin cuenta"
    );
    console.log("✅ [PASSED] Una opinión por cuenta; editar la vuelve a revisión; la tabla exige cuenta.");

    // 7. Only published opinions WITH an account are public (the old
    // anonymous one, though marked published, never shows), escaped.
    const page = await fetch(`${BASE_URL}/opiniones`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<link rel="canonical" href="https:\/\/buscotrabajo\.co\/opiniones" \/>/);
    assert.match(html, /<h1>Opiniones sobre BuscoTrabajo<\/h1>/);
    assert.match(html, /Lo que mejoramos/);
    assert.ok(html.includes("&lt;b&gt;me ahorra tiempo&lt;/b&gt;"), "el texto del usuario va escapado");
    assert.ok(!/noindex|AggregateRating/.test(html));
    assert.match(html, /Calificación promedio: 3,5 de 5, con 2 opiniones publicadas\./);
    assert.match(html, /5 de 5 estrellas · Me sirvió — .* Ana P\., cuenta registrada\./);
    assert.ok(!html.includes("Nombre inventado"), "las opiniones anónimas viejas nunca se publican");
    assert.ok(!html.includes(`${MARK} no carga`), "los reportes nunca son públicos");
    assert.equal((await fetch(`${BASE_URL}/ve/opiniones`)).status, 404);
    const api = await fetch(`${BASE_URL}/api/opinions`);
    assert.equal(api.headers.get("cache-control"), "public, max-age=300");
    const { opinions, summary } = (await api.json()) as {
      opinions: Array<{ displayName: string; teamReply: string | null; rating: number }>;
      summary: { count: number; average: number; distribution: number[] };
    };
    assert.deepEqual(opinions.map((o) => [o.displayName, o.teamReply, o.rating]), [["Ana P.", "Gracias.", 5], ["Luis P.", null, 2]]);
    assert.deepEqual(summary, { count: 2, average: 3.5, distribution: [1, 0, 0, 1, 0] });
    console.log("✅ [PASSED] /opiniones: solo opiniones con cuenta, promedio 3,5, texto escapado, reportes privados, /ve 404.");

    // 8. Deleting an account deletes its opinion (Ley 1581).
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER_B]);
    assert.equal((await pool.query(`SELECT 1 FROM site_feedback WHERE message = $1`, [`${MARK}: pocas ofertas en mi ciudad`])).rowCount, 0);
    assert.deepEqual((await listPublishedOpinions()).map((o) => o.displayName), ["Ana P."]);
    console.log("✅ [PASSED] Borrar la cuenta borra su opinión.");

    // 9. The production migration script itself (dry-run, then a re-run).
    for (const args of [["--dry-run"], []]) {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, path.join(__dirname, "..", "scripts", "migrate-site-feedback.ts"), ...args], {
          cwd: process.cwd(),
          shell: false,
          env: process.env
        });
        let text = "";
        child.stdout?.on("data", (chunk) => (text += chunk));
        child.stderr?.on("data", (chunk) => (text += chunk));
        child.on("exit", (code) => (code === 0 ? resolve(text) : reject(new Error(`migrate-site-feedback ${args.join(" ")} salió con ${code}: ${text}`))));
      });
      assert.match(output, args.length ? /--dry-run: no se escribió nada\. site_feedback ya existe/ : /OK — site_feedback lista; RLS activo/);
    }
    console.log("✅ [PASSED] scripts/migrate-site-feedback.ts: dry-run no escribe y re-ejecutar es seguro.");

    console.log("\n🎉 [TEST SUITE PASSED] Opiniones y reportes verificados.\n");
  } finally {
    server.kill("SIGTERM");
    await pool.query(`DELETE FROM site_feedback WHERE message LIKE $1`, [`${MARK}%`]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER_A, USER_B]]).catch(() => {});
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("❌ [FAILED]", err?.stack || err?.message || err);
    process.exit(1);
  }
);
