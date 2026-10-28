/**
 * Human review and rollback of the ATS inventory probe, phase I2
 * (openspec/changes/ats-inventory-co-2026-11, design §8; ADR 0006 §13).
 *
 *   npx tsx scripts/direct-ats-inventory-review.ts list [--status ambiguous,agency] [--limit 100]
 *       Read-only: rows waiting for a person, most Colombian postings first.
 *   npx tsx scripts/direct-ats-inventory-review.ts approve <ats_type:ats_ref> [--dry-run]
 *       A person states the employer's name for an `ambiguous` board (an ATS
 *       that declares none: Ashby, Lever…). The board is listed again now and
 *       must be complete with ≥ 1 live Colombian posting; agency, generic and
 *       placeholder names are refused; insert-only with the same conflict
 *       checks as the automatic path.
 *   npx tsx scripts/direct-ats-inventory-review.ts revert <ats_type:ats_ref | all> [--dry-run]
 *       Rollback: boards the inventory enabled are switched off and become
 *       `ambiguous` with the reason. Nothing is deleted.
 *
 * The employer name (approve) and the reason (approve, revert) come from the
 * REVIEW_NAME and REVIEW_NOTE environment variables, so a workflow input is
 * never interpolated into a shell command. Local database only unless
 * --allow-remote-db.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import { boundedGet } from "../src/direct/http.js";
import { parseAgencyKeys } from "../src/direct/discovery/candidates.js";
import { conflictOf, readBoard, reviewVerdict } from "../src/direct/discovery/inventory-probe.js";
import { DIRECT_ATS_TYPES } from "../src/direct/types.js";

dotenv.config();

const VALUE_FLAGS = ["--status", "--limit"];

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseBoard(value: string | undefined): { atsType: string; atsRef: string } {
  const [atsType, ...rest] = (value ?? "").split(":");
  const atsRef = rest.join(":");
  if (!(DIRECT_ATS_TYPES as readonly string[]).includes(atsType) || !/^[A-Za-z0-9][A-Za-z0-9._@/-]{0,199}$/.test(atsRef)) {
    throw new Error("Tablero inválido: usa <ats_type:ats_ref> de un ATS con conector.");
  }
  return { atsType, atsRef };
}

function note(): string {
  const value = (process.env.REVIEW_NOTE ?? "").trim();
  if (value.length < 3) throw new Error("Falta el motivo (REVIEW_NOTE).");
  return value.slice(0, 200);
}

async function main() {
  const args = process.argv.slice(2).filter((arg, index, all) => !arg.startsWith("--") && !(index > 0 && VALUE_FLAGS.includes(all[index - 1])));
  const [command, target] = args;
  const dryRun = process.argv.includes("--dry-run");
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const repo = await import("../src/db/direct-inventory-repository.js");
  const { pool } = await import("../src/db/client.js");
  try {
    if (command === "list") {
      const statuses = (argValue("--status") ?? "ambiguous").split(",");
      const rows = await repo.listInventoryForReview(statuses, Math.min(Math.max(Number(argValue("--limit") ?? 100) || 100, 1), 1000));
      for (const row of rows) {
        const stats = row.colombiaCount === null ? "" : `${row.colombiaCount}/${row.totalCount} CO`;
        console.log(`${`${row.atsType}:${row.atsRef}`.slice(0, 48).padEnd(49)}${row.status.padEnd(11)}${stats.padEnd(12)}${(row.declaredName ?? "—").slice(0, 32).padEnd(33)}${row.reason ?? ""}`);
      }
      console.log(`\n${rows.length} tableros (${statuses.join(", ")}).`);
      return;
    }

    if (command === "approve") {
      const board = parseBoard(target);
      const name = (process.env.REVIEW_NAME ?? "").trim();
      if (!name) throw new Error("Falta el nombre de la empresa (REVIEW_NAME).");
      const row = await repo.getInventoryBoard(board.atsType, board.atsRef);
      if (!row) throw new Error("Ese tablero no está en el inventario: no se aprueba a ciegas.");
      if (row.status !== "ambiguous") throw new Error(`Solo se aprueban tableros ambiguous; este está en ${row.status}.`);
      const agencyKeys = parseAgencyKeys(JSON.parse(await readFile(new URL("../data/direct-discovery-agencies.json", import.meta.url), "utf8")));
      const verdict = reviewVerdict(name, await readBoard(row, boundedGet, new Date()), agencyKeys);
      if (verdict.status === "refused") throw new Error(`No se aprueba: ${verdict.reason}.`);
      const reason = `${verdict.reason} (${note()})`;
      const context = await repo.readOnly((query) => repo.enablementContext(query, row, verdict));
      const conflict = conflictOf(context, verdict.companyKey, false);
      if (conflict) throw new Error(`Conflicto (${conflict.status}), no se escribió nada: ${conflict.reason}.`);
      if (dryRun) return console.log(`--dry-run: se habilitaría ${board.atsType}:${row.atsRef} como "${verdict.declaredName}" (${verdict.colombiaCount} vacantes CO). Nada se escribió.`);
      const result = await repo.promoteInventoryBoard(row, { ...verdict, reason }, ["ambiguous"]);
      if (result.kind === "conflict") throw new Error(`Conflicto (${result.status}), no se escribió nada: ${result.reason}.`);
      return console.log(`Habilitado: ${board.atsType}:${row.atsRef} como "${verdict.declaredName}" (${verdict.colombiaCount} vacantes CO). Lo lee el próximo tick.`);
    }

    if (command === "revert") {
      const board = target === "all" ? null : parseBoard(target);
      const reason = note();
      const result = await repo.revertInventoryBoards(board, reason, dryRun);
      console.log(
        `${dryRun ? "--dry-run: se apagarían" : "Apagados"} ${result.boards.length} tableros habilitados por el inventario` +
          `${result.boards.length ? `: ${result.boards.join(", ")}` : ""}.${dryRun ? " Nada se escribió." : ` Motivo: ${reason}.`}`
      );
      return;
    }

    throw new Error("Uso: list [--status s1,s2] | approve <ats:ref> | revert <ats:ref|all>  (REVIEW_NAME / REVIEW_NOTE por entorno)");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[ats-inventory-review] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
