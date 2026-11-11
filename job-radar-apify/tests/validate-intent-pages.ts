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
import { sqlSchedule, type ScheduleIntent } from "../src/lib/job-schedule.js";
import { EXPERIENCE_CASES } from "./fixtures/experience-cases.js";
import { SCHEDULE_CASES } from "./fixtures/schedule-cases.js";

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

  console.log("\n--- SIW-011: clasificador de jornada SQL = memoria ---\n");
  let scheduleMismatches = 0;
  for (const intent of ["fines-de-semana", "medio-tiempo", "temporada"] as ScheduleIntent[]) {
    for (const c of SCHEDULE_CASES) {
      const { rows } = await pool.query<{ hit: boolean }>(`SELECT ${sqlSchedule(intent, "$1::text")} AS hit`, [c.title]);
      if (rows[0].hit !== c.expected.includes(intent)) {
        scheduleMismatches++;
        console.error(`   SQL ≠ esperado en «${c.note}» (${intent}): ${c.title}`);
      }
    }
  }
  check(scheduleMismatches === 0, `SQL y memoria coinciden en los ${SCHEDULE_CASES.length} casos × 3 intenciones de jornada.`, `${scheduleMismatches} casos difieren.`);
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
  // seo-intent-wave2: Medellín × sin experiencia indexable (10), fines de
  // semana indexable (10), medio tiempo below the guard (3), temporada 0,
  // and Ciudad Guayana with Puerto Ordaz.
  for (let i = 0; i < 10; i++) await insertJob({ title: `Auxiliar sin experiencia SIW ${i}`, location: "Medellín, Antioquia", country: "CO" });
  for (let i = 0; i < 10; i++) await insertJob({ title: `Mesero fines de semana SIW ${i}`, location: "Barranquilla, Atlántico", country: "CO" });
  await insertJob({
    title: "Asesor comercial SIW disponibilidad",
    location: "Barranquilla, Atlántico",
    country: "CO",
    description: "Disponibilidad para laborar fines de semana y festivos."
  });
  for (let i = 0; i < 3; i++) await insertJob({ title: `Cajero medio tiempo SIW ${i}`, location: "Cali, Valle del Cauca", country: "CO" });
  await insertJob({ title: "Asistente comercial SIW Puerto Ordaz", location: "Puerto Ordaz, Bolívar", country: "VE" });
  await insertJob({ title: "Vendedor SIW Ciudad Guayana", location: "Ciudad Guayana, Bolívar", country: "VE" });
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
        // 10 in Bogotá + 10 in Medellín (seo-intent-wave2 seed).
        sin.html.includes("<title>Trabajo sin experiencia en Colombia: 20 vacantes | BuscoTrabajo</title>") &&
        robotsOf(sin.html) === "index" &&
        !sin.html.includes("SIP no apto") &&
        !sin.html.includes("en Python SIP") &&
        (sin.payload?.jobs ?? []).every((job) => /sin experiencia/i.test(job.title)),
      "SIP-010/020/022 /empleos/sin-experiencia: 20 aptas, solo las que pasan el clasificador y la guarda.",
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

    await wave2Checks(base, sitemap, loc, links);

    const api = await fetch(`${base}/api/intent-page?path=${encodeURIComponent("/ve/empleos/remoto")}`);
    const apiBody = (await api.json()) as { total: number; country: string };
    const bad = await fetch(`${base}/api/intent-page?path=${encodeURIComponent("/empleos/cualquier-cosa")}`);
    check(
      api.status === 200 && apiBody.total === 12 && apiBody.country === "VE" && bad.status === 404,
      "Respaldo del cliente /api/intent-page: mismo total que el SSR y solo rutas de la lista blanca.",
      `/api/intent-page: ${api.status} total ${apiBody.total}, desconocida ${bad.status}.`
    );

    // seo-empleos-coverage (ADR 0014): the /empleos index pages and the
    // guarded city hubs, over HTTP against the same fixture.
    console.log("\n--- seo-empleos-coverage ---\n");
    const index = await get(base, "/empleos");
    const indexVe = await get(base, "/ve/empleos");
    check(
      index.status === 200 &&
        canonicalOf(index.html) === `${SITE_URL}/empleos` &&
        indexVe.status === 200 &&
        canonicalOf(indexVe.html) === `${SITE_URL}/ve/empleos` &&
        index.html.includes("<h1>Empleos en Colombia</h1>") &&
        indexVe.html.includes("<h1>Empleos en Venezuela</h1>") &&
        robotsOf(index.html) !== "noindex",
      "SEC-020 /empleos y /ve/empleos responden 200 con su canonical y su H1.",
      `SEC-020 falló: ${index.status} ${canonicalOf(index.html)} / ${indexVe.status} ${canonicalOf(indexVe.html)}.`
    );
    check(
      [index.html, indexVe.html].every(
        (html) =>
          html.includes(`hreflang="es-CO" href="${SITE_URL}/empleos"`) &&
          html.includes(`hreflang="es-VE" href="${SITE_URL}/ve/empleos"`) &&
          html.includes(`hreflang="x-default" href="${SITE_URL}/empleos"`)
      ),
      "SEC-021 hreflang recíproco es-CO / es-VE y x-default en las dos páginas índice.",
      "SEC-021 falta algún hreflang en /empleos o /ve/empleos."
    );
    check(
      index.html.includes('<a href="/empleos/bogota">') &&
        indexVe.html.includes('<a href="/empleos/caracas">') &&
        index.html.includes("window.__SSR_EMPLEOS__=") &&
        index.html.includes('"@type":"BreadcrumbList"') &&
        (index.html.match(/<title>/g) || []).length === 1,
      "SEC-023/024 /empleos enlaza los hubs de su país y trae payload, BreadcrumbList y un solo <title>.",
      "SEC-023/024 a /empleos le faltan enlaces a hubs, el payload o el JSON-LD."
    );
    const slash = await fetch(`${base}/empleos/`, { redirect: "manual" });
    check(
      slash.status === 301 && slash.headers.get("location") === "/empleos",
      "SEC-025 /empleos/ redirige 301 a /empleos.",
      `SEC-025 /empleos/ respondió ${slash.status} → ${slash.headers.get("location")}.`
    );
    const indexApi = await fetch(`${base}/api/empleos-index?country=VE`);
    const indexApiBody = (await indexApi.json()) as { country: string; sections: { cities: unknown[] } };
    const indexApiBad = await fetch(`${base}/api/empleos-index?country=AR`);
    check(
      indexApi.status === 200 && indexApiBody.country === "VE" && indexApiBody.sections.cities.length > 0 && indexApiBad.status === 404,
      "Respaldo del cliente /api/empleos-index: datos del país pedido y 404 para un país desconocido.",
      `/api/empleos-index: ${indexApi.status}, país desconocido ${indexApiBad.status}.`
    );
    // The fixture has no jobs in Yopal: the guarded hub is a 200 below the guard.
    const yopal = await get(base, "/empleos/yopal");
    const coverageSitemap = await (await fetch(`${base}/sitemap-categories.xml`)).text();
    check(
      yopal.status === 200 &&
        canonicalOf(yopal.html) === `${SITE_URL}/empleos/yopal` &&
        robotsOf(yopal.html) === "noindex,follow" &&
        !coverageSitemap.includes(`<loc>${SITE_URL}/empleos/yopal</loc>`) &&
        !index.html.includes('href="/empleos/yopal"'),
      "SEC-010/012/013 un hub con guarda por debajo de 10 es noindex,follow, sin sitemap y sin enlace desde /empleos.",
      `SEC-010/012/013 falló: ${yopal.status}, robots ${robotsOf(yopal.html)}.`
    );
    check(
      coverageSitemap.includes(`<loc>${SITE_URL}/empleos</loc>`) && coverageSitemap.includes(`<loc>${SITE_URL}/ve/empleos</loc>`),
      "SEC-012 el sitemap de categorías lista /empleos y /ve/empleos.",
      "SEC-012 el sitemap de categorías no lista las páginas índice."
    );
    const bogotaHub = await get(base, "/empleos/bogota");
    check(
      robotsOf(bogotaHub.html) !== "noindex,follow" && !bogotaHub.html.includes('href="/empleos/yopal"') && !bogotaHub.html.includes('href="/empleos/soacha"'),
      "SEC-030 el hub de Bogotá no enlaza los hubs con guarda ni cambia su robots.",
      "SEC-030 el hub de Bogotá cambió."
    );
  } finally {
    await stop(server);
  }

  console.log("\n--- Rollback: INTENT_PAGES_ENABLED=false ---\n");
  const rbBase = `http://127.0.0.1:${ROLLBACK_PORT}`;
  const rollback = startServer(ROLLBACK_PORT, { INTENT_PAGES_ENABLED: "false", EMPLEOS_COVERAGE_ENABLED: "false" });
  try {
    await waitFor(rollback, rbBase);
    const gone = await Promise.all(["/empleos/sin-experiencia", "/ve/empleos/sin-experiencia", "/empleos/bogota/sin-experiencia", "/empleos/medellin/sin-experiencia", "/empleos/fines-de-semana", "/empleos/medio-tiempo", "/empleos/temporada"].map((route) => fetch(`${rbBase}${route}`).then((r) => r.status)));
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
    const coverageOff = await Promise.all(["/empleos", "/ve/empleos", "/empleos/yopal", "/empleos/maturin"].map(async (route) => (await fetch(`${rbBase}${route}`)).status));
    check(
      coverageOff.join(",") === "404,404,410,410" && !legacySitemap.includes(`<loc>${SITE_URL}/empleos</loc>`) && !legacySitemap.includes("/empleos/yopal"),
      "SEC-040 con EMPLEOS_COVERAGE_ENABLED=false: /empleos 404, hubs con guarda 410 y fuera del sitemap.",
      `SEC-040 falló: ${coverageOff.join(",")}.`
    );
  } finally {
    await stop(rollback);
  }
}

