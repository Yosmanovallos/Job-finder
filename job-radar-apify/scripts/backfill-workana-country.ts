/**
 * One-time backfill: clear `jobs.country` for rows saved before Workana was
 * added to ALWAYS_REMOTE_SOURCES (src/countries/index.ts).
 *
 * Before that fix, `resolveJobCountry()` hard-stamped every Workana row with
 * whichever tick fetched it — always 'CO', since WorkanaV2 only runs on the
 * CO-tick's global-catalog step (never VE's, to avoid double-fetching the
 * same global catalog). Workana's `location` field is the client's own
 * country text ("Argentina", "México", "España", ...), essentially never the
 * literal "remoto"/"remote" isRemoteLocation() checks for — so every one of
 * those got permanently mislabeled 'CO' and hidden from /ve/dashboard,
 * including projects that were never Colombia-specific to begin with
 * (confirmed empirically: 80/80 Workana rows had country='CO' pre-fix).
 *
 * Only touches source = 'Workana' rows — every other source's country
 * stamp is unaffected and this does not delete or re-insert anything, only
 * corrects the `country` column on existing rows.
 *
 * Run once after deploying the ALWAYS_REMOTE_SOURCES fix:
 *   cd job-radar-apify && npx tsx scripts/backfill-workana-country.ts
 *
 * Safe to re-run — idempotent (only touches source='Workana' AND country IS
 * NOT NULL rows; once cleared, a re-run finds zero rows to touch).
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { mutateReadinessRelevantJobs } from "../src/db/job-readiness-repository.js";

dotenv.config();
const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 500;

async function main() {
  console.log(`🔧 [backfill-workana-country] ${APPLY ? "APPLY" : "DRY-RUN (sin escrituras)"}...\n`);

  const before = await pool.query(
    `SELECT country, COUNT(*) AS n FROM jobs WHERE source = 'Workana' GROUP BY country ORDER BY n DESC`
  );
  console.log("📊 Workana rows by country (before):");
  for (const row of before.rows) {
    console.log(`   country=${row.country ?? "NULL"}: ${row.n}`);
  }

  const candidates = await pool.query<{ id: string }>(
    `SELECT id FROM jobs WHERE source = 'Workana' AND country IS NOT NULL ORDER BY id`
  );
  let changed = 0;
  if (APPLY) {
    for (let offset = 0; offset < candidates.rows.length; offset += BATCH_SIZE) {
      const outcomes = await mutateReadinessRelevantJobs(
        candidates.rows.slice(offset, offset + BATCH_SIZE).map((row) => ({ id: row.id, patch: { country: null } })),
        { contentObtained: true }
      );
      changed += outcomes.length;
    }
  }
  console.log(`\n${APPLY ? "✅ Cleared" : "📋 Would clear"} country on ${APPLY ? changed : candidates.rows.length} Workana row(s) through the readiness mutation path.\n`);

  const after = await pool.query(
    `SELECT country, COUNT(*) AS n FROM jobs WHERE source = 'Workana' GROUP BY country ORDER BY n DESC`
  );
  console.log("📊 Workana rows by country (after):");
  for (const row of after.rows) {
    console.log(`   country=${row.country ?? "NULL"}: ${row.n}`);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error("❌ [backfill-workana-country] Error:", err?.message || err);
  await pool.end();
  process.exit(1);
});
