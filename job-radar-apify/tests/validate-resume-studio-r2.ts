import "./require-isolated-database.js";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/client.js";
import type { VerifiedSession } from "../src/auth/verify-session.js";
import { computeUrlHash, saveJobs } from "../src/db/job-repository.js";
import { getCachedSnapshot, putCachedSnapshot } from "../src/db/resume-studio-job-repository.js";
import { CONSENT_ITEMS, RESUME_POLICY_VERSION } from "../src/lib/resume-studio.js";
import { buildSnapshot } from "../src/resume-studio/job-link/job-snapshot.js";
import { canonicalizeJobUrl, urlKey } from "../src/resume-studio/job-link/link-kind.js";
import { handleResumeRoute } from "../src/server/routes/resume.js";
import type { Job } from "../src/sources/types.js";
import { makeDocx, makePdf, multipartBody } from "./fixtures/resume-files.js";

// AI Resume Studio R2 (doc 06 §5, doc 11 §5.3) against the disposable
// PostgreSQL: CV upload over HTTP, vacancy links resolved from OUR base (no
// outside request is made here: every URL used is either ours or already in
// `jobs`), the shared 24 h cache, the paste path and T-DEL with the new
// table. Synthetic data only.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_HTTP_PORT);
const BASE = `http://127.0.0.1:${PORT}`;
const USER_A = "4e520000-0000-4000-8000-00000000000a";
const USER_N = "4e520000-0000-4000-8000-00000000000e"; // never consents
const TOKENS: Record<string, string> = { "token-a": USER_A, "token-n": USER_N };
const JOB_URL = "https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-analista-rs2-test-ABC123";

function session(id: string): VerifiedSession {
  return { id, email: `${id}@example.test`, name: null, tier: "free", subscriptionEnd: null, preferredRoles: null, authCreatedAt: null };
}

async function schema(): Promise<string> {
  return readFile(path.join(__dirname, "..", "src", "db", "schema.sql"), "utf8");
}

