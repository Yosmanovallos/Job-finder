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
  buildCategoryMeta,
  buildCategoryPath,
  buildCategoriesSitemapXml,
  buildJobUrlPrefix,
  SeoJob
} from "../src/lib/job-seo.js";
import { CITY_OPTIONS } from "../src/lib/job-filters.js";
import { DEFAULT_ROLES_200 } from "../src/queue/scheduler.js";
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

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Own port, separate from both the dev server (3000) and
// validate-paywall-auth.ts's (3979) — this suite never calls
// clearRepository()/saveJobs(), so it's read-only and safe to run
// alongside the app or another test, but a dedicated port still avoids any
// EADDRINUSE flakiness if something else is on 3000.
const TEST_PORT = 3981;
const BASE_URL = `http://localhost:${TEST_PORT}`;

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

  const openJob: SeoJob = {
    jobId: "test-open-1",
    title: "Analista de Datos",
    company: "PepsiCo",
    location: "Bogotá",
    url: "https://example.com/job/1",
    dateText: "Hoy",
    source: "LinkedIn",
    publishedAt: new Date("2026-01-01T00:00:00Z").toISOString()
  };

  check(
    isPubliclyDescribable(openJob),
    "Una vacante con company/location/url presentes se considera públicamente describible.",
    "isPubliclyDescribable() rechazó una vacante completa."
  );

  const posting = buildJobPosting(openJob);
  check(
    posting !== null,
    "buildJobPosting() genera JobPosting para una vacante abierta.",
    "buildJobPosting() devolvió null para una vacante abierta."
  );
  if (posting) {
    const requiredKeys = [
      "title",
      "description",
      "datePosted",
      "hiringOrganization",
      "jobLocation",
      "validThrough"
    ];
    const missing = requiredKeys.filter((k) => !(k in posting));
    check(
      missing.length === 0,
      "El JobPosting incluye todos los campos requeridos por Google (title, description, datePosted, hiringOrganization, jobLocation, validThrough).",
      `Faltan campos requeridos por Google en el JobPosting: ${missing.join(", ")}`
    );
    check(
      new Date((posting as any).validThrough).getTime() >
        new Date((posting as any).datePosted).getTime(),
      "validThrough queda después de datePosted (no una fecha ya vencida al momento de generarse).",
      "validThrough no es posterior a datePosted — el listado nacería ya expirado."
    );
  }

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
  const prefix = buildJobUrlPrefix(openJob.jobId);
  check(
    prefix.endsWith(`/empleos/${openJob.jobId}/`) && buildJobUrl(openJob).startsWith(prefix),
    "buildJobUrlPrefix() produce el mismo prefijo con el que se construyó la URL real de la vacante.",
    `buildJobUrlPrefix("${openJob.jobId}") produjo "${prefix}", no es prefijo de buildJobUrl(): "${buildJobUrl(openJob)}"`
  );

  // --- Sitemap (Fase 2) ---
  const sitemapXml = buildJobsSitemapXml([openJob, lockedJob]);
  check(
    sitemapXml.includes(openJob.jobId) && !sitemapXml.includes(lockedJob.jobId),
    "buildJobsSitemapXml() incluye vacantes públicas y excluye las bloqueadas.",
    "buildJobsSitemapXml() listó una vacante bloqueada, o no listó la vacante pública."
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
    isUuid("e582c93b-bb2f-4dba-b983-647aedda5510") && !isUuid("bogota") && !isUuid("analista-de-datos"),
    "isUuid() distingue un jobId real de un slug de categoría.",
    "isUuid() no distinguió correctamente un UUID real de un slug de categoría."
  );

  const realCity = CITY_OPTIONS[0];
  const citySlug = slugify(realCity);
  const cityMatch = resolveCategorySlug(citySlug);
  check(
    cityMatch?.kind === "ciudad" && cityMatch.label === realCity,
    `resolveCategorySlug("${citySlug}") resuelve a la ciudad real "${realCity}".`,
    `resolveCategorySlug("${citySlug}") no resolvió a la ciudad esperada: ${JSON.stringify(cityMatch)}`
  );

  const realRole = DEFAULT_ROLES_200[0];
  const roleSlug = slugify(realRole);
  const roleMatch = resolveCategorySlug(roleSlug);
  check(
    roleMatch?.kind === "rol" && roleMatch.label === realRole,
    `resolveCategorySlug("${roleSlug}") resuelve al rol real "${realRole}".`,
    `resolveCategorySlug("${roleSlug}") no resolvió al rol esperado: ${JSON.stringify(roleMatch)}`
  );

  check(
    resolveCategorySlug("esto-no-existe-como-categoria") === null,
    "resolveCategorySlug() devuelve null para un slug que no matchea ninguna ciudad ni rol — evita páginas doorway.",
    "resolveCategorySlug() devolvió un match para un slug inventado."
  );

  check(
    buildCategoryPath(realCity) === `/empleos/${citySlug}`,
    "buildCategoryPath() genera la ruta plana /empleos/<slug> sin prefijo nuevo.",
    `buildCategoryPath("${realCity}") produjo una ruta inesperada: ${buildCategoryPath(realCity)}`
  );

  const cityMeta = buildCategoryMeta("ciudad", realCity, 42);
  check(
    cityMeta.title.includes(realCity) &&
      cityMeta.title.includes("42") &&
      cityMeta.canonicalUrl.endsWith(buildCategoryPath(realCity)),
    "buildCategoryMeta() para una ciudad incluye el nombre real, el conteo real y un canonical consistente.",
    `buildCategoryMeta("ciudad", "${realCity}", 42) produjo metadata inconsistente: ${JSON.stringify(cityMeta)}`
  );

  const emptyRoleMeta = buildCategoryMeta("rol", realRole, 0);
  check(
    emptyRoleMeta.description.includes("0 vacantes"),
    "buildCategoryMeta() nunca infla el conteo — una categoría vacía dice '0 vacantes', no un número inventado.",
    `buildCategoryMeta("rol", "${realRole}", 0) no reportó 0 vacantes: ${emptyRoleMeta.description}`
  );

  const categoriesSitemapXml = buildCategoriesSitemapXml();
  const categoryLocs = [...categoriesSitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)];
  check(
    categoryLocs.length === CITY_OPTIONS.length + DEFAULT_ROLES_200.length &&
      categoriesSitemapXml.includes(buildCategoryPath(realCity)),
    `buildCategoriesSitemapXml() lista exactamente ${CITY_OPTIONS.length + DEFAULT_ROLES_200.length} URLs (${CITY_OPTIONS.length} ciudades + ${DEFAULT_ROLES_200.length} roles).`,
    `buildCategoriesSitemapXml() listó ${categoryLocs.length} URLs, se esperaban ${CITY_OPTIONS.length + DEFAULT_ROLES_200.length}.`
  );
}

