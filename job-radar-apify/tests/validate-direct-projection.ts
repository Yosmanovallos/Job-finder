import "./require-isolated-database.js";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db/client.js";
import { projectionHash, supersedeCopies, syncProjections } from "../src/db/direct-projection-repository.js";
import { saveListing, upsertEmployer, type EmployerSourceRow } from "../src/db/direct-repository.js";
import { getJobById, getJobsPage, getSupersedingTarget, saveJobs } from "../src/db/job-repository.js";
import type { DirectPosting } from "../src/direct/types.js";

/**
 * Phase D4 (docs/adr/0006-direct-employers.md §10) against the disposable
 * Postgres: official vacancies projected into `jobs`, their job-board copies
 * hidden and restored by one rule, the 301/410 lookup, no Indexing API
 * notification, Venezuela and other employers untouched, idempotent re-runs.
 */
let failures = 0;
function check(condition: boolean, pass: string, fail: string): void {
  if (condition) console.log(`OK  ${pass}`);
  else {
    console.error(`ERR ${fail}`);
    failures++;
  }
}

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function posting(overrides: Partial<DirectPosting>): DirectPosting {
  return {
    externalId: "x",
    title: "Analista de Datos",
    applyUrl: "https://jobs.lever.co/proj-co/x",
    locationRaw: "Bogotá, Colombia",
    city: "Bogotá",
    country: "CO",
    workplace: null,
    descriptionText: "Funciones y requisitos publicados por la empresa en su propio portal de empleo, con suficiente detalle.",
    department: null,
    employmentType: "Full-time",
    publishedAt: daysAgo(3),
    validThrough: null,
    contentHash: "h",
    partial: false,
    ...overrides
  };
}

async function row(id: string) {
  const result = await pool.query(
    `SELECT id, is_active, superseded_by, direct_job_id, source, company, location, url, url_hash, content_fingerprint,
            published_at, seo_evaluated_at, remote_type, applicant_countries, country
     FROM jobs WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}

async function boardRow(title: string, company: string, location: string, country: string | null): Promise<string> {
  await saveJobs([
    {
      title,
      company,
      location,
      url: `https://www.linkedin.com/jobs/view/${encodeURIComponent(`${title}-${company}-${location}`)}`,
      source: "LinkedIn",
      dateText: "",
      publishedAt: daysAgo(1),
      country: country ?? undefined
    } as never
  ]);
  const result = await pool.query(`SELECT id FROM jobs WHERE title = $1 AND company = $2 AND location = $3`, [title, company, location]);
  return result.rows[0].id;
}

