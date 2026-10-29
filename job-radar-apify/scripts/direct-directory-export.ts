/**
 * Directory export, read-only: one JSON line per active directory company
 * (employer_discovery with live job-board vacancies) with its discovery
 * decision and enabled official boards. Input for the careers-page study
 * (docs/direct/careers-study-2026-10.md); nothing is written.
 *
 *   npx tsx scripts/direct-directory-export.ts --allow-remote-db   (workflow mode directory-export)
 */
import dotenv from "dotenv";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

async function main(): Promise<void> {
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await client.query("SET LOCAL statement_timeout = '180s'");
    const result = await client.query(
      `SELECT d.company_key, d.company_name, d.directory_count, d.decision, d.name_probe_status,
              d.site_probe_status, d.website_domain,
              (SELECT COUNT(*)::int FROM employer_aliases a JOIN employer_sources s ON s.employer_id = a.employer_id
                WHERE a.company_key = d.company_key AND s.enabled) AS enabled_boards
         FROM employer_discovery d
        WHERE d.directory_count > 0
        ORDER BY d.directory_count DESC, d.company_key`
    );
    await client.query("COMMIT");
    for (const row of result.rows) {
      console.log(JSON.stringify({
        key: row.company_key,
        name: String(row.company_name).trim(),
        n: row.directory_count,
        decision: row.decision,
        nameProbe: row.name_probe_status,
        siteProbe: row.site_probe_status,
        domain: row.website_domain,
        boards: row.enabled_boards
      }));
    }
    console.log(JSON.stringify({ kind: "summary", companies: result.rows.length }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[direct-directory-export] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
