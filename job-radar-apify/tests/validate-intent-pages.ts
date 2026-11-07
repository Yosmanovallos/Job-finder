// seo-intent-pages: SQL parity (SIP-011) and real HTTP checks of the intent
// pages (SIP-001 … SIP-041) against the isolated runner's disposable
// PostgreSQL. Inserts its own synthetic rows (never production: see
// require-isolated-database) and runs last in its suites.
import "./require-isolated-database.js";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { sqlSinExperiencia } from "../src/lib/job-experience.js";
import { renderIntentAnswerHtml } from "../src/lib/intent-pages.js";
import { SITE_URL } from "../src/lib/job-seo.js";
import { EXPERIENCE_CASES } from "./fixtures/experience-cases.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_HTTP_PORT);
// The runner only lets the test server listen on its assigned port, so the
// rollback server reuses it once the first one has exited.
const ROLLBACK_PORT = PORT;
let failures = 0;

function check(condition: boolean, passMsg: string, failMsg: string): void {
  if (condition) console.log(`✅ [PASSED] ${passMsg}`);
  else {
    console.error(`❌ [FAILED] ${failMsg}`);
    failures++;
  }
}

async function sqlParity(): Promise<void> {
  console.log("\n--- SIP-011: clasificador SQL = memoria ---\n");
  const predicate = sqlSinExperiencia("$1::text", "$2::text");
  let mismatches = 0;
  for (const c of EXPERIENCE_CASES) {
    const { rows } = await pool.query<{ hit: boolean }>(`SELECT ${predicate} AS hit`, [c.title, c.description]);
    if (rows[0].hit !== c.sinExperiencia) {
      mismatches++;
      console.error(`   SQL ≠ esperado en «${c.note}»: ${c.title} | ${c.description}`);
    }
  }
  check(mismatches === 0, `SQL y memoria coinciden en los ${EXPERIENCE_CASES.length} casos del fixture compartido.`, `${mismatches} casos difieren.`);
}

let seq = 0;
async function insertJob(row: {
  title: string;
  location: string;
  country: string | null;
  source?: string;
  company?: string;
  description?: string | null;
  seoReady?: boolean;
}): Promise<void> {
  seq++;
  await pool.query(
    `INSERT INTO jobs (url_hash, title, company, location, country, url, source, sources, published_at, description, seo_ready, is_active)
     VALUES (md5($1), $2, $3, $4, $5, $6, $7::text, jsonb_build_array($7::text), NOW() - INTERVAL '1 day' - ($8::int * INTERVAL '1 minute'), $9, $10, TRUE)`,
    [
      `sip-${seq}`,
      row.title,
      row.company ?? `Empresa SIP ${seq % 4}`,
      row.location,
      row.country,
      `https://example.com/sip/${seq}`,
      row.source ?? "LinkedIn",
      seq,
      row.description ?? null,
      row.seoReady ?? true
    ]
  );
}

async function seed(): Promise<void> {
  for (let i = 0; i < 12; i++) await insertJob({ title: `Desarrollador remoto SIP ${i}`, location: "Caracas, Venezuela", country: "VE" });
  for (let i = 0; i < 11; i++) await insertJob({ title: `Analista (Remoto) SIP ${i}`, location: "Medellín, Colombia", country: "CO" });
  await insertJob({ title: "Diseño remoto de logo SIP Workana", location: "México", country: "CO", source: "Workana" });
  for (let i = 0; i < 10; i++) await insertJob({ title: `Asesor sin experiencia SIP ${i}`, location: "Bogotá, Colombia", country: "CO" });
  await insertJob({ title: "Cajero sin experiencia SIP no apto", location: "Bogotá, Colombia", country: "CO", seoReady: false });
  await insertJob({
    title: "Analista sin experiencia en Python SIP",
    location: "Bogotá, Colombia",
    country: "CO",
    description: "Requisitos: 3 años de experiencia en SQL."
  });
  for (let i = 0; i < 3; i++) await insertJob({ title: `Mesero sin experiencia SIP ${i}`, location: "Caracas, Venezuela", country: "VE" });
}

function startServer(port: number, extraEnv: Record<string, string> = {}): ChildProcess {
  return spawn(process.execPath, [...process.execArgv, path.join(__dirname, "..", "src", "server.ts")], {
    cwd: process.cwd(),
    shell: false,
    stdio: "inherit",
    env: { ...process.env, PORT: String(port), ...extraEnv }
  });
}

async function waitFor(server: ChildProcess, base: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`El servidor terminó con código ${server.exitCode}.`);
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("El servidor de prueba no respondió.");
}

function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    server.once("exit", () => resolve());
    server.kill("SIGTERM");
  });
}

interface Page {
  status: number;
  html: string;
  payload: { country?: string; total?: number; jobs?: Array<{ title: string; country?: string | null; location?: string }>; answer?: { heading: string; items: Array<{ question: string; answer: string }> }; intentLinks?: Array<{ href: string }> } | null;
}

