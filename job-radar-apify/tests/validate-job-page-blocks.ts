/**
 * Job page blocks B1-B3 against a real server and a disposable PostgreSQL
 * (openspec/changes/job-page-differentiation, JPD-002/003/004/005/008).
 *
 * The server runs in this process so every pool.query can be attributed to
 * the HTTP request that issued it (AsyncLocalStorage). JPD-008 pins the query
 * count per /empleos/:id response with warm caches to the numbers measured on
 * origin/main (109f392) before the change.
 */
import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { pool } from "../src/db/client.js";
import { queryCompanyJobsPage, saveJobs } from "../src/db/job-repository.js";
import { buildJobPath } from "../src/lib/job-seo.js";
import type { Job } from "../src/sources/types.js";

// Measured on origin/main 109f392 with this same harness (warm caches).
const BASELINE_QUERIES = { anonymous: 2, session: 2 };

const PORT = Number(process.env.TEST_HTTP_PORT);
const BASE = `http://127.0.0.1:${PORT}`;

// --- Per-request query attribution ------------------------------------------
const requestScope = new AsyncLocalStorage<{ queries: number }>();
const counts = new Map<string, { queries: number }>();
const originalEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function (this: http.Server, event: string, ...args: unknown[]) {
  if (event === "request") {
    const req = args[0] as http.IncomingMessage;
    const tag = req.headers["x-test-request"];
    if (typeof tag === "string") {
      const store = { queries: 0 };
      counts.set(tag, store);
      return requestScope.run(store, () => Reflect.apply(originalEmit, this, [event, ...args]));
    }
  }
  return Reflect.apply(originalEmit, this, [event, ...args]);
} as typeof http.Server.prototype.emit;
const originalQuery = pool.query.bind(pool);
(pool as { query: unknown }).query = (...args: unknown[]) => {
  const store = requestScope.getStore();
  if (store) store.queries++;
  return (originalQuery as (...a: unknown[]) => unknown)(...args);
};

// --- Supabase auth stub: the test URL is this loopback server's own port ------
const SESSION_TOKEN = "job-page-blocks-synthetic-token";
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/auth/v1/user")) {
    return new Response(
      JSON.stringify({ id: "00000000-0000-4000-8000-0000000000aa", aud: "authenticated", email: "blocks@example.invalid", user_metadata: {}, app_metadata: {} }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  return originalFetch(input, init);
}) as typeof fetch;

const RICH = "Buscamos analista para el equipo de riesgo crediticio.\nConstruirás tableros de cartera y reportes mensuales.";

function job(overrides: Partial<Job>): Job {
  return {
    jobId: "",
    title: "Analista",
    company: "Accenture Colombia",
    location: "Bogotá, D.C.",
    url: `https://example.com/blocks/${Math.random().toString(36).slice(2)}`,
    dateText: "Hoy",
    source: "LinkedIn",
    publishedAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
    country: "CO",
    description: RICH,
    ...overrides
  };
}

async function saveAll(jobs: Job[]): Promise<string[]> {
  const result = await saveJobs(jobs, "Blocks test");
  assert.equal(result.insertedJobs.length, jobs.length);
  return result.insertedJobs.map((row) => row.id);
}

let sequence = 0;
async function get(path: string, headers: Record<string, string> = {}): Promise<{ html: string; queries: number }> {
  const tag = `r${++sequence}`;
  const res = await fetch(`${BASE}${path}`, { headers: { "x-test-request": tag, ...headers } });
  assert.equal(res.status, 200, `${path} answered ${res.status}`);
  const html = await res.text();
  return { html, queries: counts.get(tag)?.queries ?? -1 };
}

const companyBlock = (html: string) => /<section data-company-jobs>[\s\S]*?<\/section>/.exec(html)?.[0] ?? null;
const ssrLinks = (html: string) => JSON.parse(/window\.__SSR_JOB_LINKS__=([\s\S]*?);<\/script>/.exec(html)![1]);

// The session branch reads users (getOrCreateUser); same schema statements as validate-saved-jobs.ts.
const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
await pool.query(/CREATE TABLE IF NOT EXISTS users \([\s\S]*?\r?\n\);/.exec(schema)![0]);
await pool.query(/ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_roles[^;]*;/.exec(schema)![0]);

// --- Fixtures -----------------------------------------------------------------
// One employer under two spellings (8 vacancies), a placeholder employer with
// several, and a company with a single vacancy.
const accenture = await saveAll([
  job({ title: "Analista de Riesgo" }),
  ...Array.from({ length: 7 }, (_, index) =>
    job({
      title: `Consultor ${index}`,
      company: index % 2 ? "ACCENTURE S.A.S." : "Accenture Colombia",
      location: index < 3 ? "Bogota, D.C., Capital District, Colombia" : "Medellín, Antioquia"
    })
  )
]);
const [confidential] = await saveAll([
  job({ title: "Auxiliar Contable", company: "Confidencial" }),
  job({ title: "Auxiliar de Bodega", company: "Confidencial" }),
  job({ title: "Asesor Comercial", company: "Confidencial" })
]);
const [single] = await saveAll([job({ title: "Jefe de Planta", company: "Lacteos Unicos del Norte" })]);
await pool.query(
  `INSERT INTO company_reputation (company_name, source, score, score_scale, review_count, source_url)
   VALUES ('Accenture', 'merco', 7.5, '0-10', NULL, 'https://merco.example.invalid/accenture')`
);
await pool.query(
  `INSERT INTO company_reputation_alias (raw_company_name, source, canonical_name) VALUES ('Accenture Colombia', 'merco', 'Accenture')`
);

