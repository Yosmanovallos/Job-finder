/**
 * Local snapshot of the PUBLIC catalogue, for cold-path performance checks
 * and the visual comparison of phase D4/F5 (docs/adr/0006-direct-employers.md
 * §10). Reads production in a READ ONLY transaction and writes ONLY a separate
 * loopback database (`buscotrabajo_snapshot` in the local Docker container
 * of scripts/direct-local.ts — never the sandbox database, never production).
 *
 * Copies public vacancy data only: jobs, expired_job_urls, company
 * reputation and the direct-employer tables. Never users, transactions, CV
 * tables, credentials or the indexing queue.
 *
 *   npm run direct:local -- up
 *   npx tsx scripts/direct-local-snapshot.ts --allow-remote-db-read
 *
 * Then run the app against it:
 *   DATABASE_URL=postgresql://direct_local:direct_local@127.0.0.1:55433/buscotrabajo_snapshot
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

dotenv.config();

const LOCAL_ADMIN = "postgresql://direct_local:direct_local@127.0.0.1:55433/buscotrabajo_local";
export const SNAPSHOT_URL = "postgresql://direct_local:direct_local@127.0.0.1:55433/buscotrabajo_snapshot";
// Order matters: parents before children (employer_* reference employers).
const TABLES = [
  "jobs",
  "expired_job_urls",
  "company_reputation",
  "company_reputation_alias",
  "employers",
  "employer_aliases",
  "employer_sources",
  "direct_jobs",
  "employer_discovery"
];
const BATCH = 1_000;

async function main() {
  if (!process.argv.includes("--allow-remote-db-read")) {
    throw new Error("Lee producción (solo lectura): pasa --allow-remote-db-read a propósito.");
  }
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL (origen).");
  if (new URL(process.env.DATABASE_URL).hostname === "127.0.0.1") throw new Error("El origen ya es local: nada que copiar.");

  const admin = new Pool({ connectionString: LOCAL_ADMIN, max: 1 });
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'buscotrabajo_snapshot'`);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE buscotrabajo_snapshot`);
  await admin.end();

  const target = new Pool({ connectionString: SNAPSHOT_URL, max: 2 });
  const source = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });
  const reader = await source.connect();
  try {
    // schema.sql revokes from Supabase's roles: create them (no login) locally.
    await target.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$`);
    await target.query(await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
    await reader.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ");
    for (const table of TABLES) {
      const present = await reader.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [`public.${table}`]);
      if (!present.rows[0].present) {
        console.log(`  ${table.padEnd(26)} no existe en el origen — omitida`);
        continue;
      }
      // Only columns both sides have (the snapshot schema is this branch's).
      const columns = await target.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [table]
      );
      const sourceColumns = await reader.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [table]
      );
      const shared = columns.rows.map((row) => row.column_name).filter((name) => sourceColumns.rows.some((row) => row.column_name === name));
      const list = shared.map((name) => `"${name}"`).join(", ");
      await target.query(`TRUNCATE ${table} CASCADE`);
      let copied = 0;
      for (let offset = 0; ; offset += BATCH) {
        const rows = await reader.query(`SELECT ${list} FROM ${table} ORDER BY ctid LIMIT ${BATCH} OFFSET ${offset}`);
        if (rows.rows.length === 0) break;
        await target.query(
          `INSERT INTO ${table} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::${table}, $1::json)`,
          [JSON.stringify(rows.rows)]
        );
        copied += rows.rows.length;
      }
      const count = await reader.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      if (count.rows[0].n !== copied) throw new Error(`${table}: se copiaron ${copied} de ${count.rows[0].n} filas`);
      console.log(`  ${table.padEnd(26)} ${String(copied).padStart(7)} filas`);
    }
    await reader.query("COMMIT");
    await target.query("ANALYZE");
    console.log(`[snapshot] Listo (solo lectura en producción). BD local: ${SNAPSHOT_URL}`);
  } finally {
    reader.release();
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error("[snapshot] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
