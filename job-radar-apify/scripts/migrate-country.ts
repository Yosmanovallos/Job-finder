/**
 * Migration: Backfill `jobs.country` for pre-existing rows (all sourced as
 * Colombia before the Venezuela expansion — see backlog/venezuela-expansion.md).
 *
 * NOT a blind `UPDATE jobs SET country = 'CO'`: rows whose `location` reads
 * as remote (same detector as job-filters.ts's getModalityLabel — "remoto"/
 * "remote") must stay `country IS NULL`, matching schema.sql's convention
 * that NULL means "shows for every country", not "unmigrated". A blind
 * backfill would stamp every remote job 'CO' and make it disappear from
 * Venezuela's listing — silently breaking the one behavior the whole
 * single-app/single-DB architecture decision exists to preserve.
 *
 * ALSO excludes ALWAYS_REMOTE_SOURCES (RemoteOK/Remotive/WeRemoto) from the
 * location-text check entirely, same as resolveJobCountry() (countries/
 * index.ts) does for newly-scraped jobs — their location field is real
 * unfiltered upstream text ("Worldwide"/"Anywhere"/a specific country),
 * which the remoto/remote substring check does not reliably catch. An
 * earlier run of this script (before that source list existed) mislabeled
 * 343 such rows 'CO'; this version doesn't reproduce that on a fresh re-run.
 *
 * Run once after deploying the schema change:
 *   cd job-radar-apify && npx tsx scripts/migrate-country.ts
 *
 * Safe to re-run — every step is idempotent (only touches country IS NULL rows,
 * and remote rows are left NULL both before and after).
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { ALWAYS_REMOTE_SOURCES } from "../src/countries/index.js";

dotenv.config();

async function main() {
  console.log("🔧 [migrate-country] Starting migration...\n");

  const alwaysRemoteSources = Array.from(ALWAYS_REMOTE_SOURCES);

  const totalBefore = await pool.query(`SELECT COUNT(*) AS total FROM jobs`);
  console.log(`📊 Total jobs (before): ${totalBefore.rows[0].total}`);

  // COALESCE(location, '') before the LIKE checks: a NULL location would
  // otherwise make both LIKEs evaluate to NULL, and `NOT (NULL OR NULL)` is
  // NULL (not true) in a WHERE clause — silently excluding that row from
  // the backfill entirely instead of correctly treating "no location" as
  // "not detectably remote, so CO".
  const remoteBefore = await pool.query(
    `SELECT COUNT(*) AS total FROM jobs WHERE country IS NULL
       AND (source = ANY($1) OR lower(COALESCE(location, '')) LIKE '%remoto%' OR lower(COALESCE(location, '')) LIKE '%remote%')`,
    [alwaysRemoteSources]
  );
  console.log(`📊 Detected as remote (source-based or location-based, will stay country IS NULL): ${remoteBefore.rows[0].total}`);

  const result = await pool.query(
    `UPDATE jobs SET country = 'CO'
     WHERE country IS NULL
       AND NOT (source = ANY($1))
       AND NOT (lower(COALESCE(location, '')) LIKE '%remoto%' OR lower(COALESCE(location, '')) LIKE '%remote%')`,
    [alwaysRemoteSources]
  );
  console.log(`✅ Backfilled country='CO' on ${result.rowCount} rows.\n`);

  const stillNull = await pool.query(`SELECT COUNT(*) AS total FROM jobs WHERE country IS NULL`);
  const co = await pool.query(`SELECT COUNT(*) AS total FROM jobs WHERE country = 'CO'`);
  const totalAfter = await pool.query(`SELECT COUNT(*) AS total FROM jobs`);

  console.log("═══════════════════════════════════════════════════");
  console.log("📊 RESULTADO FINAL:");
  console.log(`   Total (antes):        ${totalBefore.rows[0].total}`);
  console.log(`   Total (después):      ${totalAfter.rows[0].total}`);
  console.log(`   country = 'CO':       ${co.rows[0].total}`);
  console.log(`   country IS NULL:      ${stillNull.rows[0].total}  (debe coincidir con "detectado como remoto" arriba)`);
  console.log("═══════════════════════════════════════════════════\n");

  if (Number(stillNull.rows[0].total) !== Number(remoteBefore.rows[0].total)) {
    console.warn(
      "⚠️  El conteo de country IS NULL después no coincide con el de remotos detectado antes. " +
        "Revisar antes de asumir que el backfill quedó correcto (posible fila con country ya seteado desde otra fuente, o edge case de location vacío)."
    );
  }

  if (Number(totalBefore.rows[0].total) !== Number(totalAfter.rows[0].total)) {
    throw new Error(
      `Total de filas cambió durante la migración (${totalBefore.rows[0].total} -> ${totalAfter.rows[0].total}) — esto NUNCA debería pasar en un backfill (solo UPDATE, cero INSERT/DELETE). Investigar antes de continuar.`
    );
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error("❌ [migrate-country] Error:", err?.message || err);
  await pool.end();
  process.exit(1);
});