async function run(): Promise<void> {
  console.log("\n--- Vacantes oficiales proyectadas en jobs (D4) ---\n");
  const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  for (const name of ["source-closure", "job-freshness", "direct-employers", "direct-projection"]) {
    const block = new RegExp(`-- BEGIN ${name}\\r?\\n([\\s\\S]*?)-- END ${name}`).exec(schema)?.[1];
    if (!block) throw new Error(`schema.sql no contiene el bloque ${name}`);
    await pool.query(block);
    if (name === "direct-projection") await pool.query(block);
  }
  check(true, "El bloque direct-projection es idempotente (aplicado dos veces).", "");

  const employer = await upsertEmployer({
    slug: "proj-co",
    displayName: "Proj Co",
    websiteDomain: "proj.test",
    origin: "seed",
    aliases: ["Proj Co LA"],
    sources: [{ atsType: "lever", atsRef: "proj-co", portalUrl: "https://jobs.lever.co/proj-co", enabled: true }]
  });
  const sourceIdResult = await pool.query(`SELECT id FROM employer_sources WHERE employer_id = $1`, [employer.employerId]);
  const source = { id: sourceIdResult.rows[0].id, employerId: employer.employerId } as Pick<EmployerSourceRow, "id" | "employerId">;
  await saveListing(source, [
    posting({ externalId: "p1", applyUrl: "https://jobs.lever.co/proj-co/p1" }),
    posting({ externalId: "p2", title: "Ingeniero de Software", applyUrl: "https://jobs.lever.co/proj-co/p2", city: null, locationRaw: "Remote - Colombia", workplace: "remote" })
  ], false);
  const ids = await pool.query(`SELECT external_id, id FROM direct_jobs WHERE employer_source_id = $1`, [source.id]);
  const p1 = ids.rows.find((entry) => entry.external_id === "p1").id;
  const p2 = ids.rows.find((entry) => entry.external_id === "p2").id;

  // Job-board rows: two copies (one remote, country NULL), one Venezuelan
  // homonym, one other employer with the same title.
  const copyBogota = await boardRow("analista de datos", "Proj Co LA", "Bogotá, Colombia", "CO");
  const copyRemote = await boardRow("Ingeniero de Software", "Proj Co LA", "Remoto", null);
  const venezuela = await boardRow("Analista de Datos", "Proj Co LA", "Caracas, Venezuela", "VE");
  const otherEmployer = await boardRow("Analista de Datos", "Otra Empresa SAS", "Bogotá, Colombia", "CO");
  const queueBefore = await pool.query(`SELECT COUNT(*)::int AS n FROM indexing_queue`);

  // 1) First projection pass.
  const first = await syncProjections();
  const official = await row(p1);
  check(
    first.inserted === 2 && official?.direct_job_id === p1 && official.source === "Portal oficial" &&
      official.url === "https://jobs.lever.co/proj-co/p1" && official.company === "Proj Co" && official.location === "Bogotá, Colombia" &&
      official.country === "CO" && official.url_hash === projectionHash(p1) && official.content_fingerprint === projectionHash(p1) &&
      Math.abs(new Date(official.published_at).getTime() - Date.parse(daysAgo(3))) < 60_000 && official.seo_evaluated_at !== null,
    "La oficial se proyecta con id estable, hash con espacio de nombres, URL del portal, fecha del ATS y gate evaluado.",
    `Proyección inesperada: ${JSON.stringify({ first, official })}`
  );
  const remote = await row(p2);
  check(
    remote?.location === "Colombia" && remote.remote_type === "fully_remote" && JSON.stringify(remote.applicant_countries) === '["CO"]',
    "Sin ciudad declarada no se inventa una: ubicación 'Colombia'; remoto solo porque el ATS lo dijo.",
    `Ubicación/modalidad inventadas: ${JSON.stringify(remote)}`
  );
  const copies = await Promise.all([copyBogota, copyRemote, venezuela, otherEmployer].map(row));
  check(
    first.superseded === 2 && copies[0].is_active === false && copies[0].superseded_by === p1 &&
      copies[1].is_active === false && copies[1].superseded_by === p2 &&
      copies[2].is_active === true && copies[3].is_active === true,
    "Las copias (incluida la remota sin país) quedan ocultas y apuntan a su oficial; Venezuela y otra empresa no se tocan.",
    `Supersede inesperado: ${JSON.stringify({ superseded: first.superseded, copies })}`
  );
  const queueAfter = await pool.query(`SELECT COUNT(*)::int AS n FROM indexing_queue WHERE job_id = ANY($1::uuid[])`, [[p1, p2]]);
  check(queueAfter.rows[0].n === 0, "Ninguna proyección entra a la cola de la Indexing API (§10.7).", `Encoladas: ${queueAfter.rows[0].n}`);

  // 2) Public reads: the official one is listed, its copy is not; the copy's URL resolves to it.
  const page = await getJobsPage({ limit: 50, includeDetails: false });
  const listed = new Set(page.jobs.map((job) => job.jobId));
  check(
    listed.has(p1) && listed.has(p2) && !listed.has(copyBogota) && !listed.has(copyRemote) && listed.has(otherEmployer),
    "El listado público muestra la oficial y no su copia (mismos componentes, misma consulta).",
    `Listado: ${[...listed].join(",")}`
  );
  const lookup = await getSupersedingTarget(copyBogota);
  check(
    (await getJobById(copyBogota)) === null && lookup?.target?.jobId === p1 && (await getSupersedingTarget(otherEmployer)) === undefined,
    "/empleos/:copia → 301 a la oficial viva; una vacante normal no se ve afectada.",
    `Lookup: ${JSON.stringify(lookup)}`
  );

  // 3) Idempotent re-run.
  const second = await syncProjections();
  check(
    second.inserted === 0 && second.updated === 0 && second.superseded === 0 && second.removed === 0 && second.reverted === 0,
    "Re-correr la proyección no cambia nada.",
    `Segunda pasada: ${JSON.stringify(second)}`
  );

  // 4) A re-scrape of the copy under a new URL does not add an active duplicate.
  await saveJobs([
    {
      title: "analista de datos",
      company: "Proj Co LA",
      location: "Bogotá, Colombia",
      url: "https://co.computrabajo.com/ofertas-de-trabajo/oferta-analista-datos-proj",
      source: "Computrabajo",
      dateText: "",
      publishedAt: daysAgo(1),
      country: "CO"
    } as never
  ]);
  const actives = await pool.query(
    `SELECT COUNT(*)::int AS n FROM jobs WHERE is_active = TRUE AND company = 'Proj Co LA' AND title_key = 'analistadedatos' AND country = 'CO'`
  );
  check(actives.rows[0].n === 0, "Un re-scrape con URL nueva se funde en la copia oculta: no aparece otra copia activa.", `Copias activas: ${actives.rows[0].n}`);

  // 5) The official vacancy closes: projection removed (410 path), recent copy restored.
  await pool.query(`UPDATE direct_jobs SET closed_at = NOW() WHERE id = $1`, [p1]);
  const third = await syncProjections();
  const restored = await row(copyBogota);
  check(
    third.removed === 1 && (await row(p1)) === undefined && restored.is_active === true && restored.superseded_by === null &&
      (await getSupersedingTarget(copyBogota)) === undefined,
    "Al cerrar la oficial, su fila sale de jobs y la copia vista hace < 48 h vuelve (regla única de reversión).",
    `Cierre: ${JSON.stringify({ third, restored })}`
  );
  const purged = await pool.query(`SELECT COUNT(*)::int AS n FROM expired_job_urls WHERE url_hash = $1`, [projectionHash(p1)]);
  check(purged.rows[0].n === 1, "La proyección retirada deja su lápida (410), con el hash de su espacio de nombres.", `Lápidas: ${purged.rows[0].n}`);

  // 6) An old copy is not resurrected: its board turned off, the copy was last seen 3 days ago.
  await pool.query(`UPDATE jobs SET last_seen_at = NOW() - INTERVAL '3 days' WHERE id = $1`, [copyRemote]);
  await pool.query(`UPDATE employer_sources SET enabled = FALSE WHERE id = $1`, [source.id]);
  const fourth = await syncProjections();
  const stale = await row(copyRemote);
  const staleLookup = await getSupersedingTarget(copyRemote);
  check(
    fourth.removed === 1 && stale.is_active === false && stale.superseded_by === p2 && staleLookup !== undefined && staleLookup.target === null,
    "Tablero apagado: su proyección sale; una copia vieja no revive y su URL responde 410 (no 404).",
    `Copia vieja: ${JSON.stringify({ fourth, stale, staleLookup })}`
  );

  // 7) Board back on: the same official id comes back, the old copy points at a live target again.
  await pool.query(`UPDATE employer_sources SET enabled = TRUE WHERE id = $1`, [source.id]);
  await syncProjections();
  const back = await getSupersedingTarget(copyRemote);
  check(back?.target?.jobId === p2 && (await row(p2))?.url_hash === projectionHash(p2), "Al reabrir vuelve el MISMO id (sin churn de URL).", `Reapertura: ${JSON.stringify(back)}`);

  // 8) The scrape tick's pass is a no-op when nothing new matches.
  check((await supersedeCopies()) === 0, "El paso de copias del scrape tick es idempotente.", "supersedeCopies volvió a ocultar algo.");

  // A single remote official posting keeps the existing broad-location rule.
  const cityCopyOfRemote = await boardRow("Ingeniero de Software", "Proj Co LA", "Bogotá, Colombia", "CO");
  await supersedeCopies();
  const cityCopyOfRemoteRow = await row(cityCopyOfRemote);
  check(
    cityCopyOfRemoteRow.is_active === false && cityCopyOfRemoteRow.superseded_by === p2,
    "Una oficial remota única sigue agrupando su copia de bolsa con ciudad.",
    `Regresión de ubicación amplia: ${JSON.stringify(cityCopyOfRemoteRow)}`
  );

  const veRow = await row(venezuela);
  const queueEnd = await pool.query(`SELECT COUNT(*)::int AS n FROM indexing_queue`);
  check(veRow.is_active === true && veRow.superseded_by === null, "La vacante de Venezuela nunca se tocó.", "Se tocó una vacante de Venezuela.");
  check(
    queueEnd.rows[0].n >= queueBefore.rows[0].n,
    "La cola de indexación solo creció por bolsas o lápidas, nunca por URL_UPDATED de proyecciones.",
    "La cola cambió de forma inesperada."
  );
  const officialUpdates = await pool.query(
    `SELECT COUNT(*)::int AS n FROM indexing_queue WHERE notification_type = 'URL_UPDATED' AND job_id = ANY($1::uuid[])`,
    [[p1, p2]]
  );
  check(officialUpdates.rows[0].n === 0, "Cero URL_UPDATED de vacantes oficiales en todo el recorrido.", `URL_UPDATED oficiales: ${officialUpdates.rows[0].n}`);

  // Same title and city are not enough to merge different official roles.
  // An exact repost occupies one card; both stable IDs remain addressable.
  await saveListing(source, [
    posting({ externalId: "original", title: "Científico de Datos", applyUrl: "https://jobs.lever.co/proj-co/original" }),
    posting({ externalId: "variant", title: "Científico de Datos", applyUrl: "https://jobs.lever.co/proj-co/variant", descriptionText: "Otra requisición de datos con funciones de investigación y análisis estadístico claramente distintas." }),
    posting({ externalId: "repost", title: "Científico de Datos", applyUrl: "https://jobs.lever.co/proj-co/repost" })
  ], false);
  const variants = await pool.query<{ external_id: string; id: string }>(
    `SELECT external_id, id FROM direct_jobs WHERE employer_source_id = $1 AND external_id IN ('original', 'variant', 'repost')`,
    [source.id]
  );
  const originalId = variants.rows.find((entry) => entry.external_id === "original")?.id;
  const variantId = variants.rows.find((entry) => entry.external_id === "variant")?.id;
  const repostId = variants.rows.find((entry) => entry.external_id === "repost")?.id;
  await syncProjections();
  const officialPage = await getJobsPage({ filters: { company: "Proj Co", country: "CO" }, limit: 20, includeDetails: false });
  const dataCards = officialPage.jobs.filter((job) => job.title === "Científico de Datos");
  check(
    Boolean(originalId && variantId && repostId) && dataCards.length === 2 && dataCards.some((job) => job.jobId === variantId) &&
      dataCards.some((job) => job.jobId === originalId || job.jobId === repostId) &&
      Boolean(await getJobById(originalId!)) && Boolean(await getJobById(variantId!)) && Boolean(await getJobById(repostId!)),
    "Dos requisiciones oficiales con contenido distinto se ven; una republicación idéntica ocupa una tarjeta y conserva ambos IDs.",
    `Identidad oficial inesperada: ${JSON.stringify(dataCards.map((job) => job.jobId))}`
  );

  // A shared employer/title is not enough to redirect a Medellín posting to
  // a Bogotá requisition. Formatting-only Bogotá D.C. remains a true copy.
  await saveListing(source, [posting({
    externalId: "city-official", title: "Ingeniero de Datos",
    applyUrl: "https://jobs.lever.co/proj-co/city-official"
  })], false);
  const cityOfficial = (await pool.query<{ id: string }>(
    `SELECT id FROM direct_jobs WHERE employer_source_id = $1 AND external_id = 'city-official'`, [source.id]
  )).rows[0].id;
  await syncProjections();
  const wrongCity = await boardRow("Ingeniero de Datos", "Proj Co LA", "Medellín, Antioquia, Colombia", "CO");
  const bogotaAlias = await boardRow("Ingeniero de Datos", "Proj Co LA", "Bogotá D.C. Metropolitan Area", "CO");
  await supersedeCopies();
  const wrongCityBefore = await row(wrongCity);
  const bogotaAliasRow = await row(bogotaAlias);
  check(
    wrongCityBefore.is_active === true && wrongCityBefore.superseded_by === null &&
      bogotaAliasRow.is_active === false && bogotaAliasRow.superseded_by === cityOfficial,
    "Otra ciudad no se oculta; Bogotá D.C. y Bogotá sí representan la misma ciudad.",
    `Emparejamiento de ciudades: ${JSON.stringify({ wrongCityBefore, bogotaAliasRow })}`
  );
  await pool.query(
    `UPDATE jobs SET is_active = FALSE, superseded_by = $1, last_seen_at = NOW() WHERE id = $2`,
    [cityOfficial, wrongCity]
  );
  check(
    (await getSupersedingTarget(wrongCity))?.target === null &&
      (await getSupersedingTarget(bogotaAlias))?.target?.jobId === cityOfficial,
    "Un enlace anterior a otra ciudad no redirige; la copia correcta sí conserva su destino oficial.",
    "La consulta de un enlace equivocado aún entrega la vacante de otra ciudad."
  );
  const cityReversion = await syncProjections();
  const wrongCityAfter = await row(wrongCity);
  check(
    cityReversion.reverted >= 1 && wrongCityAfter.is_active === true && wrongCityAfter.superseded_by === null &&
      (await getSupersedingTarget(wrongCity)) === undefined && (await row(bogotaAlias)).superseded_by === cityOfficial,
    "Una copia reciente enlazada antes a otra ciudad se restaura y no reaparece como duplicado de Bogotá.",
    `Reversión de ciudad: ${JSON.stringify({ cityReversion, wrongCityAfter })}`
  );
  await pool.query(
    `UPDATE jobs SET is_active = FALSE, superseded_by = $1, last_seen_at = NOW() - INTERVAL '3 days' WHERE id = $2`,
    [cityOfficial, wrongCity]
  );
  const staleCityReversion = await syncProjections();
  check(
    staleCityReversion.reverted === 0 && (await row(wrongCity)).is_active === false &&
      (await getSupersedingTarget(wrongCity))?.target === null,
    "Una copia antigua mal enlazada no reaparece ni redirige a otra ciudad.",
    `Reversión antigua: ${JSON.stringify(staleCityReversion)}`
  );

  // Even a later source date cannot renew the archived original's 30-day clock.
  await pool.query(`UPDATE archived_jobs SET snapshot = jsonb_set(snapshot, '{published_at}',
    to_jsonb((NOW() - INTERVAL '45 days')::text)) WHERE job_id = $1`, [p2]);
  await syncProjections();
  await syncProjections();
  check((await row(p2)) === undefined,
    "Archivo oficial mayor de 30 días nunca revive aunque cambie la fecha de fuente.", "Proyección renovó vacante vencida.");

  await pool.query(`DELETE FROM jobs WHERE company IN ('Proj Co LA', 'Otra Empresa SAS', 'Proj Co')`);
  await pool.query(`DELETE FROM employers WHERE slug = 'proj-co'`);
}

run()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(async () => {
    await pool.end();
    if (failures > 0) {
      console.error(`\n${failures} verificación(es) fallaron.`);
      process.exit(1);
    }
    console.log("\nProyección de vacantes oficiales: todo verde.");
  });
