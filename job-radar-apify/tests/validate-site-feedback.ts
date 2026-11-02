import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "child_process";
import { readFile } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../src/db/client.js";
import { listPublishedOpinions } from "../src/db/site-feedback-repository.js";

// "Opiniones y ayuda" (schema.sql's site-feedback block,
// scripts/migrate-site-feedback.ts). The code ships before the table
// exists, so this suite starts without it, checks the 503 fallback, applies
// the block itself (twice: idempotent) and then drives the real API.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = Number(process.env.TEST_HTTP_PORT);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const MARK = "ZzFeedback";

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

async function applyBlock(): Promise<void> {
  const schema = await readFile(path.join(__dirname, "..", "src", "db", "schema.sql"), "utf8");
  const block = /-- BEGIN site-feedback\r?\n([\s\S]*?)-- END site-feedback/.exec(schema)?.[1];
  assert.ok(block, "schema.sql no contiene el bloque site-feedback");
  await pool.query(block);
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

    // 3. The block is idempotent and locked down like every other table.
    for (const role of ["anon", "authenticated"]) {
      await pool.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    }
    await applyBlock();
    await applyBlock();
    const rls = await pool.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'site_feedback'`);
    assert.equal(rls.rows[0]?.relrowsecurity, true, "RLS debe estar activo");
    const grants = await pool.query(
      `SELECT 1 FROM information_schema.role_table_grants WHERE table_name = 'site_feedback' AND grantee IN ('anon', 'authenticated')`
    );
    assert.equal(grants.rowCount, 0, "anon/authenticated no deben tener permisos");
    console.log("✅ [PASSED] Bloque idempotente, RLS activo, 0 permisos públicos.");

    // 4. A problem report with context; an opinion lands as pending.
    assert.equal(
      (await post({ kind: "problem", category: "busqueda", message: `${MARK} no carga`, attachContext: true, pagePath: "/dashboard?search=secreto", search: "contador" })).status,
      201
    );
    assert.equal(
      (await post({ kind: "opinion", category: "me-sirvio", message: `${MARK}: <b>me ahorra tiempo</b>`, displayName: "Ana M.", city: "Medellín", consentPublish: true })).status,
      201
    );
    const invalid = await post({ kind: "opinion", category: "me-sirvio", message: "Sin permiso para publicar", displayName: "Ana" });
    assert.equal(invalid.status, 400);
    const rows = await pool.query(
      `SELECT kind, page_path, search_text, user_agent, status FROM site_feedback WHERE message LIKE $1 ORDER BY kind DESC`,
      [`${MARK}%`]
    );
    assert.equal(rows.rowCount, 2);
    assert.deepEqual(rows.rows[0], { kind: "problem", page_path: "/dashboard", search_text: "contador", user_agent: `${MARK}-agent`, status: "pending" });
    assert.deepEqual(rows.rows[1], { kind: "opinion", page_path: null, search_text: null, user_agent: null, status: "pending" });
    console.log("✅ [PASSED] Reporte con contexto sin query; opinión pendiente; inválida = 400.");

    // 5. Its own rate limit: 5 POSTs per IP every 10 minutes.
    const limited = await post({ kind: "problem", category: "otro" });
    assert.equal(limited.status, 429);
    console.log("✅ [PASSED] Límite de envíos por IP (429).");

    // 6. Only published opinions are public, escaped in the server HTML.
    // Checked in the DB, not via the API: the server keeps a 5-minute copy.
    assert.deepEqual(await listPublishedOpinions(), [], "nada se publica solo");
    await pool.query(
      `UPDATE site_feedback SET status = 'published', published_at = NOW(), team_reply = 'Gracias.' WHERE kind = 'opinion' AND message LIKE $1`,
      [`${MARK}%`]
    );
    const page = await fetch(`${BASE_URL}/opiniones`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<link rel="canonical" href="https:\/\/buscotrabajo\.co\/opiniones" \/>/);
    assert.match(html, /<h1>Opiniones sobre BuscoTrabajo<\/h1>/);
    assert.match(html, /Lo que mejoramos/);
    assert.ok(html.includes("&lt;b&gt;me ahorra tiempo&lt;/b&gt;"), "el texto del usuario va escapado");
    assert.ok(!/noindex|AggregateRating/.test(html));
    assert.ok(!html.includes(`${MARK} no carga`), "los reportes nunca son públicos");
    assert.equal((await fetch(`${BASE_URL}/ve/opiniones`)).status, 404);
    const api = await fetch(`${BASE_URL}/api/opinions`);
    assert.equal(api.headers.get("cache-control"), "public, max-age=300");
    const { opinions } = (await api.json()) as { opinions: Array<{ displayName: string; teamReply: string | null }> };
    assert.deepEqual(opinions.map((o) => [o.displayName, o.teamReply]), [["Ana M.", "Gracias."]]);
    console.log("✅ [PASSED] /opiniones: HTML propio, opinión publicada escapada, reportes privados, /ve 404.");

    // 7. The production migration script itself (dry-run, then a re-run).
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
