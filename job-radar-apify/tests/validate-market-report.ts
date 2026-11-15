import "./require-isolated-database.js";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { queryMarketRows, saveJobs } from "../src/db/job-repository.js";
import { pool } from "../src/db/client.js";
import { buildMarketSnapshot, isMarketSnapshot, marketEditionPath, type MarketSnapshot } from "../src/lib/market-report.js";
import type { HomeData } from "../src/lib/home-stats.js";
import { AD_ELIGIBLE_META } from "../src/lib/ad-eligibility.js";
import type { Job } from "../src/sources/types.js";

// adsense-readiness F4 against the isolated database: the snapshot query runs
// inside READ ONLY and equals the home/dashboard total; the server serves the
// frozen editions (raw HTML, Markdown, JSON, sitemap) without the ad marker,
// hubs carry their comparison, and REPORTS_ENABLED=false is a real 404.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = Number(process.env.TEST_HTTP_PORT);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEST_URL_PREFIX = "https://www.example.com/job/market-report-";
const HOUR = 3_600_000;

function makeJob(id: string, overrides: Partial<Job>): Job {
  return {
    jobId: id,
    title: `Asesor comercial ${id}`,
    company: "ZzMercado SAS",
    location: "Bogotá, D.C.",
    url: `${TEST_URL_PREFIX}${id}`,
    dateText: "Hace 1 día",
    source: "LinkedIn",
    country: "CO",
    publishedAt: new Date(Date.now() - 5 * HOUR).toISOString(),
    ...overrides
  };
}

// Enough rows for Bogotá and «Asesor comercial» to pass the 10-job cells.
const SEED: Job[] = [
  ...Array.from({ length: 14 }, (_, i) => makeJob(`bog-${i}`, { title: `Asesor comercial zona ${i}` })),
  ...Array.from({ length: 11 }, (_, i) => makeJob(`med-${i}`, { title: `Auxiliar administrativo sede ${i}`, location: "Medellín, Antioquia", source: "Portal oficial" }))
];

let failures = 0;
function check(condition: boolean, pass: string, fail: string): void {
  if (condition) console.log(`✅ [PASSED] ${pass}`);
  else {
    console.error(`❌ [FAILED] ${fail}`);
    failures++;
  }
}

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM jobs WHERE url LIKE $1`, [`${TEST_URL_PREFIX}%`]);
}

function startServer(env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, [...process.execArgv, path.join(__dirname, "..", "src", "server.ts")], {
    cwd: process.cwd(),
    shell: false,
    stdio: "inherit",
    env: { ...process.env, PORT: String(TEST_PORT), ...env }
  });
}

async function waitForServer(server: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`El servidor terminó con código ${server.exitCode}.`);
    try {
      if ((await fetch(`${BASE_URL}/api/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("El servidor no respondió.");
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
    server.kill("SIGTERM");
  });
}

async function readSnapshot(): Promise<MarketSnapshot> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60000ms'");
    const rows = await queryMarketRows(client, "CO");
    let writeRejected = false;
    try {
      await client.query("SAVEPOINT probe");
      await client.query(`UPDATE jobs SET title = title WHERE url LIKE $1`, [`${TEST_URL_PREFIX}%`]);
    } catch {
      writeRejected = true;
    }
    check(writeRejected, "La transacción del informe es de solo lectura (un UPDATE falla).", "Un UPDATE pasó dentro de la transacción del informe.");
    await client.query("ROLLBACK");
    check(rows.every((row) => !("url" in row) && !("id" in row)), "Las filas no traen URL ni id.", "Las filas traen URL o id.");
    return buildMarketSnapshot(rows, { country: "CO", cutoff: new Date() });
  } finally {
    client.release();
  }
}

function previousPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

