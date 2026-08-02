/**
 * Gate script for the dedupe-fingerprint fix (computeContentFingerprint's
 * fallback changed from the literal "colombia" to the job's own country's
 * name — see job-repository.ts). Read-only: recomputes the fingerprint for
 * every existing row using the NEW logic and compares it against the
 * ALREADY-STORED content_fingerprint. Any mismatch means the fix isn't the
 * no-op it's designed to be for pre-existing data, and deploying it would
 * silently re-bucket those rows — this script is the gate that catches that
 * BEFORE it happens, not after.
 *
 * Run:
 *   cd job-radar-apify && npx tsx scripts/verify-fingerprint-compat.ts
 *
 * Exits non-zero (and prints the offending rows) on any mismatch.
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { computeContentFingerprint } from "../src/db/job-repository.js";

dotenv.config();

async function main() {
  console.log("🔍 [verify-fingerprint-compat] Recomputing fingerprints for all rows...\n");

  const result = await pool.query(
    `SELECT id, title, company, location, country, content_fingerprint FROM jobs WHERE content_fingerprint IS NOT NULL`
  );

  console.log(`📊 Rows with a stored content_fingerprint: ${result.rows.length}`);

  let mismatches = 0;
  const sample: any[] = [];

  for (const row of result.rows) {
    const recomputed = computeContentFingerprint({
      jobId: row.id,
      title: row.title,
      company: row.company,
      location: row.location,
      country: row.country,
      // Unused by computeContentFingerprint, required by the Job type.
      url: "",
      dateText: "",
      source: ""
    } as any);

    if (recomputed !== row.content_fingerprint) {
      mismatches++;
      if (sample.length < 10) {
        sample.push({
          id: row.id,
          title: row.title,
          company: row.company,
          location: row.location,
          country: row.country,
          stored: row.content_fingerprint,
          recomputed
        });
      }
    }
  }

  console.log("═══════════════════════════════════════════════════");
  if (mismatches === 0) {
    console.log("✅ RESULTADO: 0 mismatches. El fix es un no-op confirmado para todas las filas existentes.");
    console.log("   Seguro desplegar — el fallback nuevo hashea igual que el viejo para el corpus actual.");
  } else {
    console.error(`❌ RESULTADO: ${mismatches} mismatches de ${result.rows.length} filas.`);
    console.error("   NO desplegar este cambio tal cual — investigar antes de continuar. Muestra:");
    for (const s of sample) {
      console.error(`   - id=${s.id} title="${s.title}" company="${s.company}" location="${s.location}" country=${s.country}`);
      console.error(`     stored=${s.stored} recomputed=${s.recomputed}`);
    }
  }
  console.log("═══════════════════════════════════════════════════\n");

  await pool.end();
  if (mismatches > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("❌ [verify-fingerprint-compat] Error:", err?.message || err);
  await pool.end();
  process.exit(1);
});
