import "./require-isolated-database.js";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import dotenv from "dotenv";
import { getJobs, maskLockedFields } from "../src/db/job-repository.js";
import {
  slugify,
  escapeHtml,
  escapeJsonForScriptTag,
  isPubliclyDescribable,
  buildJobPath,
  buildJobUrl,
  buildJobPosting,
  buildJobMeta,
  buildJobsSitemapXml,
  buildSitemapIndexXml,
  isUuid,
  resolveCategorySlug,
  RETIRED_ROLE_SLUGS,
  buildCategoryMeta,
  buildCategoryInsights,
  buildCategoryInternalLinks,
  buildCategoryPath,
  buildCategoriesSitemapXml,
  buildJobUrlPrefix,
  SeoJob,
  SITE_URL
} from "../src/lib/job-seo.js";
import { CITY_OPTIONS } from "../src/lib/job-filters.js";
import { DEFAULT_ROLES_200 } from "../src/queue/scheduler.js";
import { COUNTRIES } from "../src/countries/index.js";
import { buildJwtAssertion } from "../src/lib/google-indexing.js";
import {
  enqueueIndexingNotifications,
  getPendingIndexingBatch,
  markIndexingSent,
  markIndexingFailed,
  getIndexingBudgetRemaining,
  wasJobPurged
} from "../src/db/indexing-repository.js";
import { pool } from "../src/db/client.js";
import { refreshGoogleReadiness } from "../src/db/job-readiness-repository.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Own port, separate from both the dev server (3000) and
// validate-paywall-auth.ts's (3979) — this suite never calls
// clearRepository()/saveJobs(), so it's read-only and safe to run
// alongside the app or another test, but a dedicated port still avoids any
// EADDRINUSE flakiness if something else is on 3000.
const TEST_PORT = Number(process.env.TEST_HTTP_PORT);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let failures = 0;

function check(condition: boolean, passMsg: string, failMsg: string) {
  if (condition) {
    console.log(`✅ [PASSED] ${passMsg}`);
  } else {
    console.error(`❌ [FAILED] ${failMsg}`);
    failures++;
  }
}

// --- Part 1: pure-function tests, no server/DB needed ----------------------