async function run(): Promise<void> {
  await cleanup();
  await saveJobs(SEED, "Test Market Report");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "market-reports-"));
  let server: ChildProcess | null = null;
  try {
    const snapshot = await readSnapshot();
    check(isMarketSnapshot(snapshot), "El informe generado pasa la validación de forma.", "El informe generado no pasa la validación.");
    check(snapshot.cities.some((city) => city.label === "Bogotá") && snapshot.roles.some((role) => role.label.toLowerCase() === "asesor comercial"),
      "Bogotá y «Asesor comercial» superan la celda mínima.", `Los datos sembrados no llegaron al informe: total ${snapshot.total}, ciudades ${JSON.stringify(snapshot.cities)}, cargos ${JSON.stringify(snapshot.roles.slice(0, 5))}.`);
    const prior = previousPeriod(snapshot.period);
    const previous: MarketSnapshot = { ...snapshot, period: prior, cutoff: new Date(Date.parse(snapshot.cutoff) - 31 * 24 * HOUR).toISOString(), total: Math.max(snapshot.total - 5, 0) };
    fs.writeFileSync(path.join(dir, `CO-${snapshot.period}.json`), JSON.stringify(snapshot));
    fs.writeFileSync(path.join(dir, `CO-${prior}.json`), JSON.stringify(previous));
    fs.writeFileSync(path.join(dir, "CO-1999-01.json"), JSON.stringify({ ...snapshot, cities: [{ label: "Bogotá", count: 2 }] }));

    server = startServer({ MARKET_REPORTS_DIR: dir });
    await waitForServer(server);

    const home = (await (await fetch(`${BASE_URL}/api/home-stats?country=CO`)).json()) as HomeData;
    check(home.totalJobs === snapshot.total, `El total del informe (${snapshot.total}) es el de la portada.`, `Informe ${snapshot.total} vs portada ${home.totalJobs}.`);
    check(home.market?.period === snapshot.period && typeof home.market.roleCounts["Asesor comercial"] === "number",
      "La portada recibe las cifras de cargos de la edición.", "La portada no recibe las cifras de la edición.");

    const editionPath = marketEditionPath(snapshot.period);
    const page = await fetch(`${BASE_URL}${editionPath}`);
    const html = await page.text();
    check(page.status === 200, `${editionPath} responde 200.`, `${editionPath} respondió ${page.status}.`);
    const app = /<div id="app">([\s\S]*?)<\/article>/.exec(html)?.[1] ?? "";
    check(/Fecha de corte/.test(app) && /Metodología/.test(app) && /Límites/.test(app) && app.includes(snapshot.total.toLocaleString("es-CO")),
      "El HTML inicial trae cifras, fecha de corte, metodología y límites.", `Al HTML inicial le falta texto del informe: ${app.slice(0, 300)}`);
    check(app.includes("Frente al corte del"), "La edición compara con la del mes anterior.", "Falta la variación contra el mes anterior.");
    check(!html.includes(AD_ELIGIBLE_META), "El informe no lleva el marcador de anuncios.", "El informe lleva el marcador de anuncios.");
    check(!/<meta[^>]*name="robots"[^>]*noindex/.test(html), "El informe es indexable.", "El informe lleva noindex.");

    const markdown = await fetch(`${BASE_URL}${editionPath}`, { headers: { Accept: "text/markdown" } });
    check((markdown.headers.get("content-type") || "").startsWith("text/markdown") && /Accept/.test(markdown.headers.get("vary") || ""),
      "Negociación Markdown con Vary: Accept.", "Sin negociación Markdown.");
    check(markdown.headers.get("cache-control") === "private, no-store",
      "La variante Markdown nunca entra en el caché del borde.", `Markdown con Cache-Control ${markdown.headers.get("cache-control")}.`);
    const api = await fetch(`${BASE_URL}/api${editionPath}`);
    check(api.status === 200, "/api/informes sirve el mismo contenido en JSON.", `/api/informes respondió ${api.status}.`);

    const latest = await fetch(`${BASE_URL}/informes/empleo-colombia`, { redirect: "manual" });
    check(latest.status === 302 && latest.headers.get("location") === editionPath, "/informes/empleo-colombia lleva a la edición más reciente.", `Respondió ${latest.status} ${latest.headers.get("location")}.`);
    const invalid = await fetch(`${BASE_URL}/informes/empleo-colombia-1999-01`);
    check(invalid.status === 404, "Un archivo con celdas menores de 10 se descarta (404).", `El archivo inválido respondió ${invalid.status}.`);
    const index = await (await fetch(`${BASE_URL}/informes`)).text();
    check(index.includes(editionPath) && !/<meta[^>]*name="robots"[^>]*noindex/.test(index), "/informes lista las ediciones y es indexable.", "/informes no lista la edición.");

    const sitemap = await (await fetch(`${BASE_URL}/sitemap-pages.xml`)).text();
    check(sitemap.includes("https://buscotrabajo.co/informes</loc>") && sitemap.includes(`https://buscotrabajo.co${editionPath}</loc>`),
      "sitemap-pages.xml lista /informes y la edición.", "El sitemap no lista los informes.");

    const hub = await (await fetch(`${BASE_URL}/empleos/bogota`)).text();
    check(hub.includes("data-hub-comparison") && hub.includes("Comparación con el país"), "El hub de Bogotá trae su comparación con el país.", "El hub no trae la comparación.");

    await stopServer(server);
    server = startServer({ MARKET_REPORTS_DIR: dir, REPORTS_ENABLED: "false" });
    await waitForServer(server);
    const off = await fetch(`${BASE_URL}${editionPath}`);
    const offIndex = await fetch(`${BASE_URL}/informes`);
    const offSitemap = await (await fetch(`${BASE_URL}/sitemap-pages.xml`)).text();
    check(off.status === 404 && offIndex.status === 404 && !offSitemap.includes("/informes"),
      "REPORTS_ENABLED=false: 404 real y fuera del sitemap.", `Con el interruptor apagado: ${off.status}/${offIndex.status}.`);
  } finally {
    if (server) await stopServer(server);
    fs.rmSync(dir, { recursive: true, force: true });
    await cleanup();
    await pool.end();
  }
  if (failures > 0) {
    console.error(`\n❌ ${failures} verificación(es) del informe fallaron.\n`);
    process.exit(1);
  }
  console.log("\n🎉 [TEST SUITE PASSED] Informe mensual (F4).\n");
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
