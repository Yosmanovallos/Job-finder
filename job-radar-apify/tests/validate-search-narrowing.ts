import "./require-isolated-database.js";
import { queryJobsPageForParity } from "../src/db/job-repository.js";
import { pool } from "../src/db/client.js";
import { vacancyGroupKeySql } from "../src/lib/company-identity.js";

// A search reads only the identity groups that hold a matching row
// (job-repository.ts queryJobsPage). Proof that it changes nothing: every
// query below returns the same ids, in the same order, with the same total,
// with and without that narrowing. The fixture holds the rows that could
// break it: a canonical row that fails the filter while an older sibling
// passes it, country-only rows next to a city sibling, official postings,
// confidential employers, NULL company/location and one title in CO and VE.

const PREFIX = "https://www.example.com/job/narrow-";
const DIRECT_A = "00000000-0000-4000-8000-00000000a001";
const DIRECT_B = "00000000-0000-4000-8000-00000000a002";
const DIRECT_C = "00000000-0000-4000-8000-00000000a003";
const DIRECT_D = "00000000-0000-4000-8000-00000000a004";
const DIRECT_E = "00000000-0000-4000-8000-00000000a005";
const DIRECT_F = "00000000-0000-4000-8000-00000000a006";

let failures = 0;

function check(condition: boolean, pass: string, fail: string): void {
  if (condition) console.log(`✅ ${pass}`);
  else {
    console.error(`❌ ${fail}`);
    failures++;
  }
}

interface Row {
  key: string;
  title: string;
  company: string | null;
  location: string | null;
  country: "CO" | "VE";
  source: string;
  hoursAgo: number;
  description?: string | null;
  directJobId?: string;
  remoteType?: string;
}

const ROWS: Row[] = [
  // Same vacancy from two boards. The newest (canonical) row is LinkedIn in
  // "Medellín"; only the older Indeed row says "Antioquia" and is from Indeed.
  { key: "mkt-new", title: "Analista de Marketing Digital", company: "ZzNarrow Retail S.A.S.", location: "Medellín", country: "CO", source: "LinkedIn", hoursAgo: 2 },
  { key: "mkt-old", title: "Analista de marketing digital", company: "ZzNarrow Retail", location: "Medellin, Antioquia", country: "CO", source: "Indeed", hoursAgo: 30 },
  // Country-only board copy next to a real city sibling (dropped), and one
  // without a sibling (kept).
  { key: "cont-city", title: "Contador ZzNarrow", company: "ZzNarrow Finanzas", location: "Cali, Valle del Cauca", country: "CO", source: "LinkedIn", hoursAgo: 5 },
  { key: "cont-country", title: "Contador ZzNarrow", company: "ZzNarrow Finanzas", location: "Colombia", country: "CO", source: "Glassdoor", hoursAgo: 1 },
  { key: "cont-alone", title: "Contador Junior ZzNarrow", company: "ZzNarrow Finanzas", location: "Colombia", country: "CO", source: "Glassdoor", hoursAgo: 3 },
  // The same title and employer in both countries.
  { key: "vend-co", title: "Vendedor ZzNarrow", company: "ZzNarrow Global", location: "Bogotá, D.C.", country: "CO", source: "Computrabajo", hoursAgo: 4 },
  { key: "vend-ve", title: "Vendedor ZzNarrow", company: "ZzNarrow Global", location: "Caracas", country: "VE", source: "Computrabajo-VE", hoursAgo: 6 },
  { key: "vend-ve-country", title: "Vendedor ZzNarrow", company: "ZzNarrow Global", location: "Venezuela", country: "VE", source: "Jooble", hoursAgo: 1 },
  // Confidential employers keep their exact spelling; NULL company/location.
  { key: "conf-1", title: "Community Manager ZzNarrow", company: "Empresa Confidencial", location: "Bogotá", country: "CO", source: "Computrabajo", hoursAgo: 7 },
  { key: "conf-2", title: "Community Manager ZzNarrow", company: "Confidencial", location: "Bogotá", country: "CO", source: "elempleo", hoursAgo: 8 },
  { key: "null-co", title: "AI Engineer ZzNarrow", company: null, location: null, country: "CO", source: "LinkedIn", hoursAgo: 9 },
  { key: "null-loc", title: "AI Engineer ZzNarrow", company: "ZzNarrow Labs", location: null, country: "CO", source: "Torre", hoursAgo: 10, remoteType: "fully_remote" },
  // Freelance projects and hybrid/remote titles for the modality filters.
  { key: "wk-cm", title: "Community Manager para tienda online", company: "ZzNarrow Cliente", location: "Argentina", country: "CO", source: "Workana", hoursAgo: 3 },
  { key: "mkt-hyb", title: "Coordinador de Marketing (Híbrido) ZzNarrow", company: "ZzNarrow Retail", location: "Bogotá", country: "CO", source: "LinkedIn", hoursAgo: 11 },
  { key: "mkt-rem", title: "Especialista Marketing Remoto ZzNarrow", company: "ZzNarrow Retail", location: "Remoto", country: "CO", source: "elempleo", hoursAgo: 12 },
  // Official postings: same title/company/city with different descriptions
  // (two cards), identical descriptions (one card), no description (own id),
  // and a country-only official row next to a city sibling (kept: exempt).
  { key: "dir-a", title: "Analista Contable ZzNarrow", company: "ZzNarrow Oficial", location: "Bogotá", country: "CO", source: "ZzNarrow ATS", hoursAgo: 2, description: "Cuentas por pagar", directJobId: DIRECT_A },
  { key: "dir-b", title: "Analista Contable ZzNarrow", company: "ZzNarrow Oficial", location: "Bogotá", country: "CO", source: "ZzNarrow ATS", hoursAgo: 3, description: "Cuentas por cobrar", directJobId: DIRECT_B },
  { key: "dir-c", title: "Analista Contable ZzNarrow", company: "ZzNarrow Oficial", location: "Bogotá", country: "CO", source: "ZzNarrow ATS", hoursAgo: 4, description: "Cuentas por cobrar", directJobId: DIRECT_C },
  { key: "dir-d", title: "Analista Contable ZzNarrow", company: "ZzNarrow Oficial", location: "Bogotá", country: "CO", source: "ZzNarrow ATS", hoursAgo: 5, description: null, directJobId: DIRECT_D },
  { key: "dir-e", title: "Auxiliar de Bodega ZzNarrow", company: "ZzNarrow Oficial", location: "Colombia", country: "CO", source: "ZzNarrow ATS", hoursAgo: 1, description: "Bodega", directJobId: DIRECT_E },
  { key: "dir-f", title: "Auxiliar de Bodega ZzNarrow", company: "ZzNarrow Oficial", location: "Barranquilla", country: "CO", source: "ZzNarrow ATS", hoursAgo: 2, description: "Bodega", directJobId: DIRECT_F },
  // Inactive and expired rows never count.
  { key: "old", title: "Analista de Marketing Digital", company: "ZzNarrow Retail", location: "Medellín", country: "CO", source: "Magneto", hoursAgo: 24 * 40 }
];