async function call(method: string, url: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const isBuffer = Buffer.isBuffer(body);
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !isBuffer ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: body === undefined ? undefined : isBuffer ? new Uint8Array(body as Buffer) : JSON.stringify(body)
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

const BOUNDARY = "----rs2-integration";
const upload = (token: string | undefined, file: Buffer) =>
  call("POST", "/api/resume/import", token, multipartBody(file, BOUNDARY), { "Content-Type": `multipart/form-data; boundary=${BOUNDARY}` });

async function main() {
  console.log("\n🧪 SUITE: Resume Studio R2 (subir CV, links de vacantes, caché)\n");

  for (const role of ["anon", "authenticated"]) {
    await pool.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  }
  const text = await schema();
  const users = /CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/.exec(text)?.[0];
  const block = /-- BEGIN resume-studio\r?\n([\s\S]*?)-- END resume-studio/.exec(text)?.[1];
  assert.ok(users && block);

  // Without the table (migration not applied yet) the cache is simply
  // absent: no error, no write. The R1 suite may have applied the block
  // already in this database, so the check runs only when it's missing.
  await pool.query(users);
  const tableExists = (await pool.query(`SELECT to_regclass('public.rs_job_snapshot_cache') AS t`)).rows[0].t !== null;
  const early = buildSnapshot({ title: "Prueba", description: "Descripción de prueba suficiente." }, { via: "jsonld", sourceUrl: null, canonicalUrl: "https://x.example/1" });
  assert.ok(early);
  if (!tableExists) {
    await putCachedSnapshot(urlKey("https://x.example/1"), early);
    assert.equal(await getCachedSnapshot(urlKey("https://x.example/1")), null);
  }
  await pool.query(block);
  await pool.query(block);
  // Expired rows are never served, and pasted snapshots are refused outright.
  await putCachedSnapshot(urlKey("https://x.example/1"), early, new Date(Date.now() - 25 * 3600000));
  assert.equal(await getCachedSnapshot(urlKey("https://x.example/1")), null, "más de 24 h = no se sirve");
  const pasted = { ...early, via: "pasted" as const };
  await assert.rejects(putCachedSnapshot(urlKey("https://x.example/2"), pasted));
  console.log("✅ [PASSED] Caché: sin tabla no falla; bloque idempotente; > 24 h no se sirve; lo pegado se rechaza.");

  for (const id of [USER_A, USER_N]) {
    await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, `${id}@example.test`]);
  }
  const job: Job = {
    jobId: "rs2-test-job",
    title: "Analista de datos RS2",
    company: "Logística Sintética S.A.S.",
    location: "Bogotá, Colombia",
    url: JOB_URL,
    dateText: "Hace 3 días",
    source: "Computrabajo",
    publishedAt: new Date(Date.now() - 3 * 24 * 3600000).toISOString(),
    description: "Buscamos analista de datos con experiencia en SQL y Power BI para reportes de operación logística en Bogotá.",
    requirements: ["SQL intermedio", "Power BI"]
  } as Job;
  await saveJobs([job]);
  const stored = await pool.query<{ id: string }>(`SELECT id FROM jobs WHERE url_hash = $1`, [computeUrlHash(JOB_URL)]);
  const jobId = stored.rows[0]?.id;
  assert.ok(jobId, "la vacante sintética quedó guardada");

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
    // 1. T-ANON and consent for the upload.
    for (const route of ["/api/resume/import", "/api/resume/job-link", "/api/resume/job-link/paste"]) {
      assert.equal((await call("POST", route, undefined, {})).status, 401, `${route} sin sesión`);
    }
    assert.equal((await upload("token-n", makePdf())).data.code, "consent_required");
    const consent = await call("POST", "/api/resume/consent", "token-a", {
      policyVersion: RESUME_POLICY_VERSION,
      decisions: Object.fromEntries(CONSENT_ITEMS.map((item) => [item.purpose, item.purpose !== "cloud_storage"]))
    });
    assert.equal(consent.status, 201);
    console.log("✅ [PASSED] T-ANON 401; subir exige las autorizaciones obligatorias (no la de guardar).");

    // 2. Upload over HTTP: text back, nothing stored, rejections with clear messages.
    const cvRows = async () => Number((await pool.query(`SELECT COUNT(*) AS n FROM rs_resumes WHERE user_id = $1`, [USER_A])).rows[0].n);
    let res = await upload("token-a", makePdf());
    assert.equal(res.status, 200);
    assert.equal(res.data.kind, "pdf");
    assert.equal(res.data.untrusted, true);
    assert.match(res.data.text, /Analista de datos/);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    res = await upload("token-a", makeDocx());
    assert.equal(res.status, 200);
    assert.equal(res.data.kind, "docx");
    assert.equal(await cvRows(), 0, "subir no guarda nada");
    res = await upload("token-a", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]));
    assert.equal(res.status, 415);
    assert.match(res.data.error, /pegar el texto|pega el texto/i);
    res = await upload("token-a", makePdf({ pages: [[]] }));
    assert.equal(res.status, 422);
    assert.equal(res.data.code, "no_text");
    // Over 2 MB the server answers 413 and closes the socket without reading
    // the rest, so a client still uploading may see the reset instead of the
    // 413 (the page checks the size before sending). Either way: not read.
    const oversized = await upload("token-a", Buffer.concat([makePdf(), Buffer.alloc(3 * 1024 * 1024, 0x20)])).catch((error: Error) => ({
      status: /ECONNRESET|EPIPE|fetch failed/.test(`${error.message} ${String((error as { cause?: unknown }).cause)}`) ? 413 : 0,
      headers: new Headers(),
      data: null
    }));
    assert.equal(oversized.status, 413);
    assert.equal((await call("POST", "/api/resume/job-link", "token-a", { url: "" })).status, 400, "el servidor sigue vivo tras el corte");
    res = await call("POST", "/api/resume/import", "token-a", { file: "x" });
    assert.equal(res.status, 415, "JSON no es un archivo");
    console.log("✅ [PASSED] Subida: texto de PDF y DOCX, nada guardado; .exe 415, escaneado 422, > 2 MB 413.");

    // 3. Our own job page and a URL we already have: resolved from our base.
    res = await call("POST", "/api/resume/job-link", "token-a", { url: `https://buscotrabajo.co/empleos/${jobId}/analista` });
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "resolved");
    assert.equal(res.data.snapshot.via, "buscotrabajo");
    assert.equal(res.data.snapshot.untrusted, true);
    assert.equal(res.data.snapshot.title, "Analista de datos RS2");
    assert.match(res.data.snapshot.description, /Requisitos:\n- SQL intermedio/);
    assert.equal(res.data.snapshot.salary, null, "sin unidad, el salario no se inventa");
    res = await call("POST", "/api/resume/job-link", "token-a", { url: `${JOB_URL}?utm_source=whatsapp` });
    assert.equal(res.data.status, "resolved");
    assert.equal(res.data.snapshot.via, "our_index");
    assert.equal(res.data.cached, false);
    const key = urlKey(canonicalizeJobUrl(JOB_URL)!);
    assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM rs_job_snapshot_cache WHERE url_key = $1`, [key])).rows[0].n), 1);
    res = await call("POST", "/api/resume/job-link", "token-a", { url: JOB_URL });
    assert.equal(res.data.cached, true, "segunda lectura desde la caché de 24 h");
    const cacheRow = await pool.query(`SELECT * FROM rs_job_snapshot_cache WHERE url_key = $1`, [key]);
    assert.ok(!Object.keys(cacheRow.rows[0]).includes("user_id"), "la caché no guarda usuarios");
    const ttlHours = (new Date(cacheRow.rows[0].expires_at).getTime() - new Date(cacheRow.rows[0].fetched_at).getTime()) / 3600000;
    assert.equal(Math.round(ttlHours), 24);
    console.log("✅ [PASSED] Link de BuscoTrabajo y de una vacante ya guardada: desde nuestra base, sin pedir nada afuera; caché 24 h sin usuario.");

    // 4. LinkedIn: nothing fetched, paste screen; paste finds the same vacancy.
    res = await call("POST", "/api/resume/job-link", "token-a", { url: "https://www.linkedin.com/jobs/view/4100000000/" });
    assert.deepEqual(
      { status: res.data.status, reason: res.data.reason },
      { status: "paste_required", reason: "linkedin" }
    );
    const pasteText = "Buscamos analista de datos con experiencia en SQL y Power BI. Ofrecemos contrato indefinido y horario de oficina.";
    res = await call("POST", "/api/resume/job-link/paste", "token-a", {
      url: "https://www.linkedin.com/jobs/view/4100000000/",
      title: "  analista de datos rs2 ",
      company: "LOGÍSTICA SINTÉTICA S.A.S.",
      text: pasteText
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.matched, true, "misma vacante por empresa + cargo");
    assert.equal(res.data.snapshot.sourceUrl, "https://www.linkedin.com/jobs/view/4100000000/");
    // R4d: coverage is counted per (day, host, outcome) — no user, no path, no text.
    await new Promise((r) => setTimeout(r, 200));
    const coverage = await pool.query(`SELECT host, outcome, hits FROM rs_job_link_outcomes ORDER BY host, outcome`);
    const got = new Map(coverage.rows.map((r: { host: string; outcome: string; hits: number }) => [`${r.host} ${r.outcome}`, Number(r.hits)]));
    assert.equal(got.get("linkedin.com paste_linkedin"), 1);
    assert.equal(got.get("linkedin.com pasted"), 1, "the paste that followed is counted too");
    assert.equal(got.get("buscotrabajo.co resolved_buscotrabajo"), 1);
    assert.equal(got.get("co.computrabajo.com resolved_our_index"), 1);
    assert.equal(got.get("co.computrabajo.com resolved_cache"), 1);
    assert.deepEqual(Object.keys(coverage.rows[0]).sort(), ["hits", "host", "outcome"]);
    const columns = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'rs_job_link_outcomes' ORDER BY column_name`);
    assert.deepEqual(columns.rows.map((r: { column_name: string }) => r.column_name), ["day", "hits", "host", "outcome"], "no user_id, no URL, no text");
    assert.ok(coverage.rows.every((r: { host: string }) => !r.host.includes("/")), "host only, never the path");
    console.log("✅ [PASSED] Cobertura de links: agregada por día, sitio y resultado; sin usuario, ruta ni texto.");
    res = await call("POST", "/api/resume/job-link/paste", "token-a", { title: "Mesero", company: "Restaurante Sintético", text: pasteText });
    assert.equal(res.data.matched, false);
    assert.equal(res.data.snapshot.via, "pasted");
    const pastedInCache = await pool.query(`SELECT 1 FROM rs_job_snapshot_cache WHERE via = 'pasted' OR snapshot_json::text LIKE '%Ofrecemos contrato indefinido%'`);
    assert.equal(pastedInCache.rowCount, 0, "el texto pegado nunca llega a la caché compartida");
    res = await call("POST", "/api/resume/job-link/paste", "token-a", { title: "", text: pasteText });
    assert.equal(res.status, 400);
    console.log("✅ [PASSED] LinkedIn → pegar (sin descarga); misma vacante encontrada en nuestra base; lo pegado no se cachea.");

    // 5. Links that must never be fetched.
    for (const url of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://localhost:5432/", "file:///etc/passwd"]) {
      res = await call("POST", "/api/resume/job-link", "token-a", { url });
      assert.equal(res.status, 400, url);
      assert.equal(res.data.status, "invalid", url);
    }
    console.log("✅ [PASSED] Links internos o no públicos → 400 sin ninguna petición.");

    // 6. T-DEL keeps holding: «borrar todo» doesn't need to touch the shared cache (it has no user data).
    res = await call("DELETE", "/api/resume/data", "token-a");
    assert.equal(res.status, 200);
    console.log("✅ [PASSED] T-DEL sigue igual; la caché compartida no tiene datos del usuario.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
  console.log("\nResume Studio R2: OK.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
