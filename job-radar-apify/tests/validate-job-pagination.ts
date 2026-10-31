import "./require-isolated-database.js";
import {
  getJobById,
  getJobsPage,
  maskLockedFields,
  searchActiveCompanies
} from "../src/db/job-repository.js";
import { COMPANY_LOGO_DOMAINS } from "../src/data/company-logo-domains.js";
import { applyJobFilters, jobMatchesRole } from "../src/lib/job-filters.js";
import { buildSearchPlan, likeMatches, searchTitleText, sqlLowerText, sqlSearchTitle } from "../src/lib/job-search-intent.js";
import { pool } from "../src/db/client.js";

let failures = 0;

function check(condition: boolean, pass: string, fail: string): void {
  if (condition) console.log(`✅ ${pass}`);
  else {
    console.error(`❌ ${fail}`);
    failures++;
  }
}

async function run(): Promise<void> {
  console.log("\n--- Paginación acotada de vacantes (solo lectura) ---\n");
  const heapBefore = process.memoryUsage().heapUsed;
  const first = await getJobsPage({ filters: { country: "CO" }, limit: 24, offset: 0 });
  const heapDelta = process.memoryUsage().heapUsed - heapBefore;

  check(first.jobs.length <= 24, "La primera página trae como máximo 24 filas.", "La consulta ignoró el límite.");
  check(first.total >= first.jobs.length, "El total real acompaña la página.", "El total es menor que la página.");
  check(
    heapDelta < 64 * 1024 * 1024,
    `La página usó menos de 64 MB adicionales (${(heapDelta / 1024 / 1024).toFixed(1)} MB).`,
    `La consulta materializó demasiado heap (${(heapDelta / 1024 / 1024).toFixed(1)} MB).`
  );

  if (first.jobs.length > 0) {
    const cachedCopy = await getJobsPage({ filters: { country: "CO" }, limit: 24, offset: 0 });
    const originalTitle = cachedCopy.jobs[0].title;
    cachedCopy.jobs[0].title = "__mutated_by_caller__";
    cachedCopy.jobs[0].requirements?.push("__mutated_requirement__");
    const freshCopy = await getJobsPage({ filters: { country: "CO" }, limit: 24, offset: 0 });
    check(
      freshCopy.jobs[0].title === originalTitle &&
        !freshCopy.jobs[0].requirements?.includes("__mutated_requirement__"),
      "El caché acotado entrega copias aisladas a cada solicitud.",
      "Una mutación del paywall/cliente contaminó el resultado cacheado."
    );
  }

  if (first.jobs.length > 0) {
    const second = await getJobsPage({ filters: { country: "CO" }, limit: 24, offset: 24 });
    const firstIds = new Set(first.jobs.map((job) => job.jobId));
    check(
      second.jobs.every((job) => !firstIds.has(job.jobId)),
      "Dos páginas consecutivas no repiten vacantes.",
      "La paginación repitió al menos una vacante."
    );

    const sample = first.jobs[0];
    const detail = await getJobById(sample.jobId);
    check(detail?.jobId === sample.jobId, "El detalle canónico resuelve por id.", "El detalle canónico no resolvió.");

    if (sample.company) {
      const companyPage = await getJobsPage({
        filters: { country: "CO", company: sample.company },
        limit: 10,
        includeDetails: false
      });
      check(
        companyPage.jobs.every((job) => job.company === sample.company),
        "El filtro exacto de empresa se aplica dentro de PostgreSQL.",
        "El filtro de empresa devolvió una empresa distinta."
      );
    }
  }

  // Pages after the first come from 96-row blocks (getJobsPage): one cold
  // query must serve pages 2-4, and their rows/order/total must be exactly
  // what a direct query for the same range returns. A filter no other check
  // here uses keeps the cache cold for this part.
  {
    const filters = { country: "CO", freshness: "7d" };
    let queries = 0;
    const originalQuery = pool.query.bind(pool);
    (pool as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      queries++;
      return (originalQuery as (...a: unknown[]) => unknown)(...args);
    };
    let blockPages: Awaited<ReturnType<typeof getJobsPage>>[] = [];
    try {
      blockPages = [];
      for (const offset of [24, 48, 72]) {
        blockPages.push(await getJobsPage({ filters, limit: 24, offset, includeDetails: true }));
      }
    } finally {
      (pool as unknown as { query: unknown }).query = originalQuery;
    }
    check(queries === 1, "Las páginas 2-4 salen de una sola consulta (bloque de 96).", `Las páginas 2-4 hicieron ${queries} consultas.`);

    // limit 100 from offset 24 crosses the block, so it takes the direct path.
    const direct = await getJobsPage({ filters, limit: 100, offset: 24, includeDetails: true });
    const blockIds = blockPages.flatMap((page) => page.jobs.map((job) => job.jobId));
    const directIds = direct.jobs.slice(0, blockIds.length).map((job) => job.jobId);
    check(
      blockIds.length > 0 && JSON.stringify(blockIds) === JSON.stringify(directIds),
      `Las páginas por bloque (${blockIds.length} vacantes) coinciden en contenido y orden con la consulta directa.`,
      "Las páginas por bloque no coinciden con la consulta directa."
    );
    check(
      blockPages.every((page) => page.total === direct.total) && new Set(blockIds).size === blockIds.length,
      `Todas las páginas reportan el mismo total (${direct.total}) y no repiten vacantes.`,
      "Las páginas por bloque reportan totales distintos o repiten vacantes."
    );
    const beyond = await getJobsPage({ filters, limit: 24, offset: 24 * 40, includeDetails: true });
    check(
      beyond.jobs.length === 0 && beyond.total === direct.total,
      "Una página más allá del final devuelve 0 vacantes y el total real.",
      `Página fuera de rango: ${beyond.jobs.length} vacantes, total ${beyond.total}.`
    );
  }

  const companies = await searchActiveCompanies(
    "",
    "CO",
    5,
    0,
    Object.keys(COMPANY_LOGO_DOMAINS)
  );
  check(companies.companies.length <= 5, "Empresas también pagina en SQL.", "Empresas ignoró el límite.");

  const rolePage = await getJobsPage({
    filters: { country: "CO", roles: ["AI Engineer"] },
    limit: 20,
    includeDetails: false
  });
  check(
    rolePage.jobs.every((job) => jobMatchesRole("AI Engineer", job)),
    "La consulta SQL comparte la misma semántica de roles que jobMatchesRole().",
    "El filtro SQL por rol se desvió del matcher determinista."
  );

  // Job-family search (job-search-intent.ts): the same regexes must behave
  // identically in Postgres and JS, and SQL rows/order must equal the
  // in-memory filter over the same canonical set. Read-only.
  {
    const titles = [
      "Senior AI Engineer", "Ingeniero(a) de IA", "INGENIERO RESIDENTE DE OBRA", "Gerencia de Energía",
      "Auxiliar de cocina", "UX/UI Designer", "Ingeniería de Sistemas", "Analítica de Datos",
      "Logística y Distribución", "Machine Learning Engineer", "Data Centers Engineer", "Front Desk Agent"
    ];
    const patterns = Array.from(new Set(["AI Engineer", "UX", "ingeniero de sistemas", "data engineer", "logistica", "frontend"]
      .flatMap((query) => {
        const plan = buildSearchPlan(query)!;
        return [
          ...plan.families.flatMap((f) => [...f.match.like, ...f.match.stems, ...(f.exclude?.like ?? [])]),
          ...plan.exact.flatMap((p) => p.like),
          ...plan.core.flatMap((p) => p.like)
        ];
      })));
    const result = await pool.query(
      `SELECT t.title, ${sqlSearchTitle("t.title")} AS normalized, p.pattern,
              ${sqlSearchTitle("t.title")} LIKE p.pattern AS normalized_match,
              ${sqlLowerText("t.title")} LIKE p.pattern AS raw_match
       FROM unnest($1::text[]) AS t(title) CROSS JOIN unnest($2::text[]) AS p(pattern)`,
      [titles, patterns]
    );
    const mismatches = result.rows.filter(
      (row: { title: string; normalized: string; pattern: string; normalized_match: boolean; raw_match: boolean }) =>
        row.normalized !== searchTitleText(row.title) ||
        row.normalized_match !== likeMatches(searchTitleText(row.title), row.pattern) ||
        row.raw_match !== likeMatches(row.title.toLowerCase(), row.pattern)
    );
    check(
      mismatches.length === 0,
      `La normalización de títulos y los patrones LIKE coinciden en PostgreSQL y JS (${result.rows.length} pares).`,
      `PostgreSQL y JS difieren en ${mismatches.length} pares título/patrón.`
    );

    const corpus: Awaited<ReturnType<typeof getJobsPage>>["jobs"] = [];
    for (let offset = 0; offset < 2000; offset += 100) {
      const page = await getJobsPage({ filters: { country: "CO" }, limit: 100, offset, includeDetails: false });
      corpus.push(...page.jobs);
      if (page.jobs.length < 100) break;
    }
    for (const search of ["AI Engineer", "IA", "datos", "Bogotá", "ux"]) {
      const sqlPage = await getJobsPage({ filters: { country: "CO", search }, limit: 100, includeDetails: false });
      const expected = applyJobFilters(corpus, { search }).slice(0, 100).map((job) => job.jobId);
      check(
        JSON.stringify(sqlPage.jobs.map((job) => job.jobId)) === JSON.stringify(expected),
        `Búsqueda "${search}": SQL y filtro en memoria devuelven las mismas ${expected.length} vacantes en el mismo orden.`,
        `Búsqueda "${search}": SQL y filtro en memoria difieren.`
      );
    }
  }

  const synthetic = first.jobs.slice(0, 2).map((job) => ({ ...job, isLocked: true }));
  const visible = maskLockedFields(synthetic, "free");
  check(
    visible === synthetic && visible.every((job) => job.isLocked === false),
    "Con el paywall apagado no se clona el arreglo y se conserva la vista desbloqueada.",
    "maskLockedFields volvió a duplicar el arreglo o dejó filas bloqueadas."
  );

  await pool.end();
  if (failures > 0) process.exit(1);
  console.log("\n✅ Hotfix de paginación verificado sin escrituras.\n");
}

run().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
