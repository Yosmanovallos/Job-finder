/**
 * Empties the tables of the removed CV Generator / Resume Studio / BYOK
 * (removed from production 2026-10-18, ESTADO-ACTUAL.md §4): CVs uploaded in
 * tests may hold personal data and nothing cleans them since the retention
 * workflow went away. Owner decision 2026-10-22: empty the rows, keep the
 * tables (no DDL).
 *
 *   npx tsx scripts/purge-cv-data.ts --dry-run [--allow-remote-db]   counts only, READ ONLY
 *   npx tsx scripts/purge-cv-data.ts --execute [--allow-remote-db]   TRUNCATE, one transaction
 *
 * The five tables only reference each other and `users`/`jobs`, and nothing
 * else references them, so they are truncated together without CASCADE: if
 * some other table ever pointed at one of them, Postgres refuses instead of
 * silently emptying it too. Local database only unless --allow-remote-db.
 */
import dotenv from "dotenv";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

export const CV_TABLES = ["cv_profiles", "cv_generations", "llm_response_cache", "llm_usage_ledger", "user_ai_credentials"] as const;

async function main() {
  const execute = process.argv.includes("--execute");
  const dryRun = process.argv.includes("--dry-run");
  if (execute === dryRun) throw new Error("Usa exactamente uno: --dry-run o --execute.");
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const client = await pool.connect();
  try {
    await client.query(execute ? "BEGIN" : "BEGIN READ ONLY");
    const counts: Record<string, number> = {};
    for (const table of CV_TABLES) {
      const exists = await client.query("SELECT to_regclass($1) AS oid", [`public.${table}`]);
      if (!exists.rows[0].oid) {
        console.log(`  ${table.padEnd(22)} no existe — se omite`);
        continue;
      }
      const result = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
      counts[table] = Number(result.rows[0].n);
      console.log(`  ${table.padEnd(22)} ${counts[table]} filas`);
    }
    const present = Object.keys(counts);
    if (execute && present.length > 0) {
      await client.query(`TRUNCATE ${present.join(", ")}`);
      await client.query("COMMIT");
      console.log(`[cv-purge] Vaciadas ${present.length} tablas (${Object.values(counts).reduce((a, b) => a + b, 0)} filas). Estructura intacta.`);
    } else {
      await client.query("ROLLBACK");
      console.log(`[cv-purge] ${execute ? "Nada que vaciar." : "Dry-run: no se modificó nada."}`);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[cv-purge] Falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
