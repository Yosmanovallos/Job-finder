/**
 * Migration for saved / applied jobs in "Mi cuenta" (2026-10-27).
 * Applies schema.sql's additive `saved-jobs` block: ONE new table
 * (user_saved_jobs) with RLS + REVOKE. Nothing existing is altered.
 *
 * Run once, explicitly:
 *   npx tsx scripts/migrate-saved-jobs.ts --dry-run
 *   npx tsx scripts/migrate-saved-jobs.ts                      (local DB)
 *   npx tsx scripts/migrate-saved-jobs.ts --allow-remote-db    (production — needs approval;
 *                                                               direct-employers-tick.yml mode saved-jobs-migrate)
 *
 * Safe to re-run: IF NOT EXISTS everywhere. Until it runs, the API answers
 * 503 for saved jobs and the rest of the site is unaffected.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

const TABLE = "user_saved_jobs";

async function main() {
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  try {
    const existing = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [TABLE]
    );
    if (process.argv.includes("--dry-run")) {
      console.log(
        `[migrate-saved-jobs] --dry-run: no se escribió nada. ${TABLE} ${existing.rowCount ? "ya existe" : "se crearía (tabla nueva, con RLS y sin permisos para anon/authenticated)"}.`
      );
      return;
    }
    const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
    const block = /-- BEGIN saved-jobs\r?\n([\s\S]*?)-- END saved-jobs/.exec(schema)?.[1];
    if (!block) throw new Error("schema.sql no contiene el bloque saved-jobs.");
    await pool.query(block);

    const after = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [TABLE]
    );
    if (!after.rowCount) throw new Error(`${TABLE} no quedó creada.`);
    // Proof, not hope: on Supabase, RLS + REVOKE is the only barrier between
    // this table and the public anon key (security audit 2026-08-02).
    const rls = await pool.query(
      `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = $1 AND c.relrowsecurity`,
      [TABLE]
    );
    if (!rls.rowCount) throw new Error(`RLS desactivado en ${TABLE}.`);
    const grants = await pool.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = $1 AND grantee IN ('anon', 'authenticated')`,
      [TABLE]
    );
    if (grants.rowCount) {
      throw new Error(`permisos públicos sin revocar: ${grants.rows.map((row) => `${row.grantee}:${row.privilege_type}`).join(", ")}`);
    }
    console.log(`[migrate-saved-jobs] OK — ${TABLE} lista; RLS activo y 0 permisos para anon/authenticated.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate-saved-jobs] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