async function get(base: string, route: string): Promise<Page> {
  const res = await fetch(`${base}${route}`);
  const html = await res.text();
  const raw = /window\.__SSR_CATEGORY__=(\{[\s\S]*?\});<\/script>/.exec(html)?.[1];
  return { status: res.status, html, payload: raw ? JSON.parse(raw) : null };
}

const canonicalOf = (html: string) => /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
const robotsOf = (html: string) => /<meta name="robots" content="([^"]+)"/.exec(html)?.[1] ?? "index";
const hasHreflang = (html: string) => /hreflang="es-VE"/.test(html);

async function httpChecks(): Promise<void> {
  console.log("\n--- SIP-001…041: HTTP real ---\n");
  const base = `http://127.0.0.1:${PORT}`;
  const server = startServer(PORT);
  try {
    await waitFor(server, base);

    // The sitemap awaits every intent count, which also warms the cache the
    // hubs peek for their links.
    const sitemap = await (await fetch(`${base}/sitemap-categories.xml`)).text();
    const loc = (p: string) => sitemap.includes(`<loc>${SITE_URL}${p}</loc>`);
    check(
      loc("/empleos/remoto") && loc("/ve/empleos/remoto") && loc("/empleos/sin-experiencia") && loc("/empleos/bogota/sin-experiencia") && !loc("/ve/empleos/sin-experiencia"),
      "SIP-020/021 sitemap-categories lista solo las páginas de intención con ≥ 10 aptas.",
      "El sitemap no refleja la guarda."
    );
    check(sitemap.split(`<loc>${SITE_URL}/empleos/remoto</loc>`).length === 2, "/empleos/remoto aparece una sola vez en el sitemap.", "/empleos/remoto duplicado en el sitemap.");

    const ve = await get(base, "/ve/empleos/remoto");
    check(
      ve.status === 200 &&
        canonicalOf(ve.html) === `${SITE_URL}/ve/empleos/remoto` &&
        (ve.payload?.jobs ?? []).length === 12 &&
        (ve.payload?.jobs ?? []).every((job) => job.country !== "CO") &&
        !/Analista \(Remoto\) SIP/.test(ve.html),
      "SIP-001 /ve/empleos/remoto: canonical propio y 0 vacantes de CO en el HTML y el payload.",
      `SIP-001 falló: status ${ve.status}, canonical ${canonicalOf(ve.html)}, jobs ${(ve.payload?.jobs ?? []).length}.`
    );
    check(
      ve.html.includes("<title>Trabajo remoto en Venezuela: 12 vacantes desde casa | BuscoTrabajo</title>") &&
        ve.html.includes("<h1>Trabajo remoto en Venezuela: vacantes desde casa</h1>") &&
        robotsOf(ve.html) === "index",
      "SIP-030 título D4 con el total real; indexable.",
      `SIP-030 falló en /ve/empleos/remoto (robots ${robotsOf(ve.html)}).`
    );
    const answerSsr = /<section data-intent-answer aria-label="[^"]*">([\s\S]*?)<\/section>/.exec(ve.html)?.[1];
    check(
      Boolean(answerSsr && ve.payload?.answer && answerSsr === renderIntentAnswerHtml(ve.payload.answer)),
      "SIP-031 el bloque de respuesta del HTML es el mismo que hidrata React (payload).",
      "SIP-031 el bloque del servidor y el del payload difieren."
    );
    const ldTypes = [...ve.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])["@type"]);
    check(
      ldTypes.includes("ItemList") && ldTypes.includes("BreadcrumbList") && !ldTypes.includes("JobPosting"),
      "SIP-033 JSON-LD de intención: ItemList + BreadcrumbList, sin JobPosting.",
      `SIP-033 tipos: ${ldTypes.join(",")}`
    );

    const co = await get(base, "/empleos/remoto");
    check(
      co.status === 200 &&
        canonicalOf(co.html) === `${SITE_URL}/empleos/remoto` &&
        !co.html.includes("Workana") &&
        !co.html.includes("logo SIP") &&
        co.html.includes("<title>Trabajos remotos en Colombia: empleos y ofertas de empleo | BuscoTrabajo</title>") &&
        !co.html.includes("data-intent-answer"),
      "SIP-004 + ADR §5: /empleos/remoto excluye Workana y conserva su title/H1 medidos, sin bloque nuevo.",
      "/empleos/remoto cambió de copia o lista Workana."
    );
    check(
      hasHreflang(co.html) && hasHreflang(ve.html) && co.html.includes(`hreflang="es-CO" href="${SITE_URL}/empleos/remoto"`),
      "SIP-040 remoto CO/VE (las dos indexables) emiten hreflang recíproco.",
      "SIP-040 falta el hreflang recíproco de remoto."
    );

    const sin = await get(base, "/empleos/sin-experiencia");
    check(
      sin.status === 200 &&
        sin.html.includes("<title>Trabajo sin experiencia en Colombia: 10 vacantes | BuscoTrabajo</title>") &&
        robotsOf(sin.html) === "index" &&
        !sin.html.includes("SIP no apto") &&
        !sin.html.includes("en Python SIP") &&
        (sin.payload?.jobs ?? []).every((job) => /sin experiencia/i.test(job.title)),
      "SIP-010/020/022 /empleos/sin-experiencia: 10 aptas, solo las que pasan el clasificador y la guarda.",
      `/empleos/sin-experiencia falló (status ${sin.status}, total ${sin.payload?.total}, robots ${robotsOf(sin.html)}).`
    );
    const sinVe = await get(base, "/ve/empleos/sin-experiencia");
    check(
      sinVe.status === 200 && robotsOf(sinVe.html) === "noindex,follow" && !hasHreflang(sinVe.html) && !hasHreflang(sin.html),
      "SIP-021/040 VE sin experiencia (3) es 200 noindex,follow y ninguna de las dos emite hreflang.",
      `SIP-021/040 falló (robots ${robotsOf(sinVe.html)}).`
    );

    const bog = await get(base, "/empleos/bogota/sin-experiencia");
    check(
      bog.status === 200 &&
        canonicalOf(bog.html) === `${SITE_URL}/empleos/bogota/sin-experiencia` &&
        (bog.payload?.jobs ?? []).length === 10 &&
        (bog.payload?.jobs ?? []).every((job) => /bogot/i.test(job.location || "") && /sin experiencia/i.test(job.title)) &&
        !hasHreflang(bog.html),
      "SIP-002/041 Bogotá × sin experiencia: canonical propio, solo Bogotá y el clasificador, sin hreflang.",
      `SIP-002 falló (canonical ${canonicalOf(bog.html)}).`
    );
    const abc = await get(base, "/empleos/bogota/abc");
    check(canonicalOf(abc.html) === `${SITE_URL}/empleos/bogota`, "SIP-003 /empleos/bogota/abc sigue siendo el hub de Bogotá.", `SIP-003 canonical ${canonicalOf(abc.html)}.`);

    const hub = await get(base, "/empleos/bogota");
    const links = (hub.payload?.intentLinks ?? []).map((link) => link.href);
    check(
      links.includes("/empleos/sin-experiencia") &&
        links.includes("/empleos/bogota/sin-experiencia") &&
        links.includes("/empleos/remoto") &&
        hub.html.includes('<a href="/empleos/bogota/sin-experiencia">') &&
        canonicalOf(hub.html) === `${SITE_URL}/empleos/bogota`,
      "SIP-020 el hub de Bogotá enlaza las páginas de intención indexables (HTML y payload).",
      `SIP-020 enlaces del hub: ${links.join(", ")}`
    );
    const caracas = await get(base, "/empleos/caracas");
    check(
      !caracas.html.includes('href="/ve/empleos/sin-experiencia"') && caracas.html.includes('href="/ve/empleos/remoto"'),
      "SIP-021 ninguna página enlaza VE sin experiencia (noindex); Caracas sí enlaza VE remoto.",
      "SIP-021 enlaces de Caracas inesperados."
    );

    const api = await fetch(`${base}/api/intent-page?path=${encodeURIComponent("/ve/empleos/remoto")}`);
    const apiBody = (await api.json()) as { total: number; country: string };
    const bad = await fetch(`${base}/api/intent-page?path=${encodeURIComponent("/empleos/cualquier-cosa")}`);
    check(
      api.status === 200 && apiBody.total === 12 && apiBody.country === "VE" && bad.status === 404,
      "Respaldo del cliente /api/intent-page: mismo total que el SSR y solo rutas de la lista blanca.",
      `/api/intent-page: ${api.status} total ${apiBody.total}, desconocida ${bad.status}.`
    );
  } finally {
    await stop(server);
  }

  console.log("\n--- Rollback: INTENT_PAGES_ENABLED=false ---\n");
  const rbBase = `http://127.0.0.1:${ROLLBACK_PORT}`;
  const rollback = startServer(ROLLBACK_PORT, { INTENT_PAGES_ENABLED: "false" });
  try {
    await waitFor(rollback, rbBase);
    const gone = await Promise.all(["/empleos/sin-experiencia", "/ve/empleos/sin-experiencia", "/empleos/bogota/sin-experiencia"].map((route) => fetch(`${rbBase}${route}`).then((r) => r.status)));
    const veRemote = await get(rbBase, "/ve/empleos/remoto");
    const legacySitemap = await (await fetch(`${rbBase}/sitemap-categories.xml`)).text();
    check(
      gone.every((status) => status === 410) &&
        canonicalOf(veRemote.html) === `${SITE_URL}/empleos/remoto` &&
        legacySitemap.includes(`<loc>${SITE_URL}/empleos/remoto</loc>`) &&
        !legacySitemap.includes("sin-experiencia"),
      "Rollback: URL nuevas 410, remoto vuelve al hub «Remoto» de CO y el sitemap al de hoy.",
      `Rollback falló: ${gone.join(",")}, canonical VE ${canonicalOf(veRemote.html)}.`
    );
  } finally {
    await stop(rollback);
  }
}

async function main(): Promise<void> {
  await sqlParity();
  await seed();
  await httpChecks();
  await pool.end();
  if (failures > 0) {
    console.error(`\n${failures} comprobaciones fallaron.`);
    process.exit(1);
  }
  console.log("\nTodas las comprobaciones de páginas de intención pasaron.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
