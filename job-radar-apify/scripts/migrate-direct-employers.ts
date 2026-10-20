/**
 * Migration for official employer vacancies (docs/adr/0006-direct-employers.md).
 * Applies schema.sql's additive `direct-employers` block (four NEW tables) and
 * `direct-discovery` block (employer_discovery, phase D3), all with RLS +
 * REVOKE. Touches no existing table, so it takes no lock on `jobs`.
 *
 * Run once, explicitly:
 *   npx tsx scripts/migrate-direct-employers.ts --dry-run
 *   npx tsx scripts/migrate-direct-employers.ts                      (local DB)
 *   npx tsx scripts/migrate-direct-employers.ts --allow-remote-db    (production, phase D2 — needs approval)
 *
 * Safe to re-run: IF NOT EXISTS everywhere.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

const TABLES = ["employers", "employer_aliases", "employer_sources", "direct_jobs", "employer_discovery"];
const BLOCKS = ["direct-employers", "direct-discovery"];

async function main() {
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  try {
    const existing = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [TABLES]
    );
    const present = existing.rows.map((row) => row.table_name);
    if (process.argv.includes("--dry-run")) {
      console.log(
        `[migrate-direct-employers] --dry-run: no se escribió nada. Ya existen: ${present.join(", ") || "ninguna"}; ` +
          `se crearían: ${TABLES.filter((table) => !present.includes(table)).join(", ") || "ninguna"}.`
      );
      return;
    }
    const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
    for (const name of BLOCKS) {
      const block = new RegExp(`-- BEGIN ${name}\\r?\\n([\\s\\S]*?)-- END ${name}`).exec(schema)?.[1];
      if (!block) throw new Error(`schema.sql no contiene el bloque ${name}.`);
      await pool.query(block);
    }
    const after = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [TABLES]
    );
    if (after.rows[0].n !== TABLES.length) throw new Error(`se esperaban ${TABLES.length} tablas, hay ${after.rows[0].n}`);
    // Proof, not hope: on Supabase, RLS + REVOKE is the only barrier between
    // these tables and the public anon key (security audit 2026-08-02).
    const rls = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1) AND NOT c.relrowsecurity`,
      [TABLES]
    );
    if (rls.rowCount) throw new Error(`RLS desactivado en: ${rls.rows.map((row) => row.relname).join(", ")}`);
    const grants = await pool.query<{ grantee: string; table_name: string; privilege_type: string }>(
      `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = ANY($1) AND grantee IN ('anon', 'authenticated')`,
      [TABLES]
    );
    if (grants.rowCount) {
      throw new Error(`permisos públicos sin revocar: ${grants.rows.map((row) => `${row.grantee}:${row.table_name}:${row.privilege_type}`).join(", ")}`);
    }
    console.log(`[migrate-direct-employers] OK — ${TABLES.join(", ")} listas; RLS activo y 0 permisos para anon/authenticated.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate-direct-employers] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