// --- Part 2: real HTTP checks against a spawned server, read-only DB -------

async function waitForServer(maxAttempts = 40, delayMs = 250): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
  return spawn("npx", ["tsx", serverPath], {
    cwd: path.join(__dirname, ".."),
    shell: true,
    detached: true,
    env: { ...process.env, PORT: String(TEST_PORT) }
  });
}

function killServerTree(server: ChildProcess): void {
  if (server.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // Group may already be gone.
    }
  }
}

async function runHttpTests() {
  console.log(
    `\n--- Parte 2: HTTP real contra el servidor (solo lectura — no escribe en la tabla jobs) ---\n`
  );

  // Deliberately read-only: this suite never calls saveJobs()/clearRepository(),
  // unlike validate-paywall-auth.ts. There is no separate test database for
  // this project (see job-repository.ts's clearRepository() comment) — the
  // same DATABASE_URL backs local dev and prod, so a real fixture job is
  // picked from whatever's already in the table instead of writing one.
  // isLocked on the raw getJobs() row just means "<48h old" — that's not
  // the same as "hidden from an anonymous visitor" (maskLockedFields() also
  // checks PAYWALL_ENABLED, which is off today, so every job currently
  // passes regardless of age). Running the exact same masking pipeline the
  // server route uses is what actually determines whether a page should
  // exist for it — matching on raw isLocked here would wrongly skip every
  // fresh job even when the paywall is disabled.
  const rawJobs = await getJobs(50);
  const visibleJobs = maskLockedFields(rawJobs, "free");
  const realJob = visibleJobs.find((j) => isPubliclyDescribable(j as SeoJob));

  if (!realJob) {
    console.warn(
      `⚠️ [SKIPPED] No hay ninguna vacante activa y desbloqueada en la base de datos para probar contra un servidor real — ` +
        `esto es normal en un entorno recién creado sin datos scrapeados aún. Las pruebas de funciones puras (Parte 1) ya cubrieron la lógica.`
    );
    return;
  }

  const server = startServer();
  try {
    await waitForServer();

    // Regression: existing routes must be completely unaffected.
    for (const route of ["/", "/dashboard", "/api/health", "/api/jobs"]) {
      const res = await fetch(`${BASE_URL}${route}`);
      check(
        res.status === 200,
        `${route} sigue respondiendo 200 sin cambios.`,
        `${route} respondió ${res.status} — regresión.`
      );
    }

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
    const cityPath = buildCategoryPath(CITY_OPTIONS[0]);
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

    // Category pages — real role.
    const rolePath = buildCategoryPath(DEFAULT_ROLES_200[0]);
    const roleRes = await fetch(`${BASE_URL}${rolePath}`);
    check(
      roleRes.status === 200,
      `GET ${rolePath} (categoría de rol real) responde 200.`,
      `GET ${rolePath} respondió ${roleRes.status}.`
    );

    // Category pages — slug inventado debe 404 real, no la SPA con 200.
    const badCategoryRes = await fetch(`${BASE_URL}/empleos/esto-no-es-una-categoria-real`);
    check(
      badCategoryRes.status === 404,
      "Un slug de categoría inventado responde 404 real.",
      `Un slug de categoría inventado respondió ${badCategoryRes.status} en vez de 404.`
    );

    // sitemap-categories.xml + índice actualizado (ahora 3 entradas).
    const categoriesSitemapRes = await fetch(`${BASE_URL}/sitemap-categories.xml`);
    const categoriesSitemapXml = await categoriesSitemapRes.text();
    const categoryLocsHttp = [...categoriesSitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)];
    check(
      categoriesSitemapRes.status === 200 &&
        categoryLocsHttp.length === CITY_OPTIONS.length + DEFAULT_ROLES_200.length,
      `/sitemap-categories.xml responde 200 con ${categoryLocsHttp.length} URLs (${CITY_OPTIONS.length} ciudades + ${DEFAULT_ROLES_200.length} roles).`,
      `/sitemap-categories.xml respondió ${categoriesSitemapRes.status} o listó un número de URLs inesperado (${categoryLocsHttp.length}).`
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
