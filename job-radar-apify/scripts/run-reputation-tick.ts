/**
 * Company reputation batch tick (docs/COMPANY-REPUTATION-PLAN.md, Fase R1).
 * Runs separately from vacancy scraping (run-scrape-tick.ts) and from the
 * Google Indexing drain (run-indexing-tick.ts): reputation rankings change
 * on an annual/semi-annual cadence, not every 15 minutes, so this gets its
 * own GitHub Actions schedule (reputation-tick.yml, weekly).
 *
 * REPUTATION_SOURCES (src/sources/reputation/index.ts) is empty until
 * Fase R2 registers the first real fetcher (Merco Talento) — running this
 * today is a real no-op that still exercises the whole pipeline (circuit
 * breaker via executeWithResilience, upsert via
 * company-reputation-repository.ts), the same "shipped inactive" pattern
 * this project already uses for the LLM prompt gateway.
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { executeWithResilience } from "../src/engine/resilient-fetch.js";
import { upsertReputationScores } from "../src/db/company-reputation-repository.js";
import { REPUTATION_SOURCES } from "../src/sources/reputation/index.js";
import { ReputationScoreInput } from "../src/sources/reputation/types.js";

dotenv.config();

async function main() {
  console.log(`📊 [reputation-tick] ${REPUTATION_SOURCES.length} fuente(s) registrada(s).`);

  let totalUpserted = 0;
  for (const source of REPUTATION_SOURCES) {
    const rows = await executeWithResilience<ReputationScoreInput>(source.name, () => source.fetch());
    if (rows.length > 0) {
      await upsertReputationScores(rows);
      totalUpserted += rows.length;
    }
    console.log(`   ${source.name}: ${rows.length} fila(s) actualizadas.`);
  }

  console.log(`✅ [reputation-tick] Done. Total upserted: ${totalUpserted}.`);
  await pool.end();
}

main().catch((err) => {
  console.error("❌ [reputation-tick] Fatal error:", err);
  process.exit(1);
});
