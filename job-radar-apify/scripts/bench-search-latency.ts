/**
 * Search latency bench for /api/jobs (queryJobsPage) on a DISPOSABLE local
 * PostgreSQL. Never point it at production: it refuses any non-loopback URL,
 * only seeds a database that holds no `jobs` table yet, and refuses to run
 * from a directory with a .env (the db client would load it).
 *
 *   docker run -d --rm --name jr-bench --cpus 1 --memory 512m  *     -p 127.0.0.1:55499:5432 -e POSTGRES_USER=bench -e POSTGRES_PASSWORD=bench  *     -e POSTGRES_DB=bench <same pinned image as scripts/run-isolated-tests.ts>
 *   cd <any directory without .env>
 *   BENCH_DATABASE_URL=postgresql://bench:bench@127.0.0.1:55499/bench  *     npx tsx <repo>/scripts/bench-search-latency.ts seed
 *   BENCH_DATABASE_URL=... npx tsx <repo>/scripts/bench-search-latency.ts run [out.json]
 *
 * `run` captures the SQL queryJobsPage() sends for each query with and
 * without the search narrowing (the second is origin/main's SQL), then times
 * both statements alternately in the same process (BENCH_ROUNDS rounds,
 * default 9) and reports median and range, so machine noise hits both sides
 * alike. Parity: every page of both variants (ids, order, total) must match.
 */
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const mode = process.argv[2];
if (existsSync(path.join(process.cwd(), ".env"))) {
  throw new Error("Run this bench from a directory without a .env file.");
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface QueryCase {
  name: string;
  filters: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

const CASES: QueryCase[] = [
  ...["contador", "analista", "vendedor", "auxiliar", "desarrollador"].map((search) => ({
    name: `search=${search}`,
    filters: { country: "CO", search }
  })),
  { name: "search=AI Engineer", filters: { country: "CO", search: "AI Engineer" } },
  { name: "search=community manager", filters: { country: "CO", search: "community manager" } },
  { name: "search=marketing", filters: { country: "CO", search: "marketing" } },
  { name: "search=markerting", filters: { country: "CO", search: "markerting" } },
  { name: "search=bancolombia", filters: { country: "CO", search: "bancolombia" } },
  { name: "search=medellin", filters: { country: "CO", search: "medellin" } },
  { name: "search=ventas bogota", filters: { country: "CO", search: "ventas bogota" } },
  { name: "search=AI Engineer+remoto", filters: { country: "CO", search: "AI Engineer", modality: "remoto" } },
  { name: "search=contador+presencial", filters: { country: "CO", search: "contador", modality: "presencial" } },
  { name: "search=marketing+hibrido", filters: { country: "CO", search: "marketing", modality: "hibrido" } },
  { name: "search=desarrollador+freelance", filters: { country: "CO", search: "desarrollador", modality: "freelance" } },
  { name: "search=analista+24h", filters: { country: "CO", search: "analista", freshness: "24h" } },
  { name: "search=analista+Bogota", filters: { country: "CO", search: "analista", cities: ["Bogotá"] } },
  { name: "search=auxiliar+sources", filters: { country: "CO", search: "auxiliar", sources: ["LinkedIn"] } },
  { name: "search=vendedor VE", filters: { country: "VE", search: "vendedor" } },
  { name: "search=analista offset 24", filters: { country: "CO", search: "analista" }, offset: 24 },
  { name: "search=analista offset 120", filters: { country: "CO", search: "analista" }, offset: 120 },
  { name: "search=zzzz (none)", filters: { country: "CO", search: "zzzzqx" } },
  { name: "no search (dashboard)", filters: { country: "CO" } },
  { name: "modality only", filters: { country: "CO", modality: "remoto" } }
];

function benchUrl(): string {
  const url = process.env.BENCH_DATABASE_URL;
  if (!url) throw new Error("Set BENCH_DATABASE_URL to a disposable local PostgreSQL.");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error("BENCH_DATABASE_URL must be a loopback address; this bench never runs against production.");
  }
  return url;
}

async function seed(): Promise<void> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: benchUrl(), max: 1 });
  const exists = await pool.query("SELECT to_regclass('public.jobs') AS t");
  if (exists.rows[0].t) throw new Error("This database already has a jobs table; use a fresh container.");

  await pool.query(await readFile(path.join(root, "tests/fixtures/production-baseline.sql"), "utf8"));
  const schema = await readFile(path.join(root, "src/db/schema.sql"), "utf8");
  for (const block of ["job-archive", "job-seo-v2", "company-identity", "direct-projection"]) {
    const sql = new RegExp(`-- BEGIN ${block}\\r?\\n([\\s\\S]*?)-- END ${block}`).exec(schema)?.[1];
    if (!sql) throw new Error(`schema.sql has no ${block} block`);
    await pool.query(sql);
  }
  // Only the synthetic corpus below is measured.
  await pool.query("DELETE FROM jobs");

  const { DEFAULT_ROLES_200 } = await import("../src/queue/scheduler.js");
  const extraTitles = [
    "Contador Senior", "Contadora Junior", "Analista Contable", "Analista de Datos", "Analista Financiero",
    "Vendedor de Mostrador", "Vendedora Externa", "Asesor Comercial", "Auxiliar de Bodega", "Auxiliar Contable",
    "Desarrollador .NET", "Desarrolladora Frontend Remoto", "Machine Learning Engineer", "Ingeniero de IA",
    "Community Manager Freelance", "Especialista en Marketing", "Coordinador de Marketing Digital",
    "Ejecutivo de Ventas - Híbrido", "Operario de Producción", "Conductor", "Mensajero en Moto",
    "Asistente Administrativa (Trabajo remoto)", "Editor de video para TikTok", "Diseño de logo para tienda",
    "Gerente de Tienda", "Cajero", "Recepcionista Bilingüe", "Enfermera Jefe", "Médico General"
  ];
  const titles = [...DEFAULT_ROLES_200, ...extraTitles];
  const decor = ["", "", "", " Senior", " Junior", " - Bogotá", " (Híbrido)", " Remoto", " II", " Trainee", " Líder"];
  const cities = [
    "Bogotá, D.C., Colombia", "Medellín, Antioquia, Colombia", "Cali, Valle del Cauca", "Barranquilla", "Cartagena",
    "Bucaramanga, Santander", "Pereira", "Manizales", "Cúcuta", "Ibagué", "Santa Marta", "Villavicencio",
    "Pasto", "Montería", "Neiva", "Colombia", "Remoto", "Bogotá, D.C.", "Medellin", "Envigado", "Itagüí", "Soacha"
  ];
  const veCities = ["Caracas", "Maracaibo", "Valencia", "Barquisimeto", "Venezuela", "Maracay"];
  const sources = [
    ["LinkedIn", 30], ["Computrabajo", 25], ["Workana", 10], ["Indeed", 8], ["elempleo", 8], ["Magneto", 6],
    ["Jooble", 5], ["Torre", 3], ["GetOnBoard", 2], ["RemoteOK", 1], ["Remotive", 1], ["WeRemoto", 1]
  ] as const;
  const weighted = sources.flatMap(([name, weight]) => Array<string>(weight).fill(name));

  // ~47k active rows (≈ 30k CO canonical after dedupe, plus VE) and 8k
  // inactive/expired ones, with production-like description sizes.
  const total = 55_000;
  const batch = 2_500;
  for (let start = 0; start < total; start += batch) {
    const rows: unknown[][] = [];
    for (let i = start; i < Math.min(total, start + batch); i++) {
      const rnd = mulberry32(i + 1);
      const ve = rnd() < 0.12;
      // A duplicate reuses an earlier row's title/company/location from
      // another source, so DISTINCT ON has real groups to collapse.
      const base = rnd() < 0.18 && i > 100 ? Math.floor(rnd() * i) : i;
      const b = mulberry32(base * 7 + 3);
      const title = titles[Math.floor(b() * titles.length)] + decor[Math.floor(b() * decor.length)];
      const company = b() < 0.08 ? "Empresa Confidencial" : `Empresa ${Math.floor(b() * 4_000)}${b() < 0.3 ? " S.A.S." : ""}`;
      const location = ve ? veCities[Math.floor(b() * veCities.length)] : cities[Math.floor(b() * cities.length)];
      const source = weighted[Math.floor(rnd() * weighted.length)];
      const ageHours = Math.floor(rnd() * 24 * 34);
      const active = rnd() > 0.12;
      const words = 120 + Math.floor(rnd() * 300);
      const description = Array.from({ length: words }, (_, w) => LOREM[(i + w * 7) % LOREM.length]).join(" ");
      const remote = rnd() < 0.05 ? "fully_remote" : rnd() < 0.03 ? "hybrid" : null;
      rows.push([
        `bench-${i}`, title, company, location, ve ? "VE" : "CO", `https://example.invalid/bench/${i}`, source,
        JSON.stringify([source]), ageHours, active, description, remote
      ]);
    }
    const values: unknown[] = [];
    const tuples = rows.map((row) => {
      const p = row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(md5(${p[0]}), ${p[1]}, ${p[2]}, ${p[3]}, ${p[4]}, ${p[5]}, ${p[6]}, ${p[7]}::jsonb, ` +
        `NOW() - (${p[8]}::int * INTERVAL '1 hour'), ${p[9]}, ${p[10]}, ${p[11]})`;
    });
    await pool.query(
      `INSERT INTO jobs (url_hash, title, company, location, country, url, source, sources, published_at, is_active, description, remote_type)
       VALUES ${tuples.join(", ")}`,
      values
    );
  }
  // Official projections (direct_job_id): grouped by description, a few
  // without one, and some country-only next to a city sibling.
  await pool.query(
    `INSERT INTO jobs (url_hash, title, company, location, country, url, source, sources, published_at,
                       is_active, description, direct_job_id)
     SELECT md5('bench-direct-' || g), ($1::text[])[1 + g % array_length($1::text[], 1)], 'Oficial ' || (g % 60),
            CASE WHEN g % 10 = 0 THEN 'Colombia' ELSE (ARRAY['Bogotá', 'Medellín', 'Cali', 'Barranquilla'])[1 + g % 4] END,
            'CO', 'https://example.invalid/bench/direct/' || g, 'Oficial ATS', '["Oficial ATS"]'::jsonb,
            NOW() - ((g % 500) * INTERVAL '1 hour'), TRUE,
            CASE WHEN g % 7 = 0 THEN NULL WHEN g % 3 = 0 THEN 'Descripción compartida ' || (g % 40) ELSE 'Descripción ' || g END,
            gen_random_uuid()
     FROM generate_series(1, 1500) g`,
    [titles]
  );
  await pool.query("VACUUM ANALYZE jobs");
  const counts = await pool.query(
    "SELECT COUNT(*) FILTER (WHERE is_active) AS active, COUNT(*) AS total FROM jobs"
  );
  console.log(JSON.stringify({ seeded: counts.rows[0] }));
  await pool.end();
}

const LOREM = (
  "responsabilidades experiencia requisitos manejo de herramientas ofimáticas trabajo en equipo orientación al " +
  "logro atención al cliente salario competitivo prestaciones de ley contrato a término indefinido horario de " +
  "lunes a viernes conocimientos en excel inglés intermedio formación profesional técnica tecnológica ventas " +
  "metas indicadores reportes gestión de inventarios bodega logística servicio comunicación asertiva proactividad"
).split(" ");

function mulberry32(seedValue: number): () => number {
  let a = seedValue >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function run(outFile?: string): Promise<void> {
  process.env.DATABASE_URL = benchUrl();
  const { pool } = await import("../src/db/client.js");
  const { queryJobsPageForParity } = await import("../src/db/job-repository.js");
  const rounds = Number(process.env.BENCH_ROUNDS || 9);

  const captured: Array<{ text: string; values: unknown[] }> = [];
  const originalQuery = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
  (pool as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = (...args: unknown[]) => {
    if (typeof args[0] === "string") captured.push({ text: args[0], values: (args[1] as unknown[]) || [] });
    return originalQuery(...args);
  };
  const statementsFor = async (testCase: QueryCase, narrow: boolean) => {
    captured.length = 0;
    await queryJobsPageForParity({ filters: testCase.filters, limit: testCase.limit ?? 20, offset: testCase.offset ?? 0 }, narrow);
    return [...captured];
  };
  const allIds = async (testCase: QueryCase, narrow: boolean) => {
    const ids: string[] = [];
    let total = 0;
    for (let offset = 0; offset < 20_000; offset += 100) {
      const page = await queryJobsPageForParity({ filters: testCase.filters, limit: 100, offset, includeDetails: false }, narrow);
      total = page.total;
      ids.push(...page.jobs.map((job) => job.jobId));
      if (page.jobs.length < 100) break;
    }
    return { total, ids: ids.join(",") };
  };
  const timeStatements = async (statements: Array<{ text: string; values: unknown[] }>) => {
    const started = performance.now();
    for (const statement of statements) await originalQuery(statement.text, statement.values);
    return performance.now() - started;
  };

  const results = [];
  let mismatches = 0;
  console.log("| Consulta | Total | Antes mediana (rango) ms | Después mediana (rango) ms | Paridad (todas las páginas) |");
  console.log("| --- | ---: | ---: | ---: | --- |");
  for (const testCase of CASES) {
    const before = await statementsFor(testCase, false);
    const after = await statementsFor(testCase, true);
    const beforeMs: number[] = [];
    const afterMs: number[] = [];
    for (let round = 0; round < rounds; round++) {
      // Alternate which side goes first so neither always runs on a warmer cache.
      if (round % 2 === 0) {
        beforeMs.push(await timeStatements(before));
        afterMs.push(await timeStatements(after));
      } else {
        afterMs.push(await timeStatements(after));
        beforeMs.push(await timeStatements(before));
      }
    }
    const full = await allIds(testCase, false);
    const narrowed = await allIds(testCase, true);
    const same = full.total === narrowed.total && full.ids === narrowed.ids;
    if (!same) mismatches++;
    const fmt = (values: number[]) =>
      `${median(values).toFixed(0)} (${Math.min(...values).toFixed(0)}–${Math.max(...values).toFixed(0)})`;
    console.log(`| ${testCase.name} | ${full.total} | ${fmt(beforeMs)} | ${fmt(afterMs)} | ${same ? "idéntica" : "DISTINTA"} |`);
    let plan: string | undefined;
    if (process.env.BENCH_EXPLAIN === "1") {
      const explained = (await originalQuery(`EXPLAIN (ANALYZE, BUFFERS) ${after[0].text}`, after[0].values)) as {
        rows: Array<Record<string, string>>;
      };
      plan = explained.rows.map((row) => row["QUERY PLAN"]).join("\n");
    }
    results.push({ name: testCase.name, total: full.total, beforeMs, afterMs, same, plan });
  }
  if (outFile) await writeFile(outFile, JSON.stringify(results, null, 2));
  await pool.end();
  if (mismatches) {
    console.error(`${mismatches} consultas con resultados distintos`);
    process.exitCode = 1;
  }
}

if (mode === "seed") await seed();
else if (mode === "run") await run(process.argv[3]);
else throw new Error("Usage: bench-search-latency.ts seed | run [out.json]");