const QUERIES: Array<{ name: string; filters: Record<string, unknown> }> = [];
const searches = [
  "AI Engineer", "community manager", "marketing", "markerting", "contador", "analista", "vendedor", "auxiliar",
  "zznarrow", "antioquia", "empresa confidencial", "analista contable", "ventas bogota", "zzzzqx"
];
for (const search of searches) {
  for (const country of ["CO", "VE", undefined]) QUERIES.push({ name: `${search} ${country ?? "*"}`, filters: { search, country } });
  for (const modality of ["remoto", "hibrido", "presencial"]) {
    QUERIES.push({ name: `${search} ${modality}`, filters: { search, country: "CO", modality } });
  }
}
QUERIES.push(
  { name: "analista + Indeed", filters: { search: "analista", country: "CO", sources: ["Indeed"] } },
  { name: "marketing + Medellín", filters: { search: "marketing", country: "CO", cities: ["Medellín"] } },
  { name: "marketing + 24h", filters: { search: "marketing", country: "CO", freshness: "24h" } },
  { name: "analista + rol", filters: { search: "analista", country: "CO", roles: ["Contador"] } },
  { name: "zznarrow + empresa", filters: { search: "zznarrow", company: "ZzNarrow Retail" } },
  // More hits than SEARCH_NARROW_MAX_HITS: the query reads every live row.
  { name: "zzbroad (amplia)", filters: { search: "zzbroad", country: "CO" } },
  { name: "zzbroad remoto (amplia)", filters: { search: "zzbroad", country: "CO", modality: "remoto" } }
);
const BROAD_ROWS = 10_050;

async function seed(): Promise<void> {
  await pool.query("DELETE FROM jobs WHERE url LIKE $1", [`${PREFIX}%`]);
  for (const row of ROWS) {
    await pool.query(
      `INSERT INTO jobs (url_hash, title, company, location, country, url, source, sources, published_at,
                         is_active, description, direct_job_id, remote_type)
       VALUES (md5($1), $2, $3, $4, $5, $1, $6::text, jsonb_build_array($6::text), NOW() - ($7::int * INTERVAL '1 hour'),
               TRUE, $8, $9, $10)`,
      [`${PREFIX}${row.key}`, row.title, row.company, row.location, row.country, row.source, row.hoursAgo,
        row.description ?? null, row.directJobId ?? null, row.remoteType ?? null]
    );
  }
  await pool.query("UPDATE jobs SET is_active = FALSE WHERE url = $1", [`${PREFIX}old`]);
  // Mostly pairs of board copies (same title/company/city, two sources), some remote.
  await pool.query(
    `INSERT INTO jobs (url_hash, title, company, location, country, url, source, sources, published_at, is_active)
     SELECT md5($1 || g), 'Operario Zzbroad ' || (g / 2) || CASE WHEN g % 7 = 0 THEN ' Remoto' ELSE '' END,
            'ZzBroad ' || ((g / 2) % 50), 'Cali', 'CO', $1 || g, CASE WHEN g % 2 = 0 THEN 'LinkedIn' ELSE 'Indeed' END,
            jsonb_build_array(CASE WHEN g % 2 = 0 THEN 'LinkedIn' ELSE 'Indeed' END), NOW() - (g * INTERVAL '1 minute'), TRUE
     FROM generate_series(1, $2::int) g`,
    [`${PREFIX}broad-`, BROAD_ROWS]
  );
}

