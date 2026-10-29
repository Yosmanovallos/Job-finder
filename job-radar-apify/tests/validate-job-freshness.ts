import "./require-isolated-database.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/client.js";
import {
  computeUrlHash,
  countCanonicalJobsByCompany,
  getActiveCompanyNames,
  getJobById,
  getJobsLight,
  saveJobs,
  streamCanonicalSitemapJobs
} from "../src/db/job-repository.js";
import { deleteClosedJobs, purgeOldJobs } from "../src/db/scheduler-repository.js";
import { findExpiredUrlHashes } from "../src/db/expired-job-repository.js";
import { pruneJobArchive, wasJobArchived } from "../src/db/job-archive-repository.js";

/**
 * Job freshness against the disposable Postgres (bug 2026-10-04: postings
 * older than a month, or past their validThrough, were still live).
 * Real SQL for every public read, the purge, the 410 tombstone and the
 * no-reinsert guard.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function runScript(script: string, args: string[] = []): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, path.join(root, "scripts", script), ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

let failures = 0;
function check(condition: boolean, pass: string, fail: string): void {
  if (condition) console.log(`OK  ${pass}`);
  else {
    console.error(`ERR ${fail}`);
    failures++;
  }
}

const tag = randomUUID().slice(0, 8);
const company = `Frescura ${tag}`;

async function insertJob(opts: { title: string; publishedDaysAgo: number; validThrough?: string; location?: string }) {
  const url = `https://example.com/freshness/${tag}/${opts.title.replace(/\W+/g, "-")}/${randomUUID().slice(0, 8)}`;
  const result = await pool.query(
    `INSERT INTO jobs (url_hash, title, company, location, url, source, published_at, last_seen_at, valid_through, seo_ready)
     VALUES ($1, $2, $3, $4, $5, 'LinkedIn', NOW() - make_interval(days => $6), NOW(), $7::timestamptz, TRUE)
     RETURNING id`,
    [computeUrlHash(url), opts.title, company, opts.location ?? "Bogotá, Colombia", url, opts.publishedDaysAgo, opts.validThrough ?? null]
  );
  return { id: result.rows[0].id as string, url };
}

async function run(): Promise<void> {
  console.log("\n--- Vacantes vencidas fuera de la app ---\n");

  // Before the migration: the no-reinsert guard degrades to a no-op, never a crash.
  const before = await findExpiredUrlHashes(["x"]);
  check(before.size === 0, "Sin la tabla expired_job_urls el guard no rompe nada.", "El guard falló sin la tabla.");

  const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  const dryMigration = await runScript("migrate-job-archive.ts", ["--dry-run"]);
  check(dryMigration.code === 0 && dryMigration.output.includes("DRY RUN"), "Migración archivo permite dry-run.", "Falló dry-run.");
  for (const attempt of [1, 2]) {
    const migration = await runScript("migrate-job-archive.ts", ["--execute"]);
    check(migration.code === 0 && migration.output.includes("OK"), `Archivo migra idempotente ${attempt}.`, migration.output.slice(-400));
  }
  const privacy = await pool.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'archived_jobs'::regclass`);
  const grants = await pool.query(`SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'archived_jobs' AND grantee IN ('PUBLIC','anon','authenticated')`);
  check(privacy.rows[0]?.relrowsecurity === true && grants.rowCount === 0, "Archivo privado con RLS y sin grants públicos.", "Archivo expuesto.");
  for (const name of ["source-closure", "job-freshness"]) {
    check(schema.includes(`-- BEGIN ${name}`), `schema.sql contiene el bloque ${name}.`, `Falta el bloque ${name}.`);
  }
  // The exact command production runs, twice: it must apply and be idempotent.
  for (const attempt of [1, 2]) {
    const migration = await runScript("migrate-job-freshness.ts");
    check(
      migration.code === 0 && migration.output.includes("[migrate-job-freshness] OK"),
      `scripts/migrate-job-freshness.ts corre limpio (ejecución ${attempt}).`,
      `scripts/migrate-job-freshness.ts falló (ejecución ${attempt}): ${migration.output.slice(-400)}`
    );
  }
  const table = await pool.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'expired_job_urls'`);
  check(table.rows[0]?.relrowsecurity === true, "expired_job_urls existe con RLS activo.", "expired_job_urls no existe o no tiene RLS.");

  const fresh = await insertJob({ title: `Analista Vigente ${tag}`, publishedDaysAgo: 3 });
  // Re-seen every tick (last_seen_at = NOW()) but published 45 days ago: the
  // exact shape the old last_seen_at-only purge kept alive forever.
  const old = await insertJob({ title: `Analista Vieja ${tag}`, publishedDaysAgo: 45 });
  const expired = await insertJob({
    title: `Analista Vencida ${tag}`,
    publishedDaysAgo: 5,
    validThrough: new Date(Date.now() - 3_600_000).toISOString()
  });
  // Same identity as `dupFresh` but newer and expired: it must not win the
  // canonical pick and hide the live one.
  const dupFresh = await insertJob({ title: `Analista Duplicada ${tag}`, publishedDaysAgo: 4, location: "Medellín, Colombia" });
  const dupExpired = await insertJob({
    title: `Analista Duplicada ${tag}`,
    publishedDaysAgo: 1,
    location: "Medellín, Colombia",
    validThrough: new Date(Date.now() - 3_600_000).toISOString()
  });

  const listed = new Set((await getJobsLight(100_000, 0)).map((job) => job.jobId));
  check(listed.has(fresh.id), "La vigente aparece en el listado.", "La vigente no aparece.");
  check(!listed.has(old.id), "La de 45 días NO aparece aunque la fuente la siga listando.", "La de 45 días sigue visible.");
  check(!listed.has(expired.id), "La de validThrough pasado NO aparece.", "La vencida sigue visible.");
  check(
    listed.has(dupFresh.id) && !listed.has(dupExpired.id),
    "Un duplicado vencido más nuevo no oculta al vigente.",
    "El duplicado vencido ganó la elección canónica."
  );

  check((await getJobById(fresh.id)) !== null, "El detalle de la vigente responde.", "El detalle de la vigente no responde.");
  check((await getJobById(old.id)) === null, "El detalle de la de 45 días no se sirve.", "El detalle de la de 45 días se sirve.");
  check((await getJobById(expired.id)) === null, "El detalle de la vencida no se sirve.", "El detalle de la vencida se sirve.");
  check((await getJobById(dupFresh.id)) !== null, "El detalle del vigente duplicado responde.", "El vigente duplicado da 404.");

  check((await countCanonicalJobsByCompany(company)) === 2, "El conteo por empresa solo cuenta vigentes (2).", "El conteo por empresa incluye vencidas.");
  check((await getActiveCompanyNames()).includes(company), "La empresa con vigentes sigue listada.", "La empresa desapareció.");

  const inSitemap = new Set<string>();
  await streamCanonicalSitemapJobs({ onJob: (job) => void inSitemap.add(job.jobId) });
  check(!inSitemap.has(old.id) && !inSitemap.has(expired.id) && !inSitemap.has(dupExpired.id), "El sitemap no lista vencidas.", "El sitemap lista vencidas.");

  // Bounded: with at least three stale rows present, a limit of 1 deletes exactly one.
  check(await purgeOldJobs(1, true) === 1 && !(await wasJobArchived(old.id)), "Dry-run no mueve filas.", "Dry-run modificó archivo.");
  check((await purgeOldJobs(1)) === 1, "La purga respeta su tope por llamada.", "La purga ignoró su tope.");
  let drained = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await purgeOldJobs() === 0) { drained = true; break; }
  }
  check(drained, "Archivo se drena dentro del presupuesto.", "Archivo no se drenó en 20 intentos.");
  const remaining = await pool.query(`SELECT id FROM jobs WHERE id = ANY($1::uuid[])`, [
    [fresh.id, old.id, expired.id, dupFresh.id, dupExpired.id]
  ]);
  const remainingIds = new Set(remaining.rows.map((row) => row.id));
  check(remainingIds.has(fresh.id) && remainingIds.has(dupFresh.id), "La purga conserva las vigentes.", "La purga borró una vigente.");
  check(
    !remainingIds.has(old.id) && !remainingIds.has(expired.id) && !remainingIds.has(dupExpired.id),
    "La purga borra la de 45 días y las vencidas.",
    "La purga dejó vencidas en la tabla."
  );

  const snapshots = await pool.query(`SELECT job_id, reason, snapshot FROM archived_jobs WHERE job_id = ANY($1::uuid[])`, [[old.id, expired.id, dupExpired.id]]);
  const oldSnapshot = snapshots.rows.find((r) => r.job_id === old.id);
  check(snapshots.rowCount === 3 && oldSnapshot?.reason === 'age_limit' && oldSnapshot.snapshot.url === old.url &&
    snapshots.rows.find((r) => r.job_id === expired.id)?.reason === 'source_deadline',
    "Retiradas conservan ID, hechos y motivo en archivo privado.", "Se perdió contenido o motivo.");

  const tombstone = await pool.query(
    `SELECT 1 FROM indexing_queue WHERE job_id = $1 AND notification_type = 'URL_DELETED'`,
    [old.id]
  );
  check(tombstone.rowCount === 1, "La de 45 días deja lápida URL_DELETED (página 410).", "Falta la lápida URL_DELETED.");

  const remembered = await findExpiredUrlHashes([computeUrlHash(old.url), computeUrlHash(fresh.url)]);
  check(
    remembered.has(computeUrlHash(old.url)) && !remembered.has(computeUrlHash(fresh.url)),
    "La URL vencida queda registrada en expired_job_urls (y la vigente no).",
    "expired_job_urls no registró la URL vencida."
  );

  // The source keeps listing the old posting with no date of its own → it
  // arrives with publishedAt = now. It must not come back as "new".
  const resaved = await saveJobs([
    {
      jobId: "old",
      title: `Analista Vieja ${tag}`,
      company,
      location: "Bogotá, Colombia",
      url: old.url,
      dateText: "Reciente",
      source: "Magneto",
      publishedAt: new Date().toISOString()
    }
  ]);
  const back = await pool.query(`SELECT 1 FROM jobs WHERE url_hash = $1`, [computeUrlHash(old.url)]);
  check(resaved.savedCount === 0 && back.rowCount === 0, "Una URL vencida no se reinserta como nueva.", "La URL vencida volvió como nueva.");

  // Hash guard survives a failure in the separate expired-hash bookkeeping.
  await pool.query(`DELETE FROM expired_job_urls WHERE url_hash = $1`, [computeUrlHash(old.url)]);
  check((await findExpiredUrlHashes([computeUrlHash(old.url)])).has(computeUrlHash(old.url)),
    "Archivo mantiene bloqueo aun sin expired_job_urls.", "Falta protección independiente.");

  const closing = await insertJob({ title: `Cierre ${tag}`, publishedDaysAgo: 2 });
  await pool.query(`ALTER TABLE archived_jobs ADD CONSTRAINT archive_failure_fixture CHECK (reason <> 'source_closed') NOT VALID`);
  let failed = false;
  try { await deleteClosedJobs([closing.id]); } catch { failed = true; }
  finally { await pool.query(`ALTER TABLE archived_jobs DROP CONSTRAINT archive_failure_fixture`); }
  check(failed && (await getJobById(closing.id)) !== null && !(await wasJobArchived(closing.id)),
    "Fallo de archivo revierte retiro sin perder oferta.", "Retiro no fue atómico.");
  check(await deleteClosedJobs([closing.id], true) === 1 && !(await wasJobArchived(closing.id)),
    "Dry-run de cierre no escribe.", "Dry-run de cierre escribió.");
  check(await deleteClosedJobs([closing.id]) === 1 && await wasJobArchived(closing.id) && await getJobById(closing.id) === null,
    "Cierre antes de 30 días queda archivado y oculto.", "Cierre temprano no archivado.");
  check(await deleteClosedJobs([closing.id]) === 0, "Cierre repetido es idempotente.", "Cierre duplicado.");
  await pool.query(`UPDATE archived_jobs SET archived_at = NOW() - INTERVAL '181 days' WHERE job_id = ANY($1::uuid[])`, [[old.id, expired.id]]);
  check(await pruneJobArchive(1, true) === 1 && await wasJobArchived(old.id) && await wasJobArchived(expired.id),
    "Poda dry-run conserva archivo.", "Poda dry-run destructiva.");
  check(await pruneJobArchive(1) === 1, "Poda respeta límite de una fila.", "Poda sin límite.");
  check(await wasJobArchived(closing.id), "Poda conserva archivo reciente.", "Poda destruyó historia reciente.");

  await pool.query(`DELETE FROM jobs WHERE id = ANY($1::uuid[])`, [[fresh.id, dupFresh.id]]);
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
    console.log("\nFrescura de vacantes: todo verde.");
  });
