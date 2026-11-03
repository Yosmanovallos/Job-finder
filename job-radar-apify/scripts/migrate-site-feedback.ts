/**
 * Migration for "Opiniones y ayuda" (/opiniones, 2026-11-02).
 * Applies schema.sql's additive `site-feedback` block: ONE new table
 * (site_feedback) with RLS + REVOKE. Nothing existing is altered.
 *
 * Run once, explicitly:
 *   npx tsx scripts/migrate-site-feedback.ts --dry-run
 *   npx tsx scripts/migrate-site-feedback.ts                      (local DB)
 *   npx tsx scripts/migrate-site-feedback.ts --allow-remote-db    (production — only after the
 *                                                               owner approves the SQL)
 *
 * Safe to re-run: IF NOT EXISTS everywhere. Until it runs, the API answers
 * 503 for /api/feedback, the form falls back to the contact email and the rest of the site is unaffected.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

const TABLE = "site_feedback";

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
        `[migrate-site-feedback] --dry-run: no se escribió nada. ${TABLE} ${existing.rowCount ? "ya existe" : "se crearía (tabla nueva, con RLS y sin permisos para anon/authenticated)"}.`
      );
      if (existing.rowCount) {
        // A table of this name that schema.sql didn't create: describe it
        // (read-only) so it can be compared with the approved definition
        // before anything is applied. Row count only — never row contents.
        const columns = await pool.query<{ column_name: string; data_type: string; is_nullable: string; character_maximum_length: number | null; column_default: string | null }>(
          `SELECT column_name, data_type, is_nullable, character_maximum_length, column_default
           FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
          [TABLE]
        );
        for (const c of columns.rows) {
          console.log(
            `[migrate-site-feedback]   columna ${c.column_name}: ${c.data_type}${c.character_maximum_length ? `(${c.character_maximum_length})` : ""} ${c.is_nullable === "NO" ? "NOT NULL" : "NULL"}${c.column_default ? ` DEFAULT ${c.column_default}` : ""}`
          );
        }
        const constraints = await pool.query<{ conname: string; def: string }>(
          `SELECT conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
           WHERE n.nspname = 'public' AND t.relname = $1 ORDER BY conname`,
          [TABLE]
        );
        for (const c of constraints.rows) console.log(`[migrate-site-feedback]   restricción ${c.conname}: ${c.def}`);
        const count = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${TABLE}`);
        const rls = await pool.query<{ relrowsecurity: boolean }>(
          `SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = $1`,
          [TABLE]
        );
        const grants = await pool.query<{ grantee: string; privilege_type: string }>(
          `SELECT grantee, privilege_type FROM information_schema.role_table_grants
           WHERE table_schema = 'public' AND table_name = $1 AND grantee IN ('anon', 'authenticated') ORDER BY grantee, privilege_type`,
          [TABLE]
        );
        console.log(
          `[migrate-site-feedback]   filas: ${count.rows[0].n}; RLS: ${rls.rows[0]?.relrowsecurity ? "activo" : "DESACTIVADO"}; ` +
            `permisos públicos: ${grants.rows.map((g) => `${g.grantee}:${g.privilege_type}`).join(", ") || "ninguno"}`
        );
      }
      return;
    }
    const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
    const block = /-- BEGIN site-feedback\r?\n([\s\S]*?)-- END site-feedback/.exec(schema)?.[1];
    if (!block) throw new Error("schema.sql no contiene el bloque site-feedback.");
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
    console.log(`[migrate-site-feedback] OK — ${TABLE} lista; RLS activo y 0 permisos para anon/authenticated.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate-site-feedback] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