function runPureFunctionTests() {
  console.log(`\n--- Parte 1: funciones puras (slugify, escaping, JobPosting) ---\n`);

  check(
    slugify("Ingeniero(a) — Bogotá, D.C.") === "ingeniero-a-bogota-d-c",
    "slugify() limpia acentos, puntuación y mayúsculas.",
    `slugify() produjo "${slugify("Ingeniero(a) — Bogotá, D.C.")}", inesperado.`
  );

  check(
    slugify("") === "vacante",
    "slugify() de un string vacío cae al fallback 'vacante' en vez de una URL vacía.",
    "slugify('') no cayó al fallback esperado."
  );

  const evilTitle = `</script><img src=x onerror="alert(1)">&'"`;
  const escaped = escapeHtml(evilTitle);
  check(
    !escaped.includes("<") && !escaped.includes(">") && !escaped.includes('"'),
    'escapeHtml() neutraliza <, >, " en texto de vacantes potencialmente adversarial.',
    `escapeHtml() dejó pasar caracteres peligrosos: "${escaped}"`
  );

  const evilJson = escapeJsonForScriptTag({ t: "</script><script>alert(1)</script>" });
  check(
    !evilJson.includes("</script>"),
    "escapeJsonForScriptTag() impide que un título con '</script>' cierre el bloque JSON-LD antes de tiempo.",
    `escapeJsonForScriptTag() todavía contiene "</script>": ${evilJson}`
  );

  // Job SEO V2 (docs/JOBPOSTING-GOOGLE-CONTRACT.md): the assertions this
  // block used to make — a synthetic validThrough = published + 30 d, a
  // BuscoTrabajo template description with company counts, bare "Remoto" →
  // TELECOMMUTE with a defaulted country, skills/qualifications split from
  // every list item — are exactly what the V2 contract retires. They are
  // replaced by their V2 equivalents below; the full per-fixture contract
  // (and the four-consumer agreement) lives in validate-google-readiness.test.ts.
  const openJob: SeoJob = {
    jobId: "test-open-1",
    title: "Analista de Datos",
    company: "PepsiCo",
    location: "Bogotá",
    country: "CO",
    url: "https://example.com/job/1",
    dateText: "Hoy",
    source: "LinkedIn",
    publishedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    description:
      "Buscamos un/a Analista de Datos para el equipo de BI de la compañía.\nSerás responsable de los tableros comerciales y del modelo de datos de ventas.",
    requirements: ["Manejo de SQL avanzado", "Experiencia con Power BI", "Inglés intermedio"],
    employmentType: "Tiempo completo",
    seoReady: true,
    isActive: true
  };

  check(
    isPubliclyDescribable(openJob),
    "Una vacante con company/location/url presentes se considera públicamente describible (visible para el usuario).",
    "isPubliclyDescribable() rechazó una vacante completa."
  );

  const posting = buildJobPosting(openJob) as any;
  check(
    posting !== null,
    "buildJobPosting() genera JobPosting para una vacante apta para Google.",
    "buildJobPosting() devolvió null para una vacante apta para Google."
  );
  if (posting) {
    const requiredKeys = [
      "title",
      "description",
      "datePosted",
      "hiringOrganization",
      "jobLocation"
    ];
    const missing = requiredKeys.filter((k) => !(k in posting));
    check(
      missing.length === 0,
      "El JobPosting incluye los campos requeridos por Google (title, description, datePosted, hiringOrganization, jobLocation).",
      `Faltan campos requeridos por Google en el JobPosting: ${missing.join(", ")}`
    );
    check(
      !("validThrough" in posting),
      "Sin vencimiento publicado por la fuente, el JobPosting omite validThrough (ya no se inventa published + 30 días).",
      "El JobPosting emitió un validThrough sin que la fuente lo publicara."
    );
    check(
      String(posting.description).startsWith("<p>Buscamos") &&
        String(posting.description).includes("<ul><li>Manejo de SQL avanzado</li>") &&
        !String(posting.description).includes("Vacante agregada de") &&
        !String(posting.description).includes("vacantes más activas"),
      "La descripción del JobPosting es HTML con solo el texto de la fuente — sin plantilla ni conteos de BuscoTrabajo.",
      `La descripción del JobPosting no es la de la fuente: "${posting.description}"`
    );
    check(
      posting.employmentType === "FULL_TIME" &&
        !("skills" in posting) &&
        !("qualifications" in posting) &&
        !("baseSalary" in posting),
      "employmentType usa el token schema.org; no se emiten skills/qualifications derivados ni baseSalary.",
      `JobPosting con campos inesperados: ${JSON.stringify(posting)}`
    );
  }

  const thinJob: SeoJob = {
    ...openJob,
    jobId: "test-thin-1",
    description: undefined,
    requirements: [],
    seoReady: false
  };
  check(
    buildJobPosting(thinJob) === null && isPubliclyDescribable(thinJob),
    "Una vacante visible pero no apta para Google (sin descripción) conserva su página pero no emite JobPosting.",
    "Una vacante no apta para Google emitió JobPosting, o dejó de ser visible."
  );

  // Locked (masked) job — same shape maskLockedFields() produces for a
  // <48h job when PAYWALL_ENABLED is true: company/location/url nulled out.
  const lockedJob: SeoJob = {
    ...openJob,
    jobId: "test-locked-1",
    company: null as any,
    location: null as any,
    url: null as any
  };
  check(
    !isPubliclyDescribable(lockedJob),
    "Una vacante enmascarada (bloqueada) NO se considera públicamente describible.",
    "isPubliclyDescribable() aceptó una vacante con company/location/url en null — riesgo de cloaking."
  );
  check(
    buildJobPosting(lockedJob) === null,
    "buildJobPosting() devuelve null para una vacante bloqueada — nunca se emite JobPosting con datos que un visitante anónimo no vería.",
    "buildJobPosting() generó un JobPosting para una vacante bloqueada."
  );

  // Remote: "Remoto" text alone is not evidence. Only a source-stated 100%
  // remote job with source-stated eligible countries gets TELECOMMUTE; the
  // country is never defaulted from the tick that discovered the job.
  const bareRemoteJob: SeoJob = { ...openJob, location: "Remoto", country: null, seoReady: false };
  check(
    buildJobPosting(bareRemoteJob) === null,
    "location='Remoto' sin evidencia de la fuente no emite JobPosting (ni TELECOMMUTE con un país supuesto).",
    "Una vacante 'Remoto' sin evidencia emitió JobPosting."
  );
  const statedRemoteJob: SeoJob = {
    ...openJob,
    location: "Remoto",
    country: null,
    remoteType: "fully_remote",
    applicantCountries: ["VE"]
  };
  const statedRemotePosting = buildJobPosting(statedRemoteJob) as any;
  check(
    statedRemotePosting?.jobLocationType === "TELECOMMUTE" &&
      statedRemotePosting.applicantLocationRequirements?.[0]?.name === "Venezuela" &&
      !("jobLocation" in statedRemotePosting),
    "Una vacante 100% remota según la fuente, con país elegible declarado, emite TELECOMMUTE + ese país.",
    `JobPosting remoto con forma inesperada: ${JSON.stringify(statedRemotePosting)}`
  );

  const adversarialJob: SeoJob = { ...openJob, title: `</script><script>alert(1)</script>` };
  const adversarialPosting = buildJobPosting(adversarialJob);
  const serialized = escapeJsonForScriptTag(adversarialPosting);
  check(
    !serialized.includes("</script>"),
    "Un título con '</script>' embebido en un JobPosting real sigue siendo seguro de insertar en un <script> tag.",
    "El JSON-LD serializado de un título adversarial contiene '</script>' sin escapar."
  );

  const path1 = buildJobPath(openJob);
  check(
    path1.startsWith(`/empleos/${openJob.jobId}/`),
    "buildJobPath() usa el jobId (no el slug) como segmento de matching.",
    `buildJobPath() no comienza con /empleos/${openJob.jobId}/: ${path1}`
  );

  const meta = buildJobMeta(openJob);
  check(
    meta.title.includes(openJob.title) && meta.canonicalUrl.includes(openJob.jobId),
    "buildJobMeta() produce un título y canonical consistentes con la vacante.",
    "buildJobMeta() produjo metadata inconsistente."
  );

  // --- Vencimiento (Fase 5) ---
  // Deliberately a substring check, not .startsWith(): buildJobUrlPrefix()
  // is used as a LIKE '%segment%' match (see indexing-repository.ts's
  // wasJobPurged), not a literal URL prefix — a Venezuela job's real URL is
  // "https://.../ve/empleos/<id>/...", which a fixed leading prefix could
  // never match while still working for Colombia's "https://.../empleos/<id>/...".
  // jobId (a UUID) is unique regardless of country, so matching the segment
  // anywhere in the URL is what actually stays correct for both.
  const prefix = buildJobUrlPrefix(openJob.jobId);
  check(
    prefix === `/empleos/${openJob.jobId}/` && buildJobUrl(openJob).includes(prefix),
    "buildJobUrlPrefix() produce el segmento contenido en la URL real de la vacante.",
    `buildJobUrlPrefix("${openJob.jobId}") produjo "${prefix}", no está contenido en buildJobUrl(): "${buildJobUrl(openJob)}"`
  );

  // --- Sitemap (Fase 2) ---
  const sitemapXml = buildJobsSitemapXml([openJob, lockedJob, thinJob]);
  check(
    sitemapXml.includes(openJob.jobId) &&
      !sitemapXml.includes(lockedJob.jobId) &&
      !sitemapXml.includes(thinJob.jobId),
    "buildJobsSitemapXml() incluye solo vacantes aptas para Google (excluye bloqueadas y no aptas).",
    "buildJobsSitemapXml() listó una vacante bloqueada o no apta, o no listó la apta."
  );
  const sitemapXmlAdversarial = buildJobsSitemapXml([adversarialJob]);
  check(
    !sitemapXmlAdversarial.includes("<script>"),
    "Un título adversarial no inyecta markup en el sitemap XML (el título no va en <loc>, solo la URL, ya generada por slugify).",
    "El sitemap XML contiene contenido sin escapar de un título adversarial."
  );

  const indexXml = buildSitemapIndexXml([
    "https://buscotrabajo.co/sitemap-pages.xml",
    "https://buscotrabajo.co/sitemap-jobs.xml"
  ]);
  check(
    indexXml.includes("<sitemapindex") && indexXml.includes("sitemap-jobs.xml"),
    "buildSitemapIndexXml() genera un índice válido que referencia el sitemap de vacantes.",
    "buildSitemapIndexXml() no generó la estructura esperada."
  );

  // --- Category pages (Fase 4) ---
  check(
    isUuid("e582c93b-bb2f-4dba-b983-647aedda5510") &&
      !isUuid("bogota") &&
      !isUuid("analista-de-datos"),
    "isUuid() distingue un jobId real de un slug de categoría.",
    "isUuid() no distinguió correctamente un UUID real de un slug de categoría."
  );

  const realCity = CITY_OPTIONS[0];
  const citySlug = slugify(realCity);
  const cityMatch = resolveCategorySlug(citySlug);
  check(
    cityMatch?.kind === "ciudad" && cityMatch.label === realCity && cityMatch.country === "CO",
    `resolveCategorySlug("${citySlug}") resuelve a la ciudad real "${realCity}" (Colombia).`,
    `resolveCategorySlug("${citySlug}") no resolvió a la ciudad esperada: ${JSON.stringify(cityMatch)}`
  );

  const realVeCity = COUNTRIES.VE.cities[0];
  const veCitySlug = slugify(realVeCity);
  const veCityMatch = resolveCategorySlug(veCitySlug);
  check(
    veCityMatch?.kind === "ciudad" &&
      veCityMatch.label === realVeCity &&
      veCityMatch.country === "VE",
    `resolveCategorySlug("${veCitySlug}") resuelve a la ciudad venezolana real "${realVeCity}" con country="VE", sin necesidad de prefijo.`,
    `resolveCategorySlug("${veCitySlug}") no resolvió a la ciudad venezolana esperada: ${JSON.stringify(veCityMatch)}`
  );

  const realRole = DEFAULT_ROLES_200[0];
  const roleSlug = slugify(realRole);
  const roleMatchCO = resolveCategorySlug(roleSlug);
  check(
    roleMatchCO?.kind === "rol" && roleMatchCO.label === realRole && roleMatchCO.country === "CO",
    `resolveCategorySlug("${roleSlug}") sin requestCountry resuelve al rol real "${realRole}" con country="CO" por defecto.`,
    `resolveCategorySlug("${roleSlug}") no resolvió al rol esperado: ${JSON.stringify(roleMatchCO)}`
  );

  const roleMatchVE = resolveCategorySlug(roleSlug, "VE");
  check(
    roleMatchVE?.kind === "rol" && roleMatchVE.label === realRole && roleMatchVE.country === "VE",
    `resolveCategorySlug("${roleSlug}", "VE") resuelve el MISMO rol con country="VE" — misma etiqueta, país distinto, para dos páginas separadas (ver ResolvedCategory).`,
    `resolveCategorySlug("${roleSlug}", "VE") no propagó el country solicitado: ${JSON.stringify(roleMatchVE)}`
  );

  check(
    resolveCategorySlug("esto-no-existe-como-categoria") === null,
    "resolveCategorySlug() devuelve null para un slug que no matchea ninguna ciudad ni rol — evita páginas doorway.",
    "resolveCategorySlug() devolvió un match para un slug inventado."
  );

  check(
    buildCategoryPath(cityMatch!) === `/empleos/${citySlug}` &&
      buildCategoryPath(veCityMatch!) === `/empleos/${veCitySlug}`,
    "buildCategoryPath() genera la ruta plana /empleos/<slug> para CUALQUIER ciudad (CO o VE), sin prefijo — el nombre de la ciudad ya es inequívoco.",
    `buildCategoryPath() produjo rutas inesperadas: CO=${buildCategoryPath(cityMatch!)}, VE=${buildCategoryPath(veCityMatch!)}`
  );

  check(
    buildCategoryPath(roleMatchCO!) === `/empleos/${roleSlug}` &&
      buildCategoryPath(roleMatchVE!) === `/ve/empleos/${roleSlug}`,
    "buildCategoryPath() SÍ prefija con /ve las páginas de ROL para Venezuela (mismo slug, país distinto → URLs distintas, para no mezclar bajo una sola).",
    `buildCategoryPath() no distinguió las rutas de rol por país: CO=${buildCategoryPath(roleMatchCO!)}, VE=${buildCategoryPath(roleMatchVE!)}`
  );

  const cityMeta = buildCategoryMeta(cityMatch!, 42);
  check(
    cityMeta.title.includes(realCity) &&
      cityMeta.title.includes("Trabajo en") &&
      cityMeta.title.includes("vacantes de empleo") &&
      cityMeta.description.includes("42 vacantes") &&
      cityMeta.canonicalUrl.endsWith(buildCategoryPath(cityMatch!)),
    "buildCategoryMeta() orienta el título de ciudad a 'trabajo en' + 'vacantes de empleo', conserva el conteo real en la descripción y usa un canonical consistente.",
    `buildCategoryMeta(cityMatch, 42) produjo metadata inconsistente: ${JSON.stringify(cityMeta)}`
  );

  const emptyRoleMeta = buildCategoryMeta(roleMatchCO!, 0);
  check(
    emptyRoleMeta.description.includes("0 vacantes") && emptyRoleMeta.heading.includes("Colombia"),
    "buildCategoryMeta() nunca infla el conteo — una categoría vacía dice '0 vacantes', no un número inventado — y el heading de un rol dice el país real.",
    `buildCategoryMeta(roleMatchCO, 0) no reportó 0 vacantes o el país esperado: ${emptyRoleMeta.description} / ${emptyRoleMeta.heading}`
  );

  const veRoleMeta = buildCategoryMeta(roleMatchVE!, 3);
  check(
    veRoleMeta.heading.includes("Venezuela") &&
      !veRoleMeta.heading.includes("Colombia") &&
      !veRoleMeta.description.includes("Elempleo"),
    "buildCategoryMeta() para un rol en Venezuela dice 'en Venezuela' (no Colombia) y no reclama fuentes sin adaptador VE (Elempleo).",
    `buildCategoryMeta(roleMatchVE, 3) produjo metadata incorrecta para Venezuela: ${JSON.stringify(veRoleMeta)}`
  );

  const insightJobs: SeoJob[] = [
    {
      ...openJob,
      company: "Empresa Real",
      location: realCity,
      source: "LinkedIn",
      sources: ["LinkedIn", "Indeed"],
      remoteType: "onsite",
      publishedAt: "2026-09-25T12:00:00.000Z"
    },
    {
      ...openJob,
      jobId: crypto.randomUUID(),
      title: "Analista remoto",
      company: "Empresa Real",
      location: "Remoto",
      source: "Computrabajo",
      sources: ["Computrabajo"],
      remoteType: "fully_remote",
      publishedAt: "2026-09-10T12:00:00.000Z"
    }
  ];
  const insights = buildCategoryInsights(
    cityMatch!,
    42,
    insightJobs,
    new Date("2026-09-26T12:00:00.000Z")
  );
  check(
    insights.visibleCount === 2 &&
      insights.companyCount === 1 &&
      insights.sources.length === 3 &&
      insights.freshLast7Days === 1 &&
      insights.modalities.some((item) => item.label === "Presencial" && item.count === 1) &&
      insights.modalities.some((item) => item.label === "Remoto" && item.count === 1) &&
      insights.intro.includes("42 vacantes activas") &&
      insights.intro.includes("las 2 ofertas más recientes"),
    "buildCategoryInsights() deriva empresas, fuentes, modalidades y frescura únicamente de la muestra real, sin extrapolar sus 2 filas al total de 42.",
    `buildCategoryInsights() produjo cifras inesperadas: ${JSON.stringify(insights)}`
  );

  const categoryLinks = buildCategoryInternalLinks(cityMatch!);
  check(
    categoryLinks.some((link) => link.href === "/dashboard") &&
      categoryLinks.some((link) => link.href === "/empresas") &&
      categoryLinks.every(
        (link) => link.label.includes("Colombia") || link.label.includes("BuscoTrabajo")
      ),
    "buildCategoryInternalLinks() enlaza desde una ciudad de Colombia a los hubs reales de vacantes, empresas e inicio.",
    `buildCategoryInternalLinks() produjo enlaces inesperados: ${JSON.stringify(categoryLinks)}`
  );

  const categoriesSitemapXml = buildCategoriesSitemapXml();
  const categoryLocs = [...categoriesSitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)];
  const expectedCount =
    CITY_OPTIONS.length + COUNTRIES.VE.cities.length + DEFAULT_ROLES_200.length * 2;
  check(
    categoryLocs.length === expectedCount &&
      categoriesSitemapXml.includes(buildCategoryPath(cityMatch!)) &&
      categoriesSitemapXml.includes(buildCategoryPath(veCityMatch!)) &&
      categoriesSitemapXml.includes(buildCategoryPath(roleMatchCO!)) &&
      categoriesSitemapXml.includes(buildCategoryPath(roleMatchVE!)),
    `buildCategoriesSitemapXml() lista exactamente ${expectedCount} URLs (${CITY_OPTIONS.length} ciudades CO + ${COUNTRIES.VE.cities.length} ciudades VE + ${DEFAULT_ROLES_200.length} roles CO + ${DEFAULT_ROLES_200.length} roles VE), incluyendo ambos países.`,
    `buildCategoriesSitemapXml() listó ${categoryLocs.length} URLs, se esperaban ${expectedCount}.`
  );
}

