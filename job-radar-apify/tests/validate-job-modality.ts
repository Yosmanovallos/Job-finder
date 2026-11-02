import "./require-isolated-database.js";
import { getJobsPage, saveJobs } from "../src/db/job-repository.js";
import { pool } from "../src/db/client.js";
import { applyJobFilters } from "../src/lib/job-filters.js";
import { classifyModality, sqlJobModality } from "../src/lib/job-modality.js";
import type { Job } from "../src/sources/types.js";
import { MODALITY_CASES } from "./fixtures/modality-cases.js";

// TS↔SQL parity of the modality classifier (job-modality.ts): the label a
// card shows, the in-memory filter and the Postgres filter must agree row
// for row, on the isolated database.

const TEST_URL_PREFIX = "https://www.example.com/job/modality-";
const COMPANY = "ZzModality Corp";

let failures = 0;

function check(condition: boolean, pass: string, fail: string): void {
  if (condition) console.log(`✅ ${pass}`);
  else {
    console.error(`❌ ${fail}`);
    failures++;
  }
}

const seed: Job[] = MODALITY_CASES.filter(([input]) => input.title).map(([input], index) => ({
  jobId: `modality-${index}`,
  title: input.title as string,
  company: COMPANY,
  location: input.location || "Colombia",
  url: `${TEST_URL_PREFIX}${index}`,
  dateText: "Hace 1 día",
  source: input.source || "LinkedIn",
  country: "CO",
  publishedAt: new Date(Date.now() - (index + 1) * 60_000).toISOString(),
  remoteType: (input.remoteType ?? undefined) as Job["remoteType"]
}));

async function run(): Promise<void> {
  console.log("\n--- Paridad TS↔SQL de la modalidad ---\n");
  await pool.query(`DELETE FROM jobs WHERE url LIKE $1`, [`${TEST_URL_PREFIX}%`]);
  await saveJobs(seed, "Modality test");

  const rows = (
    await pool.query(
      `SELECT url, title, location, source, remote_type, ${sqlJobModality()} AS modality
       FROM jobs WHERE url LIKE $1`,
      [`${TEST_URL_PREFIX}%`]
    )
  ).rows as Array<{ url: string; title: string; location: string; source: string; remote_type: string | null; modality: string }>;
  check(rows.length === seed.length, `Se guardaron las ${seed.length} filas de prueba.`, `Solo se guardaron ${rows.length} de ${seed.length} filas.`);

  const mismatches = rows.filter(
    (row) => row.modality !== classifyModality({ source: row.source, remoteType: row.remote_type, title: row.title, location: row.location })
  );
  check(
    mismatches.length === 0,
    `sqlJobModality() y classifyModality() coinciden en las ${rows.length} filas.`,
    `Difieren en: ${mismatches.map((row) => `${row.title} → SQL ${row.modality}`).join("; ")}`
  );

  // The edge rows the unit test also pins, with the database's own text.
  const kinds = new Set(rows.map((row) => row.modality));
  for (const kind of ["remoto", "hibrido", "presencial", "freelance", "unknown"]) {
    check(kinds.has(kind), `Hay filas de tipo ${kind}.`, `Ninguna fila salió como ${kind}: la paridad no cubre ese caso.`);
  }

  const all = await getJobsPage({ filters: { company: COMPANY }, limit: 100, offset: 0 });
  check(all.total === seed.length, "La página sin filtro trae todas las filas de prueba.", `La página trae ${all.total} filas.`);
  for (const modality of ["remoto", "hibrido", "presencial"]) {
    const page = await getJobsPage({ filters: { company: COMPANY, modality }, limit: 100, offset: 0 });
    const sqlIds = page.jobs.map((job) => job.url).sort();
    const memoryIds = applyJobFilters(all.jobs, { modality }).map((job) => job.url).sort();
    check(
      JSON.stringify(sqlIds) === JSON.stringify(memoryIds) && page.total === memoryIds.length,
      `modality=${modality}: SQL y filtro en memoria devuelven las mismas ${memoryIds.length} vacantes.`,
      `modality=${modality}: SQL ${sqlIds.length} (total ${page.total}) vs memoria ${memoryIds.length}.`
    );
  }
  check(
    all.jobs.some((job) => job.remoteType === "fully_remote"),
    "La página del dashboard lleva remoteType para la etiqueta de la tarjeta.",
    "La página del dashboard no trae remoteType: la tarjeta volvería a leer solo la ubicación."
  );

  await pool.query(`DELETE FROM jobs WHERE url LIKE $1`, [`${TEST_URL_PREFIX}%`]);
  await pool.end();
  if (failures > 0) process.exit(1);
  console.log("\n✅ La modalidad es la misma en TypeScript y en SQL.\n");
}

run().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
