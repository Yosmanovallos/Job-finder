/**
 * Database size report, read-only (docs/adr/0006-direct-employers.md): total
 * `pg_database_size` and the biggest tables (heap + indexes + TOAST). Run it
 * before and after any change that adds rows, and stop if the total gets close
 * to the Supabase plan's disk. Runs in a READ ONLY transaction. Local database
 * only unless --allow-remote-db.
 *
 *   npx tsx scripts/direct-db-size.ts [--allow-remote-db] [--top 25]
 */
import dotenv from "dotenv";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

function topArg(argv: string[]): number {
  const index = argv.indexOf("--top");
  const value = index >= 0 ? Number(argv[index + 1]) : 25;
  return Number.isInteger(value) && value > 0 && value <= 200 ? value : 25;
}

async function main() {
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const total = await client.query<{ bytes: string; pretty: string }>(
      "SELECT pg_database_size(current_database())::text AS bytes, pg_size_pretty(pg_database_size(current_database())) AS pretty"
    );
    const tables = await client.query<{ name: string; rows: string; total: string; total_bytes: string; indexes: string }>(
      `SELECT c.relname AS name,
              c.reltuples::bigint::text AS rows,
              pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
              pg_total_relation_size(c.oid)::text AS total_bytes,
              pg_size_pretty(pg_indexes_size(c.oid)) AS indexes
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT $1`,
      [topArg(process.argv)]
    );
    await client.query("COMMIT");
    console.log(`Fecha: ${new Date().toISOString()}`);
    console.log(`pg_database_size: ${total.rows[0].pretty} (${total.rows[0].bytes} bytes)`);
    console.log(`${"tabla".padEnd(34)} ${"filas~".padStart(10)} ${"total".padStart(10)} ${"índices".padStart(10)}`);
    for (const row of tables.rows) {
      console.log(`${row.name.padEnd(34)} ${row.rows.padStart(10)} ${row.total.padStart(10)} ${row.indexes.padStart(10)}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[direct-db-size] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
