/**
 * Migration for signup attribution (Fase A, 2026-11-07).
 * Applies schema.sql's additive `signup-attribution` block: six new NULL
 * columns on `users` (first_touch_*). No index, no default, no backfill:
 * every existing row keeps its values and the new columns stay NULL.
 *
 * Run once, explicitly:
 *   npx tsx scripts/migrate-signup-attribution.ts --dry-run
 *   npx tsx scripts/migrate-signup-attribution.ts                      (local DB)
 *   npx tsx scripts/migrate-signup-attribution.ts --allow-remote-db    (production — needs approval)
 *
 * Safe to re-run: ADD COLUMN IF NOT EXISTS everywhere. Until it runs,
 * POST /api/me/first-touch answers 204 and stores nothing; the rest of the
 * site is unaffected.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

const COLUMNS = [
  "first_touch_path",
  "first_touch_referrer_host",
  "first_touch_utm_source",
  "first_touch_utm_medium",
  "first_touch_utm_campaign",
  "first_touch_at"
];

async function main() {
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  try {
    const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
    const block = /-- BEGIN signup-attribution\r?\n([\s\S]*?)-- END signup-attribution/.exec(schema)?.[1];
    if (!block) throw new Error("schema.sql no contiene el bloque signup-attribution.");

    const present = async () =>
      (
        await pool.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'users' AND column_name = ANY($1)`,
          [COLUMNS]
        )
      ).rows.map((row) => row.column_name);

    const before = await present();
    if (process.argv.includes("--dry-run")) {
      const statements = block
        .split("\n")
        .filter((line) => line.startsWith("ALTER TABLE"))
        .join("\n");
      console.log(
        `[migrate-signup-attribution] --dry-run: no se escribió nada. Columnas ya presentes: ${before.join(", ") || "ninguna"}.`
      );
      console.log(`[migrate-signup-attribution] SQL que se aplicaría:\n${statements}`);
      const count = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`);
      console.log(`[migrate-signup-attribution] filas en users: ${count.rows[0]!.n} (ninguna cambia).`);
      return;
    }

    await pool.query(block);
    const after = await present();
    const missing = COLUMNS.filter((column) => !after.includes(column));
    if (missing.length) throw new Error(`faltan columnas tras la migración: ${missing.join(", ")}`);
    console.log(
      `[migrate-signup-attribution] OK — ${COLUMNS.length} columnas first_touch_* en users (${COLUMNS.length - before.length} nuevas).`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[migrate-signup-attribution] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
