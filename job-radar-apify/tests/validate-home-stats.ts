import "./require-isolated-database.js";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { saveJobs } from "../src/db/job-repository.js";
import { pool } from "../src/db/client.js";
import { getHomeCities } from "../src/lib/home-stats.js";
import type { HomeData } from "../src/lib/home-stats.js";
import type { Job } from "../src/sources/types.js";

// GET /api/home-stats replaced ~13 homepage calls to /api/jobs and
// /api/companies/search. Every figure must stay exactly what those
// endpoints report for the same filter — this compares the two over HTTP
// against the isolated database, for both countries.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = Number(process.env.TEST_HTTP_PORT);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEST_URL_PREFIX = "https://www.example.com/job/home-stats-";
const HOUR = 3_600_000;

// The baseline fixture has nothing published in the last 24 h and nothing
// outside each country's first city, so those comparisons would only ever
// check 0 = 0. These rows give every figure something to count, including
// a vacancy group that exists in both countries — the dashboard dedupes
// across countries BEFORE scoping by country, and so must this endpoint.
function makeJob(id: string, overrides: Partial<Job>): Job {
  return {
    jobId: id,
    title: `Vacante home-stats ${id}`,
    company: "ZzHome Corp",
    location: "Bogotá, Colombia",
    url: `${TEST_URL_PREFIX}${id}`,
    dateText: "Hace 1 día",
    source: "LinkedIn",
    country: "CO",
    publishedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    ...overrides
  };
}

const SEED: Job[] = [
  makeJob("medellin_fresh", { location: "Medellín, Antioquia" }),
  makeJob("cali_hibrido", { location: "Cali - Híbrido", publishedAt: new Date(Date.now() - 30 * HOUR).toISOString() }),
  makeJob("remote_everywhere", { location: "Remoto", country: null, publishedAt: new Date(Date.now() - 3 * HOUR).toISOString() }),
  makeJob("old_bogota", { publishedAt: new Date(Date.now() - 10 * 24 * HOUR).toISOString() }),
  makeJob("maracaibo_fresh", { location: "Maracaibo, Zulia", country: "VE" }),
  makeJob("cross_co", {
    title: "Analista ZzHome entre países",
    location: "Barranquilla",
    country: "CO",
    publishedAt: new Date(Date.now() - 20 * HOUR).toISOString()
  }),
  makeJob("cross_ve", {
    title: "Analista ZzHome entre países",
    location: "Barranquilla",
    country: "VE",
    publishedAt: new Date(Date.now() - 4 * HOUR).toISOString()
  })
];

async function cleanupTestJobs(): Promise<void> {
  await pool.query(`DELETE FROM jobs WHERE url LIKE $1`, [`${TEST_URL_PREFIX}%`]);
}

let failures = 0;

function check(condition: boolean, pass: string, fail: string): void {
  if (condition) console.log(`✅ [PASSED] ${pass}`);
  else {
    console.error(`❌ [FAILED] ${fail}`);
    failures++;
  }
}

async function waitForServer(server: ChildProcess, maxAttempts = 80, delayMs = 250): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (server.exitCode !== null) throw new Error(`El servidor de prueba terminó con código ${server.exitCode}.`);
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`El servidor no respondió en ${maxAttempts * delayMs}ms`);
}

function startServer(): ChildProcess {
  const serverPath = path.join(__dirname, "..", "src", "server.ts");
  return spawn(process.execPath, [...process.execArgv, serverPath], {
    cwd: process.cwd(),
    shell: false,
    detached: false,
    stdio: "inherit",
    env: { ...process.env, PORT: String(TEST_PORT) }
  });
}

