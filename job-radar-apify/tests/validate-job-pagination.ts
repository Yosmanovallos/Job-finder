import {
  getJobById,
  getJobsPage,
  maskLockedFields,
  searchActiveCompanies
} from "../src/db/job-repository.js";
import { COMPANY_LOGO_DOMAINS } from "../src/data/company-logo-domains.js";
import { jobMatchesRole } from "../src/lib/job-filters.js";
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