async function pageIds(filters: Record<string, unknown>, narrow: boolean): Promise<{ ids: string[]; total: number }> {
  const ids: string[] = [];
  let total = 0;
  // Every page, not only the first: a wrong canonical row deeper in the list
  // must fail too.
  for (let offset = 0; offset < 2_000; offset += 100) {
    const page = await queryJobsPageForParity({ filters, limit: 100, offset, includeDetails: false }, narrow);
    total = page.total;
    ids.push(...page.jobs.map((job) => job.jobId));
    if (page.jobs.length < 100) break;
  }
  return { ids, total };
}

async function run(): Promise<void> {
  console.log("\n--- Búsqueda acotada a grupos coincidentes: paridad ---\n");
  await seed();

  const nullKeys = await pool.query(
    `SELECT COUNT(*)::int AS n FROM jobs
     WHERE ROW(${vacancyGroupKeySql()}) IS NOT NULL IS NOT TRUE`
  );
  check(
    nullKeys.rows[0].n === 0,
    "Ninguna fila tiene una clave de grupo NULL (un NULL la sacaría del IN).",
    `${nullKeys.rows[0].n} filas tienen alguna clave de grupo NULL.`
  );

  // The narrowed statement must really be the one under test.
  const captured: string[] = [];
  const query = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
  (pool as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = (...args: unknown[]) => {
    if (typeof args[0] === "string") captured.push(args[0]);
    return query(...args);
  };
  await queryJobsPageForParity({ filters: { search: "marketing", country: "CO" }, limit: 5 }, true);
  await queryJobsPageForParity({ filters: { country: "CO" }, limit: 5 }, true);
  (pool as unknown as { query: unknown }).query = query;
  check(
    captured[0]?.includes("search_hits") === true && captured[1]?.includes("search_hits") === false,
    "Solo la consulta con búsqueda lee search_hits; sin búsqueda el SQL no cambia.",
    "El acotamiento no se aplicó como se esperaba."
  );

  let nonEmpty = 0;
  for (const { name, filters } of QUERIES) {
    const narrowed = await pageIds(filters, true);
    const full = await pageIds(filters, false);
    if (full.total > 0) nonEmpty++;
    check(
      narrowed.total === full.total && JSON.stringify(narrowed.ids) === JSON.stringify(full.ids),
      `${name}: mismas ${full.total} vacantes en el mismo orden.`,
      `${name}: acotada ${narrowed.total} vs completa ${full.total} (o el orden difiere).`
    );
  }
  // Many combinations are empty on purpose (VE, typos, "zzzzqx"); the
  // fixture must still make a good share of them non-trivial.
  check(nonEmpty >= 30, `${nonEmpty} de ${QUERIES.length} consultas tienen resultados.`, `Solo ${nonEmpty} consultas tienen resultados: la prueba no cubre casi nada.`);

  // The tricky groups reached the result the way the full query decides.
  const indeed = await pageIds({ search: "analista", country: "CO", sources: ["Indeed"] }, true);
  check(indeed.total === 0, "Un hermano viejo que coincide no reemplaza al canónico que no coincide.", `analista+Indeed devolvió ${indeed.total}.`);
  const titles = async (search: string, company: string) =>
    (await queryJobsPageForParity({ filters: { search, country: "CO", company }, limit: 100, includeDetails: false }, true))
      .jobs.map((job) => `${job.title} @ ${job.location}`).sort();
  const official = await titles("zznarrow", "ZzNarrow Oficial");
  check(
    official.filter((title) => title.startsWith("Analista Contable")).length === 3 &&
      official.filter((title) => title.startsWith("Auxiliar de Bodega")).length === 2,
    "Oficiales: 3 tarjetas por descripción y la de «Colombia» se conserva junto a su ciudad.",
    `Oficiales: ${official.join(" | ")}`
  );
  const boards = await titles("contador", "ZzNarrow Finanzas");
  check(
    JSON.stringify(boards) === JSON.stringify(["Contador Junior ZzNarrow @ Colombia", "Contador ZzNarrow @ Cali, Valle del Cauca"]),
    "Bolsas: la copia «Colombia» con hermana en ciudad se descarta; la que no tiene hermana se queda.",
    `Bolsas: ${boards.join(" | ")}`
  );

  await pool.query("DELETE FROM jobs WHERE url LIKE $1", [`${PREFIX}%`]);
  if (failures > 0) throw new Error(`${failures} comprobaciones fallaron`);
  console.log("\nParidad de la búsqueda acotada: OK.");
}

try {
  await run();
} finally {
  await pool.end();
}