// seo-intent-wave2 (SIW-001 … SIW-052) over the same server.
async function wave2Checks(base: string, sitemap: string, loc: (path: string) => boolean, bogotaLinks: string[]): Promise<void> {
  console.log("\n--- SIW: segunda ola por HTTP ---\n");
  check(
    loc("/empleos/fines-de-semana") &&
      loc("/empleos/medellin/sin-experiencia") &&
      !loc("/empleos/medio-tiempo") &&
      !loc("/empleos/temporada") &&
      !loc("/empleos/cali/sin-experiencia") &&
      !sitemap.includes("/ve/empleos/fines-de-semana"),
    "SIW-030/033 el sitemap lista fines de semana y Medellín (≥ 10) y no medio tiempo, temporada ni Cali.",
    "SIW-030 el sitemap no refleja la guarda de las páginas nuevas."
  );
  const med = await get(base, "/empleos/medellin/sin-experiencia");
  check(
    med.status === 200 &&
      canonicalOf(med.html) === `${SITE_URL}/empleos/medellin/sin-experiencia` &&
      med.html.includes("<title>Trabajo sin experiencia en Medellín: 10 vacantes | BuscoTrabajo</title>") &&
      robotsOf(med.html) === "index" &&
      (med.payload?.jobs ?? []).length === 10 &&
      (med.payload?.jobs ?? []).every((job) => /medell/i.test(job.location || "") && /sin experiencia/i.test(job.title)) &&
      !hasHreflang(med.html),
    "SIW-001 Medellín × sin experiencia: canonical propio, solo Medellín y el clasificador, sin hreflang.",
    `SIW-001 falló (status ${med.status}, canonical ${canonicalOf(med.html)}, jobs ${(med.payload?.jobs ?? []).length}).`
  );
  const medOther = await get(base, "/empleos/medellin/fines-de-semana");
  check(
    canonicalOf(medOther.html) === `${SITE_URL}/empleos/medellin`,
    "SIW-002 /empleos/medellin/fines-de-semana sigue siendo el hub.",
    `SIW-002 canonical ${canonicalOf(medOther.html)}.`
  );

  const fds = await get(base, "/empleos/fines-de-semana");
  check(
    fds.status === 200 &&
      fds.html.includes("<title>Trabajo los fines de semana en Colombia: 10 vacantes | BuscoTrabajo</title>") &&
      fds.html.includes("<h1>Trabajo los fines de semana en Colombia</h1>") &&
      robotsOf(fds.html) === "index" &&
      !fds.html.includes("SIW disponibilidad") &&
      (fds.payload?.jobs ?? []).every((job) => /fines de semana/i.test(job.title)) &&
      !hasHreflang(fds.html),
    "SIW-010/022/040 /empleos/fines-de-semana: 10 aptas por título, sin la mención de la descripción y sin hreflang.",
    `SIW-010 falló (status ${fds.status}, total ${fds.payload?.total}, robots ${robotsOf(fds.html)}).`
  );
  const fdsAnswer = /<section data-intent-answer aria-label="[^"]*">([\s\S]*?)<\/section>/.exec(fds.html)?.[1];
  check(
    Boolean(
      fdsAnswer &&
        fds.payload?.answer &&
        fdsAnswer === renderIntentAnswerHtml(fds.payload.answer) &&
        fdsAnswer.includes("cuyo título dice que son de fines de semana")
    ),
    "SIW-041 el bloque de respuesta de fines de semana es el mismo en el HTML y en el payload.",
    "SIW-041 el bloque de fines de semana difiere o falta."
  );
  const mt = await get(base, "/empleos/medio-tiempo");
  const temp = await get(base, "/empleos/temporada");
  check(
    mt.status === 200 &&
      robotsOf(mt.html) === "noindex,follow" &&
      mt.payload?.total === 3 &&
      temp.status === 200 &&
      robotsOf(temp.html) === "noindex,follow",
    "SIW-030 medio tiempo (3) y temporada (0) responden 200 noindex,follow.",
    `SIW-030 falló (medio tiempo ${mt.status} ${robotsOf(mt.html)} total ${mt.payload?.total}; temporada ${temp.status} ${robotsOf(temp.html)}).`
  );
  const missing = await Promise.all(
    ["/ve/empleos/fines-de-semana", "/ve/empleos/medio-tiempo", "/ve/empleos/temporada", "/empleos/por-dias", "/empleos/puerto-ordaz"].map((route) =>
      fetch(`${base}${route}`).then((r) => r.status)
    )
  );
  check(
    missing.every((status) => status === 404),
    "SIW-020/052 sin versión de VE, por días ni /empleos/puerto-ordaz: 404.",
    `SIW-020 códigos: ${missing.join(",")}`
  );

  const plain = (await (await fetch(`${base}/api/jobs?country=CO&limit=5`)).json()) as { total: number };
  const withSchedule = (await (await fetch(`${base}/api/jobs?country=CO&limit=5&schedule=fines-de-semana`)).json()) as { total: number };
  check(
    plain.total === withSchedule.total && plain.total > 10,
    "SIW-013 /api/jobs ignora ?schedule=.",
    `SIW-013 /api/jobs total ${plain.total} frente a ${withSchedule.total}.`
  );

  check(
    bogotaLinks.includes("/empleos/fines-de-semana") &&
      !bogotaLinks.includes("/empleos/medio-tiempo") &&
      !bogotaLinks.includes("/empleos/medellin/sin-experiencia"),
    "SIW-032 el hub de Bogotá enlaza fines de semana (indexable) y no medio tiempo ni la página de Medellín.",
    `SIW-032 enlaces de Bogotá: ${bogotaLinks.join(", ")}`
  );
  const medHub = await get(base, "/empleos/medellin");
  const medLinks = (medHub.payload?.intentLinks ?? []).map((link) => link.href);
  check(
    medLinks.includes("/empleos/medellin/sin-experiencia") &&
      !medLinks.includes("/empleos/cali/sin-experiencia") &&
      canonicalOf(medHub.html) === `${SITE_URL}/empleos/medellin`,
    "SIW-032 el hub de Medellín enlaza su página sin experiencia.",
    `SIW-032 enlaces de Medellín: ${medLinks.join(", ")}`
  );

  const guayana = await get(base, "/empleos/ciudad-guayana");
  const guayanaTitles = (guayana.payload?.jobs ?? []).map((job) => job.title);
  check(
    guayana.status === 200 &&
      canonicalOf(guayana.html) === `${SITE_URL}/empleos/ciudad-guayana` &&
      guayana.html.includes("<title>Empleos en Ciudad Guayana y Puerto Ordaz: trabajo y ofertas de empleo | BuscoTrabajo</title>") &&
      guayanaTitles.includes("Asistente comercial SIW Puerto Ordaz") &&
      guayanaTitles.includes("Vendedor SIW Ciudad Guayana"),
    "SIW-050/051 el hub de Ciudad Guayana nombra y lista Puerto Ordaz; canonical sin cambios.",
    `SIW-050 falló (status ${guayana.status}, vacantes ${guayanaTitles.join(" | ")}).`
  );
  const caracasHub = await get(base, "/empleos/caracas");
  check(
    caracasHub.html.includes("<title>Empleos en Caracas: trabajo y ofertas de empleo | BuscoTrabajo</title>") &&
      !caracasHub.html.includes("SIW Puerto Ordaz"),
    "SIW-052 el hub de Caracas no cambia.",
    "SIW-052 el hub de Caracas cambió."
  );
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
