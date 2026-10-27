/**
 * ATS inventory probe and automatic enablement, phase I2
 * (openspec/changes/ats-inventory-co-2026-11, INV-010…INV-014; ADR 0006 §13).
 * Reads due rows of ats_board_inventory, lists each board with its own
 * connector and the tick's Colombia filter, and classifies it: enabled,
 * no_colombia, agency, ambiguous, blocked, error or owned. Only a board that
 * meets every rule is enabled (insert-only: employers / employer_aliases /
 * employer_sources). Never writes `jobs`; the hourly tick reads new boards.
 *
 * DRY RUN by default: reads the database in READ ONLY transactions, probes
 * the boards and prints what it would do. `--execute` writes.
 *
 *   npx tsx scripts/direct-ats-probe.ts [--limit 500] [--max-enable 25] [--deadline-min 6]
 *       [--execute] [--allow-remote-db]
 *
 * Budgets (AGENTS.md rule 12): --limit boards per run (max 5000), 3 boards at
 * a time with the connectors' own timeouts and page caps, --max-enable boards
 * enabled per run (default 25, max 100), and a --deadline-min wall clock
 * after which no new board starts.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import { boundedGet } from "../src/direct/http.js";
import { parseAgencyKeys } from "../src/direct/discovery/candidates.js";
import { inventoryKey } from "../src/direct/discovery/inventory.js";
import { runInventoryProbe } from "../src/direct/discovery/inventory-probe.js";

dotenv.config();

const CONCURRENCY = 3;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function boundedInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(argValue(name) ?? fallback);
  return Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;
}

function printCounts(title: string, counts: Record<string, number>): void {
  console.log(title);
  for (const [key, value] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${key.padEnd(16)} ${value}`);
}

async function main() {
  const execute = process.argv.includes("--execute");
  const limit = boundedInt("--limit", 500, 1, 5_000);
  const maxEnable = boundedInt("--max-enable", 25, 0, 100);
  const deadlineAt = Date.now() + boundedInt("--deadline-min", 6, 1, 17) * 60_000;
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const agencyKeys = parseAgencyKeys(JSON.parse(await readFile(new URL("../data/direct-discovery-agencies.json", import.meta.url), "utf8")));
  const repo = await import("../src/db/direct-inventory-repository.js");
  const { pool } = await import("../src/db/client.js");

  try {
    if (!(await repo.inventoryTableExists())) {
      console.log("[ats-probe] ats_board_inventory no existe: nada que sondear (aplica antes la migración).");
      return;
    }
    const before = await repo.inventoryStatusCounts();
    const due = await repo.pickDueInventory(limit);
    const owned = await repo.ownedBoardKeys();
    const pending = before.pending ?? 0;
    console.log(
      `[ats-probe] Inventario: ${Object.values(before).reduce((sum, n) => sum + n, 0)} filas, ${pending} pendientes. ` +
        `A sondear en esta corrida: ${due.length} (tope ${limit}; habilitaciones máx. ${maxEnable}).` +
        (execute ? "" : " Dry-run: no se escribe nada (enabled* = se habilitaría).")
    );
    console.log(`  ${"tablero".padEnd(49)}${"estado".padEnd(12)}${"CO/total".padEnd(12)}${"nombre declarado".padEnd(33)}motivo`);

    const summary = await runInventoryProbe(due, {
      http: boundedGet,
      now: () => new Date(),
      agencyKeys,
      execute,
      maxEnable,
      deadlineAt,
      concurrency: CONCURRENCY,
      isOwned: (board) => owned.has(inventoryKey(board.atsType, board.atsRef)),
      context: (board, verdict) => repo.readOnly((query) => repo.enablementContext(query, board, verdict)),
      promote: (board, verdict) => repo.promoteInventoryBoard(board, verdict),
      record: async (board, outcome) => {
        await repo.recordInventoryProbe(board, outcome);
      },
      log: (text) => console.log(text)
    });

    console.log(
      `\n[ats-probe] ${summary.probed} de ${due.length} sondeados${summary.stoppedBy ? ` (se detuvo por plazo; ${summary.remaining} quedan para la próxima)` : ""}` +
        ` · ${execute ? "habilitados" : "se habilitarían"} ${summary.enabled}` +
        (summary.deferred ? ` · ${summary.deferred} elegibles sobre el tope, siguen pendientes` : "")
    );
    printCounts("Por estado (esta corrida):", summary.byStatus);
    if (execute) printCounts("Inventario completo por estado (después):", await repo.inventoryStatusCounts());
    else printCounts("Inventario completo por estado (sin cambios, dry-run):", before);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[ats-probe] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
