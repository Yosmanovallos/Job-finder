/**
 * Migration for the AI Resume Studio R1 (ADR 0017, 2026-11-21).
 * Applies schema.sql's additive `resume-studio` block: new tables
 * (rs_consents, rs_resumes, rs_resume_versions; R2: rs_job_snapshot_cache) with RLS + REVOKE and an
 * insert-only trigger on rs_consents. Nothing existing is altered.
 *
 * LOCAL ONLY until R5: ADR 0017 §6 says the rs_* tables are tested in the
 * disposable PostgreSQL of `npm run test:integration` and never run in
 * Supabase before the single approved merge. That is why this script, unlike
 * the other migrate-* scripts, rejects --allow-remote-db outright.
 *
 *   npx tsx scripts/migrate-resume-studio.ts --dry-run
 *   npx tsx scripts/migrate-resume-studio.ts           (local DB only)
 *
 * Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE everywhere.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

const TABLES = ["rs_consents", "rs_resumes", "rs_resume_versions", "rs_job_snapshot_cache"];

async function main() {
  if (process.argv.includes("--allow-remote-db")) {
    throw new Error("Bloqueado hasta R5: las tablas rs_* no se migran en Supabase antes del merge aprobado (ADR 0017 §6).");
  }
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  try {
    const existing = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [TABLES]
    );
    if (process.argv.includes("--dry-run")) {
      const present = new Set(existing.rows.map((row) => row.table_name));
      for (const table of TABLES) {
        console.log(`[migrate-resume-studio] --dry-run: ${table} ${present.has(table) ? "ya existe" : "se crearía"}.`);
      }
      return;
    }
    const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
    const block = /-- BEGIN resume-studio\r?\n([\s\S]*?)-- END resume-studio/.exec(schema)?.[1];
    if (!block) throw new Error("schema.sql no contiene el bloque resume-studio.");
    await pool.query(block);

    for (const table of TABLES) {
      const rls = await pool.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = $1 AND c.relrowsecurity`,
        [table]
      );
      if (!rls.rowCount) throw new Error(`RLS desactivado en ${table}.`);
      const grants = await pool.query(
        `SELECT 1 FROM information_schema.role_table_grants
         WHERE table_schema = 'public' AND table_name = $1 AND grantee IN ('anon', 'authenticated')`,
        [table]
      );
      if (grants.rowCount) throw new Error(`permisos públicos sin revocar en ${table}.`);
    }
    console.log("[migrate-resume-studio] OK — rs_* listas; RLS activo y 0 permisos para anon/authenticated.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate-resume-studio] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
