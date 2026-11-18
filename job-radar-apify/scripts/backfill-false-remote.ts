/**
 * One-time backfill for jobs stored as remote without the source saying so
 * (user report 2026-11-15: "dicen híbrido o remoto aquí pero en la plataforma
 * real dicen presencial"). The ingest side is fixed in
 * src/lib/job-posting-jsonld.ts (statesFullyRemote) and
 * src/sources/magneto-catalog.ts; this corrects the rows saved before that.
 * NO NETWORK: it only rewrites what is already stored.
 *
 * A. remote_type = 'fully_remote' on LinkedIn / Elempleo / Computrabajo /
 *    Magneto / Glassdoor rows -> NULL. These sources only ever got that value
 *    from the detail page's `jobLocationType: TELECOMMUTE`, which Elempleo
 *    stamps on every posting and LinkedIn also puts on hybrid ones, always
 *    next to a real city. The modality goes back to the title/location
 *    classifier (job-modality.ts): "Híbrido"/"Remoto" if the title says so,
 *    "Sin especificar" otherwise. applicant_countries is left as stored — it
 *    is only ever read together with fully_remote.
 *    WeRemoto, GetOnBoard, Torre and "Portal oficial" are NOT touched: their
 *    value comes from the source's own modality field.
 *
 * B. Magneto rows with location = 'Remoto' -> location 'Colombia', country
 *    'CO'. Magneto's isRemote checkbox ("Remoto / híbrido en: {ciudad}") was
 *    read as 100% remote and replaced the city, which is not stored anywhere
 *    else; 'Colombia' is the only fact left (the catalog is /co/ only). These
 *    rows also had country NULL, so they showed in the Venezuela dashboard.
 *
 * Every row goes through mutateReadinessRelevantJobs, so the Google verdict
 * (and the TELECOMMUTE JobPosting those rows emitted) is recomputed in the
 * same transaction.
 *
 *   npx tsx scripts/backfill-false-remote.ts            # dry-run (default)
 *   npx tsx scripts/backfill-false-remote.ts --apply
 *
 * Idempotent: a second run finds zero rows.
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { mutateReadinessRelevantJobs, type ReadinessMutationPatch } from "../src/db/job-readiness-repository.js";

dotenv.config();
const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 500;

const JSONLD_DETAIL_SOURCES = ["LinkedIn", "Elempleo", "Computrabajo", "Magneto", "Glassdoor"];

async function fix(label: string, where: string, params: unknown[], patch: ReadinessMutationPatch): Promise<void> {
  const summary = await pool.query<{ source: string; active: boolean; n: string }>(
    `SELECT source, COALESCE(is_active, FALSE) AS active, COUNT(*) AS n FROM jobs WHERE ${where} GROUP BY 1, 2 ORDER BY 1, 2 DESC`,
    params
  );
  console.log(`\n${label}`);
  if (summary.rows.length === 0) console.log("   0 filas.");
  for (const row of summary.rows) console.log(`   ${row.source} ${row.active ? "activas" : "inactivas"}: ${row.n}`);

  const sample = await pool.query<{ title: string; location: string | null; url: string }>(
    `SELECT title, location, url FROM jobs WHERE ${where} AND is_active = TRUE ORDER BY published_at DESC LIMIT 5`,
    params
  );
  for (const row of sample.rows) console.log(`     · ${row.title} | ${row.location ?? ""} | ${row.url}`);
  if (!APPLY) return;

  const candidates = await pool.query<{ id: string }>(`SELECT id FROM jobs WHERE ${where} ORDER BY id`, params);
  let changed = 0;
  for (let offset = 0; offset < candidates.rows.length; offset += BATCH_SIZE) {
    const outcomes = await mutateReadinessRelevantJobs(
      candidates.rows.slice(offset, offset + BATCH_SIZE).map((row) => ({ id: row.id, patch })),
      { contentObtained: true }
    );
    changed += outcomes.length;
  }
  const left = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM jobs WHERE ${where}`, params);
  console.log(`   ✅ ${changed} de ${candidates.rows.length} corregidas; quedan ${left.rows[0].n}.`);
}

async function main() {
  console.log(`🔧 [backfill-false-remote] ${APPLY ? "APPLY" : "DRY-RUN (sin escrituras)"}`);
  await fix(
    "A. remote_type='fully_remote' tomado de TELECOMMUTE junto a una ciudad -> NULL",
    `remote_type = 'fully_remote' AND source = ANY($1::text[])`,
    [JSONLD_DETAIL_SOURCES],
    { remote_type: null }
  );
  await fix(
    "B. Magneto con location='Remoto' (casilla 'Remoto / híbrido') -> 'Colombia', country CO",
    `source = 'Magneto' AND lower(btrim(location)) = 'remoto'`,
    [],
    { location: "Colombia", country: "CO" }
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error("❌ [backfill-false-remote] Error:", err?.message || err);
  await pool.end();
  process.exit(1);
});