process.env.PORT = String(PORT);
await import("../src/server.js");
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    if ((await originalFetch(`${BASE}/api/health`)).ok) break;
  } catch {
    // not listening yet
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function pathOf(id: string): Promise<string> {
  const row = (await pool.query(`SELECT id AS "jobId", title, location FROM jobs WHERE id = $1`, [id])).rows[0];
  return buildJobPath(row);
}

// Warm every cache the route reads, then wait for background loads to land.
async function warm(path: string): Promise<{ html: string; queries: number }> {
  for (let attempt = 0; attempt < 3; attempt++) await get(path);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return get(path);
}

try {
  const accenturePath = await pathOf(accenture[0]);

  // Cold first: nothing has asked for this employer yet.
  const cold = await get(accenturePath);

  // --- JPD-008: same number of queries per response with warm caches --------
  const anonymous = await warm(accenturePath);
  const auth = { Authorization: `Bearer ${SESSION_TOKEN}` };
  for (let attempt = 0; attempt < 3; attempt++) await get(accenturePath, auth);
  const sessionWarm = await get(accenturePath, auth);
  console.log(`[JPD-008] consultas por respuesta con caché caliente: anónimo ${anonymous.queries}, con sesión ${sessionWarm.queries}`);
  assert.ok(!sessionWarm.html.includes("window.__SSR_JOB__="), "the stubbed session really is a session");
  assert.equal(anonymous.queries, BASELINE_QUERIES.anonymous, "JPD-008 anonymous query count");
  assert.equal(sessionWarm.queries, BASELINE_QUERIES.session, "JPD-008 session query count");
  console.log("✅ [JPD-008] Mismas consultas por respuesta que origin/main, anónimo y con sesión.");

  // --- JPD-004: cold company cache → only the company link, no number -------
  const coldBlock = companyBlock(cold.html);
  assert.equal(
    coldBlock,
    `<section data-company-jobs><p><a href="/empresas/accenture-colombia">Ver las vacantes de Accenture Colombia</a></p></section>`,
    "JPD-004 cold page shows only the company link"
  );
  console.log("✅ [JPD-004] Caché fría: solo el enlace a la empresa, sin cifra; la carga va en segundo plano.");

  // --- JPD-002: warm B1 — other jobs, same city first, total = /empresas ----
  const warmBlock = companyBlock(anonymous.html);
  assert.ok(warmBlock, "JPD-002 B1 present");
  const { total } = await queryCompanyJobsPage("ACCENTURE S.A.S.", "CO", 1);
  assert.equal(total, 8, "both spellings are one employer");
  assert.ok(warmBlock.includes(`<a href="/empresas/accenture-colombia">Ver las ${total} vacantes de Accenture Colombia</a>`));
  const links = [...warmBlock.matchAll(/<li><a href="(\/empleos\/[^"]+)">[^<]*<\/a> — ([^<]*)<\/li>/g)];
  assert.equal(links.length, 6, "6 links");
  assert.ok(links.every(([, href]) => !href.includes(accenture[0])), "never itself");
  const bogota = links.map(([, , location]) => /bogot/i.test(location));
  assert.deepEqual(bogota, [true, true, true, false, false, false], "same city first");
  const companyPage = await get("/empresas/accenture-colombia");
  const companyPayload = JSON.parse(/window\.__SSR_COMPANY__=([\s\S]*?);<\/script>/.exec(companyPage.html)![1]);
  assert.equal(companyPayload.total, total, "B1 total matches the company page it links");
  assert.deepEqual(ssrLinks(anonymous.html).company.total, total, "same snapshot in the hydration payload");
  console.log("✅ [JPD-002] B1: 6 enlaces, misma ciudad primero, total igual al de /empresas.");

  // --- JPD-005: reputation in the raw HTML -----------------------------------
  assert.match(anonymous.html, /<section data-company-reputation>[\s\S]*Merco Talento: 7\.5 \(0-10\)[\s\S]*href="https:\/\/merco\.example\.invalid\/accenture"/);
  assert.ok(!sessionWarm.html.includes("data-company-reputation"), "no reputation query for sessions");
  console.log("✅ [JPD-005] Reputación en el HTML crudo para anónimos, sin consulta extra con sesión.");

  // --- JPD-003: placeholder and single-vacancy employers ---------------------
  const placeholder = await warm(await pathOf(confidential));
  assert.equal(companyBlock(placeholder.html), null, "placeholder: no B1");
  assert.equal(ssrLinks(placeholder.html).company, undefined);
  const lone = await warm(await pathOf(single));
  assert.equal(companyBlock(lone.html), null, "single vacancy: no B1");
  console.log("✅ [JPD-003] Sin B1 para «Confidencial» ni para la empresa de una sola vacante.");

  // --- JPD-009 on the served page: no template copy inside #app's new blocks --
  for (const html of [warmBlock, coldBlock!]) assert.ok(!/agregada de|BuscoTrabajo encontrar/i.test(html));
} finally {
  await pool.query(`DELETE FROM company_reputation_alias WHERE raw_company_name = 'Accenture Colombia'`);
  await pool.query(`DELETE FROM company_reputation WHERE company_name = 'Accenture'`);
}
process.exit(0);