async function jobsTotal(country: string, extra: Record<string, string> = {}): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/jobs?${new URLSearchParams({ country, limit: "1", offset: "0", ...extra })}`);
  return ((await res.json()) as { total: number }).total;
}

async function validateCountry(country: string): Promise<void> {
  console.log(`\n--- /api/home-stats?country=${country} ---\n`);
  const res = await fetch(`${BASE_URL}/api/home-stats?country=${country}`);
  check(res.status === 200, `${country}: responde 200.`, `${country}: respondió ${res.status}.`);
  check(
    /^public, .*s-maxage=/.test(res.headers.get("cache-control") || ""),
    `${country}: respuesta completa cacheable en el borde (${res.headers.get("cache-control")}).`,
    `${country}: Cache-Control inesperado: ${res.headers.get("cache-control")}.`
  );
  const body = (await res.json()) as HomeData;

  check(body.totalJobs !== null && body.totalJobs > 0, `${country}: hay vacantes que contar (${body.totalJobs}).`, `${country}: totalJobs vacío — la prueba no compararía nada.`);
  const pairs: Array<[string, number | null, Record<string, string>]> = [
    ["totalJobs", body.totalJobs, {}],
    ["last7Days", body.last7Days, { freshness: "7d" }],
    ["last24Hours", body.last24Hours, { freshness: "24h" }],
    ["onSite", body.onSite, { modality: "presencial" }],
    ["remote", body.remote, { modality: "remoto" }]
  ];
  for (const [field, value, filter] of pairs) {
    const expected = await jobsTotal(country, filter);
    check(value === expected, `${country}: ${field} = ${value}, igual a /api/jobs.`, `${country}: ${field} = ${value}, /api/jobs dice ${expected}.`);
  }

  const cities = getHomeCities(country);
  check(
    JSON.stringify(Object.keys(body.cityCounts)) === JSON.stringify(cities),
    `${country}: cuenta exactamente las ciudades de la homepage.`,
    `${country}: ciudades inesperadas ${JSON.stringify(Object.keys(body.cityCounts))}.`
  );
  check(
    cities.slice(1).some((city) => (body.cityCounts[city] ?? 0) > 0) && (body.last24Hours ?? 0) > 0,
    `${country}: hay conteos no nulos fuera de la primera ciudad y en las últimas 24 h.`,
    `${country}: los datos sembrados no llegaron a las cifras — la comparación sería trivial.`
  );
  for (const city of cities) {
    const expected = await jobsTotal(country, { cities: city });
    check(
      body.cityCounts[city] === expected,
      `${country}: ${city} = ${body.cityCounts[city]}, igual a /api/jobs.`,
      `${country}: ${city} = ${body.cityCounts[city]}, /api/jobs dice ${expected}.`
    );
  }

  const latestRes = await fetch(`${BASE_URL}/api/jobs?${new URLSearchParams({ country, limit: "6", offset: "0" })}`);
  const latest = (await latestRes.json()) as { jobs: Array<{ jobId: string }> };
  check(
    JSON.stringify(body.latestJobs.map((job) => job.jobId)) === JSON.stringify(latest.jobs.map((job) => job.jobId)),
    `${country}: las ${body.latestJobs.length} vacantes recientes son las mismas y en el mismo orden que el dashboard.`,
    `${country}: vacantes recientes distintas al dashboard.`
  );
  check(
    body.latestJobs.every((job) => !("description" in job) && !("url" in job)),
    `${country}: las vacantes recientes solo traen los campos que la homepage muestra.`,
    `${country}: las vacantes recientes filtran campos de más.`
  );

  const companiesRes = await fetch(`${BASE_URL}/api/companies/search?${new URLSearchParams({ country, limit: "12", offset: "0" })}`);
  const companies = (await companiesRes.json()) as { companies: Array<{ company: string; count: number }>; total: number };
  check(
    body.totalCompanies === companies.total &&
      JSON.stringify(body.companies.map(({ company, count }) => [company, count])) ===
        JSON.stringify(companies.companies.map(({ company, count }) => [company, count])),
    `${country}: empresas (${body.totalCompanies}) y top 12 iguales al directorio.`,
    `${country}: empresas distintas al directorio (${body.totalCompanies} vs ${companies.total}).`
  );
}

async function run(): Promise<void> {
  await cleanupTestJobs();
  await saveJobs(SEED, "Test Home Stats");
  const server = startServer();
  try {
    await waitForServer(server);
    for (const country of ["CO", "VE"]) await validateCountry(country);

    for (const query of ["country=XX", "country=", ""]) {
      const res = await fetch(`${BASE_URL}/api/home-stats?${query}`);
      check(res.status === 400, `"${query || "(sin país)"}" responde 400 sin consultar la base.`, `"${query}" respondió ${res.status}.`);
    }
  } finally {
    server.kill("SIGTERM");
    await cleanupTestJobs();
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} verificación(es) de /api/home-stats fallaron.\n`);
    process.exit(1);
  }
  console.log("\n🎉 [TEST SUITE PASSED] /api/home-stats coincide con /api/jobs y /api/companies/search.\n");
  process.exit(0);
}

run().catch((error) => {
  console.error("❌ [FAILED]", error?.message || error);
  process.exit(1);
});
