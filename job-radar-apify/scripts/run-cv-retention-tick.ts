/**
 * CV data retention cleanup (docs/CV-GENERATION-PLAN.md §8.3, Fase 9).
 * Runs separately from every other tick — retention only needs to check
 * once a day, unlike scraping (15 min) or indexing (hourly). Gets its own
 * GitHub Actions schedule (cv-retention-tick.yml, daily).
 *
 * `--dry-run` (AGENTS.md regla 10): mismos conteos, cero escritura —
 * `npx tsx scripts/run-cv-retention-tick.ts --dry-run`.
 *
 * No PII in logs (§8.2): only counts, never which user/CV.
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { cleanupExpiredCvData } from "../src/db/cv-retention-repository.js";

dotenv.config();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await cleanupExpiredCvData(() => new Date(), dryRun);
  const verb = dryRun ? "se limpiarían (dry-run, nada escrito)" : "limpiados";
  console.log(
    `✅ [cv-retention-tick] Done. cv_profiles ${verb}: ${result.profilesCleared}, cv_generations ${verb}: ${result.generationsCleared}.`
  );
  await pool.end();
}

main().catch((err) => {
  console.error("❌ [cv-retention-tick] Fatal error:", err);
  process.exit(1);
});