// --- Part 2: real HTTP checks against a spawned server, read-only DB -------

// maxAttempts bumped 40->80 (2026-08-12): cold tsx startup crossed the old
// 10s budget once src/index.ts/job-repository.ts grew with the ported
// job-detail-enrichment pipeline (measured live: consistently ~10-12s to
// serve /api/health now, previously well under 10s) — the server itself
// isn't slower to RUN, just slower to transpile cold.
async function waitForServer(server: ChildProcess, maxAttempts = 80, delayMs = 250): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`El servidor de prueba terminó con código ${server.exitCode}.`);
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
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

function killServerTree(server: ChildProcess): void {
  if (server.pid) {
    try {
      server.kill("SIGTERM");
    } catch {
      // Group may already be gone.
    }
  }
}

async function runHttpTests() {
  console.log(
    `\n--- Parte 2: HTTP real contra el servidor (base desechable del runner aislado) ---\n`
  );

  // Job SEO V2: the synthetic fixture jobs carry a one-line description, so
  // they are user-visible but NOT Google-ready. One of them is promoted
  // through the real gate (a real multi-paragraph description + the shared
  // evaluator) so the JobPosting/sitemap path is exercised; another stays thin
  // so the noindex path is too. This runs only against the runner's
  // disposable PostgreSQL (require-isolated-database), never production.
  const fixtureRows = await pool.query<{ id: string }>(
    `SELECT id FROM jobs WHERE is_active AND country = 'CO' AND location = 'Bogotá, Colombia' ORDER BY id LIMIT 2`
  );
  const [readyId, thinId] = fixtureRows.rows.map((row) => row.id);
  if (readyId) {
    await pool.query(
      `UPDATE jobs SET description = $2, requirements = $3::jsonb, detail_status = 'complete', description_kind = 'full'
       WHERE id = $1`,
      [
        readyId,
        "Buscamos analista de datos para el equipo de riesgo.\nConstruirás tableros de seguimiento de cartera y reportes mensuales para el comité.",
        JSON.stringify([
          "Profesional en estadística o afines.",
          "Dos años de experiencia con SQL.",
          "Power BI."
        ])
      ]
    );
    await refreshGoogleReadiness(readyId, { contentObtained: true });
  }
  if (thinId) await refreshGoogleReadiness(thinId);

  const rawJobs = await getJobs(200);
  const visibleJobs = maskLockedFields(rawJobs, "free");
  const realJob = visibleJobs.find(
    (j) => j.jobId === readyId && isPubliclyDescribable(j as SeoJob)
  );
  const thinJob = visibleJobs.find((j) => j.jobId === thinId);

  if (!realJob) {
    console.warn(
      `⚠️ [SKIPPED] No hay ninguna vacante activa y desbloqueada en la base de datos para probar contra un servidor real — ` +
        `esto es normal en un entorno recién creado sin datos scrapeados aún. Las pruebas de funciones puras (Parte 1) ya cubrieron la lógica.`
    );
    return;
  }

  const server = startServer();
  try {
    await waitForServer(server);

    // Regression: existing routes must be completely unaffected.
    for (const route of ["/", "/dashboard", "/api/health", "/api/jobs"]) {
      const res = await fetch(`${BASE_URL}${route}`);
      check(
        res.status === 200,
        `${route} sigue respondiendo 200 sin cambios.`,
        `${route} respondió ${res.status} — regresión.`
      );
    }

    // SEO Fase 9 (docs/SEO-PLAN.md §9.3/§5.7 risk 1): "/" and "/ve" must
    // each self-reference their own canonical (not both pointing at "/",
    // which told Google to consolidate "/ve" away) and carry the same
    // reciprocal hreflang pair + x-default.
    const homeHtml = await (await fetch(`${BASE_URL}/`)).text();
    const veHtml = await (await fetch(`${BASE_URL}/ve`)).text();
    check(
      homeHtml.includes(`<link rel="canonical" href="${SITE_URL}/" />`),
      "/ canonical se auto-referencia a la home.",
      "/ no tiene el canonical self-referencing esperado."
    );
    check(
      veHtml.includes(`<link rel="canonical" href="${SITE_URL}/ve" />`),
      "/ve canonical se auto-referencia a /ve (ya no apunta a la home de Colombia).",
      "/ve todavía no tiene canonical self-referencing — sigue apuntando a la home, el bug de consolidación de docs/SEO-PLAN.md §5.7."
    );
    for (const html of [homeHtml, veHtml]) {
      const hasCo = html.includes(`hreflang="es-CO" href="${SITE_URL}/"`);
      const hasVe = html.includes(`hreflang="es-VE" href="${SITE_URL}/ve"`);
      const hasDefault = html.includes(`hreflang="x-default" href="${SITE_URL}/"`);
      check(
        hasCo && hasVe && hasDefault,
        "El par hreflang recíproco (es-CO, es-VE, x-default) está presente.",
        `Falta algún hreflang esperado (es-CO=${hasCo}, es-VE=${hasVe}, x-default=${hasDefault}).`
      );
    }
    check(
      homeHtml.includes("<title>Busco trabajo en Colombia | Vacantes de empleo | BuscoTrabajo</title>") &&
        homeHtml.includes("<h1>Busco trabajo en Colombia: vacantes de empleo en un solo lugar</h1>") &&
        veHtml.includes("<title>Busco trabajo en Venezuela | Vacantes de empleo | BuscoTrabajo</title>") &&
        veHtml.includes("<h1>Busco trabajo en Venezuela: vacantes de empleo en un solo lugar</h1>") &&
        veHtml.includes('"alternateName": ["Busco Trabajo", "BuscoTrabajo.co"]'),
      "/ y /ve orientan title/H1 a la intención exacta 'busco trabajo', conservan el país correcto y declaran el nombre alternativo de marca.",
      "La portada de Colombia o Venezuela no sirve el nuevo title/H1 de intención, o falta alternateName en el HTML crudo."
    );

    // /dashboard must ship real vacancy links in its raw HTML, not rely on
    // the browser's fetch() to /api/jobs. Confirmed via Search Console
    // (2026-07-29) that Google's own rendered snapshot showed "0 de 0
    // vacantes" before this — the crawler's render budget ran out before
    // that client-side fetch resolved. Checking for the literal empty-state
    // string, not just "contains a job title", catches a regression back to
    // that exact failure mode even if something else in the markup changes.
    const dashboardRes = await fetch(`${BASE_URL}/dashboard`);
    const dashboardHtml = await dashboardRes.text();
    const dashboardJobLinks = (dashboardHtml.match(/href="\/empleos\//g) || []).length;
    const dashboardCacheControl = dashboardRes.headers.get("cache-control") || "";
    check(
      dashboardCacheControl.includes("s-maxage=300"),
      "/dashboard permite caché corta en el edge sin volver obsoletas las vacantes.",
      `/dashboard no declara la caché compartida esperada: "${dashboardCacheControl}".`
    );
    check(
      ["br", "gzip"].includes(dashboardRes.headers.get("content-encoding") || ""),
      "/dashboard se comprime antes de salir del servicio web.",
      "/dashboard salió sin Content-Encoding br/gzip."
    );
    check(
      dashboardJobLinks > 0,
      `/dashboard incluye ${dashboardJobLinks} links reales a /empleos/ directamente en el HTML crudo.`,
      "/dashboard no tiene ningún link a /empleos/ en el HTML crudo — un crawler lento vería la página vacía, igual que le pasó a Google antes de este fix."
    );
    check(
      !dashboardHtml.includes("No se encontraron vacantes"),
      "/dashboard no muestra el mensaje de 'sin resultados' en su HTML crudo.",
      "/dashboard todavía muestra 'No se encontraron vacantes' en el HTML crudo — el bug original de la Fase 0 (sección 5.3 de SEO-PLAN.md) volvió."
    );

    // window.__SSR_JOBS__ is what lets an anonymous first load skip its own
    // redundant fetch to /api/jobs (Dashboard.tsx reads this directly) —
    // must be present and valid JSON, or that optimization silently stops
    // working and falls back to a normal (still correct, just slower) fetch.
    const ssrJobsMatch = dashboardHtml.match(/window\.__SSR_JOBS__=(.*?);<\/script>/);
    check(
      ssrJobsMatch !== null,
      "/dashboard embebe window.__SSR_JOBS__ en su HTML crudo.",
      "/dashboard no tiene el script de window.__SSR_JOBS__ — Dashboard.tsx haría un fetch redundante en cada carga anónima."
    );
    if (ssrJobsMatch) {
      try {
        const parsed = JSON.parse(ssrJobsMatch[1]);
        check(
          Array.isArray(parsed.jobs) && parsed.jobs.length > 0 && typeof parsed.total === "number",
          `window.__SSR_JOBS__ trae ${parsed.jobs.length} vacantes reales y un total válido.`,
          "window.__SSR_JOBS__ existe pero no tiene la forma esperada (jobs[]/total)."
        );
      } catch {
        check(false, "", "window.__SSR_JOBS__ no es JSON válido.");
      }
    }

    const entryAssetPath = dashboardHtml.match(
      /<script[^>]+type=["']module["'][^>]+src=["']([^"']+\.js)["']/
    )?.[1];
    check(
      !!entryAssetPath,
      "/dashboard referencia un bundle JS versionado.",
      "No se encontró el bundle JS principal en el HTML de /dashboard."
    );
    if (entryAssetPath) {
      const assetRes = await fetch(`${BASE_URL}${entryAssetPath}`, {
        headers: { "Accept-Encoding": "br, gzip" }
      });
      const assetCacheControl = assetRes.headers.get("cache-control") || "";
      check(
        assetCacheControl.includes("max-age=31536000") && assetCacheControl.includes("immutable"),
        "Los assets con hash se sirven con caché inmutable de un año.",
        `El asset ${entryAssetPath} no tiene caché inmutable: "${assetCacheControl}".`
      );
      check(
        ["br", "gzip"].includes(assetRes.headers.get("content-encoding") || ""),
        "El bundle JS se sirve comprimido desde el origen.",
        `El asset ${entryAssetPath} salió sin Content-Encoding br/gzip.`
      );
    }

    const jobsHeadersRes = await fetch(`${BASE_URL}/api/jobs?country=CO&limit=1`);
    const jobsCacheControl = jobsHeadersRes.headers.get("cache-control") || "";
    check(
      jobsCacheControl.includes("private") && jobsCacheControl.includes("no-store"),
      "/api/jobs nunca entra en una caché compartida.",
      `/api/jobs no declara private, no-store: "${jobsCacheControl}".`
    );

    // /ve/dashboard (2026-08-04 fix): previously had NO SSR branch at all —
    // fell through to the static index.html fallback, so its raw HTML
    // carried Colombia's <title> and a canonical of SITE_URL (telling
    // Google to treat it as a duplicate of the homepage). Mirrors every
    // check /dashboard already has above, plus the country-specific ones
    // (own canonical/title/hreflang/og:locale, and — the actual regression
    // risk this fix could have introduced — the embedded payload really is
    // Venezuela data, not a leftover Colombia one silently reused).
    const veDashboardRes = await fetch(`${BASE_URL}/ve/dashboard`);
    const veDashboardHtml = await veDashboardRes.text();
    check(
      veDashboardRes.status === 200,
      "/ve/dashboard responde 200.",
      `/ve/dashboard respondió ${veDashboardRes.status}.`
    );
    const veDashboardJobLinks = (veDashboardHtml.match(/href="\/empleos\//g) || []).length;
    check(
      veDashboardJobLinks > 0,
      `/ve/dashboard incluye ${veDashboardJobLinks} links reales a /empleos/ en el HTML crudo.`,
      "/ve/dashboard no tiene ningún link a /empleos/ en el HTML crudo."
    );
    check(
      veDashboardHtml.includes(`<link rel="canonical" href="${SITE_URL}/ve/dashboard" />`),
      "/ve/dashboard canonical se auto-referencia a /ve/dashboard (no a la home ni a /dashboard).",
      "/ve/dashboard no tiene su propio canonical self-referencing."
    );
    check(
      veDashboardHtml.includes("Vacantes de Empleo en Venezuela") &&
        !veDashboardHtml.includes("<title>BuscoTrabajo — Vacantes de Empleo en Colombia"),
      "/ve/dashboard tiene su propio <title> (Venezuela), no el de Colombia sin JS.",
      "/ve/dashboard todavía sirve el <title>/canonical de Colombia en el HTML crudo."
    );
    check(
      veDashboardHtml.includes(`hreflang="es-CO" href="${SITE_URL}/dashboard"`) &&
        veDashboardHtml.includes(`hreflang="es-VE" href="${SITE_URL}/ve/dashboard"`) &&
        veDashboardHtml.includes(`hreflang="x-default" href="${SITE_URL}/dashboard"`),
      "/ve/dashboard lleva el par hreflang recíproco con /dashboard (es-CO, es-VE, x-default).",
      "/ve/dashboard no tiene el hreflang recíproco esperado con /dashboard."
    );
    check(
      veDashboardHtml.includes('<meta property="og:locale" content="es_VE" />'),
      "/ve/dashboard tiene og:locale es_VE, no el es_CO heredado del shell estático.",
      "/ve/dashboard todavía tiene og:locale es_CO en el HTML crudo."
    );
    const veSsrJobsMatch = veDashboardHtml.match(/window\.__SSR_JOBS__=(.*?);<\/script>/);
    if (veSsrJobsMatch) {
      try {
        const veParsed = JSON.parse(veSsrJobsMatch[1]);
        check(
          veParsed.country === "VE" && Array.isArray(veParsed.jobs) && veParsed.jobs.length > 0,
          `window.__SSR_JOBS__ en /ve/dashboard trae country="VE" y ${veParsed.jobs.length} vacantes reales — nunca el payload de Colombia.`,
          `window.__SSR_JOBS__ en /ve/dashboard tiene country="${veParsed.country}" — el payload de Colombia se estaría sirviendo en la ruta de Venezuela.`
        );
      } catch {
        check(false, "", "window.__SSR_JOBS__ en /ve/dashboard no es JSON válido.");
      }
    } else {
      check(false, "", "/ve/dashboard no tiene el script de window.__SSR_JOBS__.");
    }

    // The real job page: exactly one of each head tag, valid JobPosting JSON-LD.
    const jobPath = buildJobPath(realJob as SeoJob);
    const res = await fetch(`${BASE_URL}${jobPath}`);
    const html = await res.text();

    check(
      res.status === 200,
      `GET ${jobPath} responde 200.`,
      `GET ${jobPath} respondió ${res.status}.`
    );

    const titleCount = (html.match(/<title>/g) || []).length;
    check(
      titleCount === 1,
      "La página de la vacante tiene exactamente un <title>.",
      `La página tiene ${titleCount} tags <title> (index.html ya trae uno — debe reemplazarse, no agregarse).`
    );

    const canonicalCount = (html.match(/rel="canonical"/g) || []).length;
    check(
      canonicalCount === 1,
      'La página tiene exactamente un <link rel="canonical">.',
      `La página tiene ${canonicalCount} canonicals — con más de uno Google elige arbitrariamente cuál usar.`
    );
    check(
      html.includes(jobPath),
      "El canonical apunta a la URL real de esta vacante, no a la home (bug de 'appending instead of replacing' en index.html).",
      "El canonical no contiene la ruta de la vacante — probablemente sigue apuntando a la home."
    );

    const ldJsonBlocks = [
      ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
    ];
    let jobPosting: any = null;
    for (const block of ldJsonBlocks) {
      try {
        const parsed = JSON.parse(block[1]);
        if (parsed["@type"] === "JobPosting") jobPosting = parsed;
      } catch {
        check(
          false,
          "",
          `Un bloque JSON-LD en la página no es JSON válido: ${block[1].slice(0, 200)}`
        );
      }
    }
    check(
      jobPosting !== null,
      "La página incluye un bloque JSON-LD válido de tipo JobPosting.",
      "No se encontró un JobPosting JSON-LD válido en la página."
    );
    if (jobPosting) {
      check(
        jobPosting.title === realJob.title &&
          jobPosting.hiringOrganization?.name === realJob.company,
        "Los datos del JobPosting coinciden con los datos reales de la vacante (nada inventado).",
        "Los datos del JobPosting no coinciden con la vacante real que se pidió."
      );
    }

    // Job SEO V2: a user-visible job that fails the Google gate keeps its
    // 200 page, readable body and source link, but is noindex,follow and has
    // no JobPosting.
    check(
      html.includes("data-apply-link") && !html.includes('name="robots" content="noindex'),
      "La vacante apta para Google trae el enlace a la fuente en el HTML crudo y es indexable.",
      "La vacante apta para Google no trae el enlace a la fuente en el HTML crudo, o quedó noindex."
    );
    if (thinJob) {
      const thinRes = await fetch(`${BASE_URL}${buildJobPath(thinJob as SeoJob)}`);
      const thinHtml = await thinRes.text();
      check(
        thinRes.status === 200 &&
          thinHtml.includes('<meta name="robots" content="noindex,follow">') &&
          !thinHtml.includes('"@type":"JobPosting"') &&
          thinHtml.includes("data-apply-link"),
        "Una vacante visible pero no apta para Google: 200, noindex,follow, sin JobPosting y con enlace a la fuente.",
        `La vacante no apta respondió ${thinRes.status} o no cumple noindex/sin JobPosting/enlace.`
      );
    }

    // A bogus id must 404 cleanly, not 500 and not the SPA shell with a 200.
    const notFoundRes = await fetch(`${BASE_URL}/empleos/00000000-0000-0000-0000-000000000000/x`);
    check(
      notFoundRes.status === 404,
      "Un id inexistente responde 404 real (no 200 con la SPA, no 500).",
      `Un id inexistente respondió ${notFoundRes.status} en vez de 404.`
    );

    // Sitemap (Fase 2): the index, both sub-sitemaps, XML well-formedness,
    // and — the actual point of the exercise, per SEO-PLAN.md section 5.2's
    // "nota para la Fase 2" — that a URL the sitemap lists actually resolves
    // instead of 404ing (a sitemap built against the raw, non-deduped table
    // would list ids /empleos/:id never finds).
    const indexRes = await fetch(`${BASE_URL}/sitemap.xml`);
    const indexXml = await indexRes.text();
    check(
      indexRes.status === 200 &&
        indexXml.includes("sitemap-jobs.xml") &&
        indexXml.includes("sitemap-pages.xml"),
      "/sitemap.xml es un índice que referencia sitemap-pages.xml y sitemap-jobs.xml.",
      "/sitemap.xml no tiene la estructura de índice esperada."
    );

    const pagesRes = await fetch(`${BASE_URL}/sitemap-pages.xml`);
    check(
      pagesRes.status === 200 && (await pagesRes.text()).includes("<urlset"),
      "/sitemap-pages.xml responde 200 con un <urlset> válido.",
      `/sitemap-pages.xml respondió ${pagesRes.status} o no es un urlset.`
    );

    const jobsSitemapRes = await fetch(`${BASE_URL}/sitemap-jobs.xml`);
    const jobsSitemapXml = await jobsSitemapRes.text();
    const sitemapLocs = [...jobsSitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    check(
      jobsSitemapRes.status === 200 && sitemapLocs.length > 0,
      `/sitemap-jobs.xml responde 200 con ${sitemapLocs.length} URLs.`,
      `/sitemap-jobs.xml respondió ${jobsSitemapRes.status} o no listó ninguna URL.`
    );

    if (sitemapLocs.length > 0) {
      const sampleUrl = new URL(sitemapLocs[0]);
      const sampleRes = await fetch(`${BASE_URL}${sampleUrl.pathname}`);
      check(
        sampleRes.status === 200,
        `Una URL real del sitemap (${sampleUrl.pathname}) resuelve 200 — no es un generador de soft-404s.`,
        `La URL del sitemap ${sampleUrl.pathname} respondió ${sampleRes.status} en vez de 200 — el sitemap está listando ids que /empleos/:id no encuentra.`
      );
    }

    // Category pages (Fase 4) — real city.
    const cityCategory = resolveCategorySlug(slugify(CITY_OPTIONS[0]))!;
    const cityPath = buildCategoryPath(cityCategory);
    const cityRes = await fetch(`${BASE_URL}${cityPath}`);
    const cityHtml = await cityRes.text();
    check(
      cityRes.status === 200,
      `GET ${cityPath} (categoría de ciudad real) responde 200.`,
      `GET ${cityPath} respondió ${cityRes.status}.`
    );
    check(
      (cityHtml.match(/<title>/g) || []).length === 1 &&
        (cityHtml.match(/rel="canonical"/g) || []).length === 1,
      `La página de categoría ${cityPath} tiene exactamente un <title> y un canonical.`,
      `La página de categoría ${cityPath} tiene un número inesperado de tags <title>/canonical.`
    );
    check(
      /href="\/empleos\/[0-9a-f-]{36}\//.test(cityHtml),
      `La página de categoría ${cityPath} incluye al menos un link real a una página de vacante individual en el HTML crudo.`,
      `La página de categoría ${cityPath} no tiene ningún link /empleos/<uuid>/... en el HTML crudo.`
    );
    check(
      cityHtml.includes("data-category-overview") &&
        cityHtml.includes("Empresas en la muestra") &&
        cityHtml.includes("Fuentes verificables") &&
        cityHtml.includes("Publicadas en 7 días") &&
        cityHtml.includes('href="/dashboard"') &&
        cityHtml.includes('href="/empresas"'),
      `La página de categoría ${cityPath} incluye en SSR una introducción útil, estadísticas verificables y enlaces internos a los hubs reales.`,
      `La página de categoría ${cityPath} no incluyó el resumen SEO enriquecido completo en el HTML crudo.`
    );
    check(
      cityHtml.includes("Trabajo en") && cityHtml.includes("vacantes de empleo"),
      `El título/H1 de ${cityPath} responde a la intención 'trabajo en <ciudad>' y 'vacantes de empleo'.`,
      `La página ${cityPath} no contiene la orientación de búsqueda local esperada.`
    );

    // Category pages (Fase 6) — BreadcrumbList + ItemList JSON-LD.
    const cityLdJsonBlocks = [
      ...cityHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
    ];
    let cityBreadcrumb: any = null;
    let cityItemList: any = null;
    for (const block of cityLdJsonBlocks) {
      try {
        const parsed = JSON.parse(block[1]);
        if (parsed["@type"] === "BreadcrumbList") cityBreadcrumb = parsed;
        if (parsed["@type"] === "ItemList") cityItemList = parsed;
      } catch {
        check(
          false,
          "",
          `Un bloque JSON-LD en la página de categoría ${cityPath} no es JSON válido: ${block[1].slice(0, 200)}`
        );
      }
    }
    check(
      cityBreadcrumb !== null &&
        cityBreadcrumb.itemListElement?.length === 2 &&
        cityBreadcrumb.itemListElement[1].item.endsWith(cityPath),
      `La página de categoría ${cityPath} incluye un BreadcrumbList JSON-LD válido con 2 niveles (Inicio → categoría).`,
      `No se encontró un BreadcrumbList JSON-LD válido en la página de categoría ${cityPath}.`
    );
    check(
      cityItemList !== null &&
        Array.isArray(cityItemList.itemListElement) &&
        cityItemList.itemListElement.length > 0 &&
        typeof cityItemList.itemListElement[0].url === "string" &&
        cityItemList.itemListElement[0].url.includes("/empleos/"),
      `La página de categoría ${cityPath} incluye un ItemList JSON-LD válido con URLs reales de vacantes.`,
      `No se encontró un ItemList JSON-LD válido (o sin items reales) en la página de categoría ${cityPath}.`
    );

    // Category pages — real role (Colombia, unprefijado).
    const roleCategoryCO = resolveCategorySlug(slugify(DEFAULT_ROLES_200[0]))!;
    const rolePathCO = buildCategoryPath(roleCategoryCO);
    const roleResCO = await fetch(`${BASE_URL}${rolePathCO}`);
    check(
      roleResCO.status === 200,
      `GET ${rolePathCO} (categoría de rol real, Colombia) responde 200.`,
      `GET ${rolePathCO} respondió ${roleResCO.status}.`
    );

    // Category pages — Venezuela: ciudad real SIN prefijo (el nombre ya es
    // inequívoco) y rol real CON prefijo /ve (mismo slug que la versión CO,
    // pero país y URL distintos — no deben mezclarse bajo una sola).
    const veCityCategory = resolveCategorySlug(slugify(COUNTRIES.VE.cities[0]))!;
    const veCityPath = buildCategoryPath(veCityCategory);
    const veCityRes = await fetch(`${BASE_URL}${veCityPath}`);
    check(
      veCityRes.status === 200 && !veCityPath.startsWith("/ve"),
      `GET ${veCityPath} (ciudad venezolana real, sin prefijo /ve) responde 200.`,
      `GET ${veCityPath} respondió ${veCityRes.status} o quedó con un path inesperado.`
    );

    const roleCategoryVE = resolveCategorySlug(slugify(DEFAULT_ROLES_200[0]), "VE")!;
    const rolePathVE = buildCategoryPath(roleCategoryVE);
    const roleResVE = await fetch(`${BASE_URL}${rolePathVE}`);
    const roleHtmlVE = await roleResVE.text();
    check(
      roleResVE.status === 200 &&
        rolePathVE === `/ve${rolePathCO}` &&
        roleHtmlVE.includes("Venezuela"),
      `GET ${rolePathVE} (mismo rol, Venezuela) responde 200 en una URL DISTINTA a la de Colombia, y el heading dice Venezuela.`,
      `GET ${rolePathVE} respondió ${roleResVE.status}, o la ruta/heading no distinguió el país correctamente.`
    );

    // Un UUID nunca vive bajo /ve/empleos/ — real 404, no un fallback al
    // detalle de vacante con un id ambiguo.
    const uuidUnderVeRes = await fetch(`${BASE_URL}/ve/empleos/${crypto.randomUUID()}`);
    check(
      uuidUnderVeRes.status === 404,
      "Un jobId (UUID) bajo /ve/empleos/ responde 404 real — las páginas de vacante nunca llevan el prefijo /ve.",
      `Un UUID bajo /ve/empleos/ respondió ${uuidUnderVeRes.status} en vez de 404.`
    );

    // Category pages — slug inventado debe 404 real, no la SPA con 200.
    const badCategoryRes = await fetch(`${BASE_URL}/empleos/esto-no-es-una-categoria-real`);
    check(
      badCategoryRes.status === 404,
      "Un slug de categoría inventado responde 404 real.",
      `Un slug de categoría inventado respondió ${badCategoryRes.status} en vez de 404.`
    );

    // Category pages — un slug de rol retirado de DEFAULT_ROLES_200 (§1.10)
    // debe responder 410, no 404 — ya estaba en sitemap-categories.xml y
    // fue rastreado por Google antes del swap, así que "nunca existió" sería
    // falso. Mismo criterio que wasJobPurged() ya aplica a vacantes retiradas.
    const retiredSlug = [...RETIRED_ROLE_SLUGS][0];
    const retiredCategoryRes = await fetch(`${BASE_URL}/empleos/${retiredSlug}`);
    const retiredCategoryHtml = await retiredCategoryRes.text();
    check(
      retiredCategoryRes.status === 410,
      `Un slug de rol retirado (/empleos/${retiredSlug}) responde 410, no 404 — estaba en el sitemap antes del swap.`,
      `Un slug de rol retirado (/empleos/${retiredSlug}) respondió ${retiredCategoryRes.status} en vez de 410.`
    );
    check(
      retiredCategoryHtml.includes("noindex") &&
        !retiredCategoryHtml.includes("application/ld+json"),
      `La página 410 de /empleos/${retiredSlug} trae noindex y ningún JSON-LD.`,
      `La página 410 de /empleos/${retiredSlug} no trae noindex o incluye JSON-LD que Google no debería seguir.`
    );
    const retiredCategoryVeRes = await fetch(`${BASE_URL}/ve/empleos/${retiredSlug}`);
    check(
      retiredCategoryVeRes.status === 410,
      `Un slug de rol retirado también responde 410 bajo /ve (/ve/empleos/${retiredSlug}).`,
      `/ve/empleos/${retiredSlug} respondió ${retiredCategoryVeRes.status} en vez de 410.`
    );

    // Company pages (Fase 3 follow-up, SEO-IMPROVEMENT-PLAN.md §1.16) —
    // /empresas (directorio) y /empresas/:slug (empresa individual), antes
    // CSR-only. Slug real obtenido en vivo (mismo patrón que el UUID real
    // sacado del sitemap arriba) — nunca hardcodeado, para no quebrar si
    // cambia qué empresa tiene más vacantes.
    const companiesSearchRes = await fetch(`${BASE_URL}/api/companies/search?limit=1`);
    const companiesSearchData = await companiesSearchRes.json();
    const realCompany = companiesSearchData.companies?.[0]?.company as string | undefined;
    check(
      Boolean(realCompany),
      "GET /api/companies/search devuelve al menos una empresa real para usar como muestra.",
      "GET /api/companies/search no devolvió ninguna empresa — no se puede probar /empresas/:slug."
    );

    if (realCompany) {
      const companySlug = slugify(realCompany);
      const companyRes = await fetch(`${BASE_URL}/empresas/${companySlug}`);
      const companyHtml = await companyRes.text();
      check(
        companyRes.status === 200,
        `GET /empresas/${companySlug} (empresa real) responde 200.`,
        `GET /empresas/${companySlug} respondió ${companyRes.status}.`
      );
      check(
        /href="\/empleos\/[0-9a-f-]{36}\//.test(companyHtml),
        `/empresas/${companySlug} incluye al menos un link real a una vacante en el HTML crudo.`,
        `/empresas/${companySlug} no tiene ningún link /empleos/<uuid>/... en el HTML crudo.`
      );
      check(
        companyHtml.includes(escapeHtml(realCompany)),
        `/empresas/${companySlug} tiene el nombre real de la empresa en el HTML crudo (no un shell genérico).`,
        `/empresas/${companySlug} no muestra el nombre real de la empresa en el HTML crudo — sigue sirviendo el shell genérico.`
      );

      const companyLdBlocks = [
        ...companyHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
      ];
      let organizationSchema: any = null;
      for (const block of companyLdBlocks) {
        try {
          const parsed = JSON.parse(block[1]);
          if (parsed["@type"] === "Organization") organizationSchema = parsed;
        } catch {
          check(
            false,
            "",
            `Un bloque JSON-LD en /empresas/${companySlug} no es JSON válido: ${block[1].slice(0, 200)}`
          );
        }
      }
      check(
        organizationSchema !== null && organizationSchema.name === realCompany,
        `/empresas/${companySlug} incluye un JSON-LD Organization válido con el nombre real de la empresa.`,
        `No se encontró un JSON-LD Organization válido (o con el nombre correcto) en /empresas/${companySlug}.`
      );
      check(
        organizationSchema && !("aggregateRating" in organizationSchema),
        `/empresas/${companySlug} nunca inventa un aggregateRating (fuentes con escalas distintas, nunca promediadas).`,
        `/empresas/${companySlug} incluye un aggregateRating fabricado — Merco/GPTW/Computrabajo usan escalas distintas, promediarlas inventa un dato.`
      );
    }

    // Un slug de empresa inventado responde 404 real.
    const badCompanyRes = await fetch(`${BASE_URL}/empresas/esto-no-es-una-empresa-real`);
    check(
      badCompanyRes.status === 404,
      "Un slug de empresa inventado responde 404 real.",
      `Un slug de empresa inventado respondió ${badCompanyRes.status} en vez de 404.`
    );

    // Directorio /empresas — links reales + ItemList JSON-LD.
    const empresasRes = await fetch(`${BASE_URL}/empresas`);
    const empresasHtml = await empresasRes.text();
    check(
      empresasRes.status === 200 && /href="\/empresas\/[^"]+"/.test(empresasHtml),
      "GET /empresas responde 200 con al menos un link real a una página de empresa.",
      `GET /empresas respondió ${empresasRes.status} o no tiene ningún link /empresas/<slug> en el HTML crudo.`
    );
    const empresasLdBlocks = [
      ...empresasHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
    ];
    const empresasItemList = empresasLdBlocks
      .map((b) => {
        try {
          return JSON.parse(b[1]);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.["@type"] === "ItemList");
    check(
      empresasItemList !== undefined &&
        Array.isArray(empresasItemList.itemListElement) &&
        empresasItemList.itemListElement.length > 0,
      "/empresas incluye un ItemList JSON-LD válido con empresas reales.",
      "No se encontró un ItemList JSON-LD válido (o sin items) en /empresas."
    );

    // sitemap-categories.xml + índice actualizado — ahora incluye ambos
    // países (CO+VE ciudades, y roles duplicados por país).
    const expectedCategoryCount =
      CITY_OPTIONS.length + COUNTRIES.VE.cities.length + DEFAULT_ROLES_200.length * 2;
    const categoriesSitemapRes = await fetch(`${BASE_URL}/sitemap-categories.xml`);
    const categoriesSitemapXml = await categoriesSitemapRes.text();
    const categoryLocsHttp = [...categoriesSitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)];
    check(
      categoriesSitemapRes.status === 200 &&
        categoryLocsHttp.length === expectedCategoryCount &&
        categoriesSitemapXml.includes(veCityPath) &&
        categoriesSitemapXml.includes(rolePathVE),
      `/sitemap-categories.xml responde 200 con ${categoryLocsHttp.length} URLs (incluye ciudades y roles de ambos países).`,
      `/sitemap-categories.xml respondió ${categoriesSitemapRes.status} o listó un número de URLs inesperado (${categoryLocsHttp.length}, se esperaban ${expectedCategoryCount}).`
    );

    const indexResV2 = await fetch(`${BASE_URL}/sitemap.xml`);
    const indexXmlV2 = await indexResV2.text();
    check(
      indexXmlV2.includes("sitemap-categories.xml"),
      "/sitemap.xml (índice) ahora también referencia sitemap-categories.xml.",
      "/sitemap.xml no incluye sitemap-categories.xml en el índice."
    );

    // Vencimiento (Fase 5) — un id nunca visto sigue dando 404 real
    // (regresión explícita: sin esto, un bug futuro podría marcar
    // cualquier id inexistente como "vencido").
    const neverExistedId = crypto.randomUUID();
    const neverExistedRes = await fetch(`${BASE_URL}/empleos/${neverExistedId}/x`);
    check(
      neverExistedRes.status === 404,
      "Un jobId que nunca existió sigue respondiendo 404 (no 410) — nunca visto en indexing_queue.",
      `Un jobId nunca visto respondió ${neverExistedRes.status} en vez de 404.`
    );

    // Un jobId que sí existió y fue purgado (misma fila URL_DELETED que
    // purgeOldJobs() ya encola) debe responder 410, no 404 genérico.
    const purgedJobId = crypto.randomUUID();
    const purgedUrl = `${buildJobUrlPrefix(purgedJobId)}vacante-de-prueba`;
    try {
      await enqueueIndexingNotifications([{ url: purgedUrl, type: "URL_DELETED" }]);
      const purgedCheck = await wasJobPurged(purgedJobId);
      check(
        purgedCheck === true,
        "wasJobPurged() reconoce un jobId con una fila URL_DELETED real en indexing_queue.",
        "wasJobPurged() no reconoció un jobId recién encolado como URL_DELETED."
      );

      const purgedRes = await fetch(`${BASE_URL}/empleos/${purgedJobId}/x`);
      check(
        purgedRes.status === 410,
        `GET /empleos/${purgedJobId}/x (jobId purgado) responde 410, no 404.`,
        `GET /empleos/${purgedJobId}/x respondió ${purgedRes.status} en vez de 410.`
      );
      const purgedHtml = await purgedRes.text();
      check(
        purgedHtml.includes('name="robots" content="noindex"') &&
          !purgedHtml.includes("application/ld+json"),
        "La página 410 trae noindex y ningún JSON-LD (nada que Google deba seguir indexando).",
        "La página 410 no trae noindex, o incluyó JSON-LD indebidamente."
      );
    } finally {
      await pool.query(`DELETE FROM indexing_queue WHERE url = $1`, [purgedUrl]);
    }
  } finally {
    killServerTree(server);
  }
}

// --- Part 3: Google Indexing API (SEO Fase 3) -------------------------------
//
// The JWT signing path is network-free and fully testable with a throwaway
// keypair. The OAuth exchange and the real urlNotifications:publish call
// cannot be tested here — they require the user's real Google Cloud
// credentials (see docs/SEO-PLAN.md section 7.2/7.3).
//
// The indexing_queue repository round-trip writes to the real DB (there's
// no separate test DB in this project — same constraint as everywhere else
// in this suite), but only to indexing_queue, never to `jobs`, and it
// deletes its own test rows in a `finally` so it never leaves residue that
// could confuse a real send.

function runIndexingJwtTests() {
  console.log(`\n--- Parte 3a: firma JWT de Google Indexing API (sin red) ---\n`);

  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });

  const nowSeconds = Math.floor(Date.now() / 1000);
  const jwt = buildJwtAssertion("test-sa@example.iam.gserviceaccount.com", privateKey, nowSeconds);
  const [headerB64, claimsB64, signatureB64] = jwt.split(".");

  check(
    Boolean(headerB64 && claimsB64 && signatureB64),
    "buildJwtAssertion() produce un JWT con 3 segmentos (header.claims.signature).",
    `buildJwtAssertion() produjo un JWT mal formado: "${jwt}"`
  );

  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(claimsB64, "base64url").toString("utf8"));

  check(
    header.alg === "RS256" && header.typ === "JWT",
    "El header del JWT declara RS256/JWT, lo que Google exige para el flujo de cuenta de servicio.",
    `Header inesperado: ${JSON.stringify(header)}`
  );

  check(
    claims.iss === "test-sa@example.iam.gserviceaccount.com" &&
      claims.scope === "https://www.googleapis.com/auth/indexing" &&
      claims.aud === "https://oauth2.googleapis.com/token" &&
      claims.exp === claims.iat + 3600,
    "Las claims (iss/scope/aud/exp) tienen la forma exacta que Google's OAuth token endpoint espera.",
    `Claims inesperadas: ${JSON.stringify(claims)}`
  );

  const signingInput = `${headerB64}.${claimsB64}`;
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signingInput);
  const signatureValid = verifier.verify(
    publicKey,
    Buffer.from(signatureB64.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  );
  check(
    signatureValid,
    "La firma RS256 verifica contra la clave pública del par descartable — el firmado en sí es correcto.",
    "La firma del JWT no verificó contra la clave pública esperada."
  );
}

async function runIndexingQueueTests() {
  console.log(
    `\n--- Parte 3b: cola indexing_queue (escribe y borra sus propias filas de prueba) ---\n`
  );

  const testUrl = `https://buscotrabajo.co/empleos/__test-${crypto.randomUUID()}__/prueba`;

  try {
    await enqueueIndexingNotifications([{ url: testUrl, type: "URL_UPDATED" }]);
    const pending = await getPendingIndexingBatch(1000);
    const found = pending.find((row) => row.url === testUrl);

    check(
      Boolean(found),
      "enqueueIndexingNotifications() inserta y getPendingIndexingBatch() la puede leer de vuelta.",
      "La fila insertada no apareció en el batch de pendientes."
    );

    if (found) {
      await markIndexingSent(found.id);
      const stillPending = await getPendingIndexingBatch(1000);
      check(
        !stillPending.some((row) => row.id === found.id),
        "markIndexingSent() saca la fila de la cola de pendientes.",
        "La fila seguía apareciendo como pendiente después de markIndexingSent()."
      );
    }

    const budget = await getIndexingBudgetRemaining();
    check(
      typeof budget === "number" && budget >= 0 && budget <= 200,
      `getIndexingBudgetRemaining() devuelve un número válido dentro de la cuota diaria (${budget}/200).`,
      `getIndexingBudgetRemaining() devolvió un valor fuera de rango: ${budget}`
    );
  } finally {
    // Always clean up, whether the checks above passed or not — this test
    // must never leave residue in a table a real production drain script
    // reads from.
    await pool.query(`DELETE FROM indexing_queue WHERE url = $1`, [testUrl]);
  }
}

async function main() {
  console.log(`\n==================================================`);
  console.log(
    `🧪 SUITE DE VALIDACIÓN — PÁGINAS SEO (vacante /empleos/:id/:slug + categoría /empleos/:slug)`
  );
  console.log(`==================================================`);

  runPureFunctionTests();
  await runHttpTests();
  runIndexingJwtTests();
  await runIndexingQueueTests();

  console.log(`\n==================================================`);
  if (failures > 0) {
    console.error(`❌ [TEST SUITE FAILED] ${failures} verificación(es) fallaron.`);
    console.log(`==================================================\n`);
    process.exit(1);
  }
  console.log(`🎉 [TEST SUITE PASSED] Páginas SEO por vacante verificadas.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  process.exit(1);
});
