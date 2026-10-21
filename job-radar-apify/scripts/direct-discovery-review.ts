/**
 * Human review of discovery (docs/adr/0006-direct-employers.md §7.1).
 *
 *   npx tsx scripts/direct-discovery-review.ts list [--decision needs_review,unsupported_ats] [--limit 50]
 *   npx tsx scripts/direct-discovery-review.ts approve <company_key> <ats_type:ats_ref> [--dry-run]
 *       Promotes ONE board the evidence already shows (re-listed now: must be
 *       complete with ≥ 1 live Colombian posting). Insert-only, like the
 *       automatic path.
 *   npx tsx scripts/direct-discovery-review.ts reject <company_key> "<motivo>" [--dry-run]
 *       Soft revert: sticky `rejected`, discovery's boards disabled, alias
 *       retired when discovery created the employer. Nothing is deleted.
 *
 * Local database only unless --allow-remote-db.
 */
import dotenv from "dotenv";
import { listBoard } from "../src/direct/connectors.js";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import { boundedGet } from "../src/direct/http.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import { DIRECT_ATS_TYPES, type DirectAtsType } from "../src/direct/types.js";

dotenv.config();

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const [command, key, extra] = process.argv.slice(2).filter((arg, index, all) => !arg.startsWith("--") && !(index > 0 && ["--decision", "--limit"].includes(all[index - 1])));
  const dryRun = process.argv.includes("--dry-run");
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const repo = await import("../src/db/direct-discovery-repository.js");
  try {
    if (command === "list") {
      const decisions = (argValue("--decision") ?? "needs_review").split(",");
      const rows = await repo.listForReview(decisions, Number(argValue("--limit") ?? 50));
      for (const row of rows) {
        console.log(`${row.companyKey.padEnd(28)} ${String(row.directoryCount).padStart(5)}  ${row.decision.padEnd(15)} ${row.companyName} — ${row.reason ?? ""}`);
        for (const board of row.evidence?.boards ?? []) {
          if (["verified", "needs_review", "unsupported", "magneto"].includes(board.outcome)) {
            console.log(
              `      ${board.atsType}:${board.atsRef} [${board.outcome}/${board.method}] ${board.declaredName ? `nombre ATS "${board.declaredName}" ` : ""}` +
                `${board.colombiaLive !== undefined ? `${board.colombiaLive} CO ` : ""}${board.pageUrl ?? ""}`
            );
          }
        }
        if (row.evidence?.site?.offsiteCareersHosts.length) console.log(`      empleo en otro host: ${row.evidence.site.offsiteCareersHosts.join(", ")}`);
      }
      console.log(`\n${rows.length} candidatos (${decisions.join(", ")}).`);
      return;
    }
    if (!key) throw new Error("Falta <company_key>.");
    const candidate = await repo.getCandidate(key);
    if (!candidate) throw new Error(`No existe el candidato ${key}.`);
    if (command === "approve") {
      const [atsType, ...rest] = (extra ?? "").split(":");
      const atsRef = rest.join(":");
      if (!(DIRECT_ATS_TYPES as readonly string[]).includes(atsType) || !atsRef) throw new Error("Tablero inválido: usa <ats_type:ats_ref> de un ATS con conector.");
      const shown = (candidate.evidence?.boards ?? []).some((board) => board.atsType === atsType && board.atsRef.toLowerCase() === atsRef.toLowerCase());
      if (!shown) throw new Error("Ese tablero no está en la evidencia del candidato: no se aprueba a ciegas.");
      const listing = await listBoard({ atsType: atsType as DirectAtsType, atsRef }, boundedGet);
      if (listing.kind !== "complete") throw new Error(`El tablero no se pudo listar completo ahora (${listing.kind}).`);
      const live = selectColombianPostings(listing.postings).postings.length;
      if (live === 0) throw new Error("El tablero no tiene hoy vacantes vigentes en Colombia.");
      if (dryRun) return console.log(`--dry-run: se aprobaría ${atsType}:${atsRef} para ${candidate.companyName} (${live} vacantes CO).`);
      const result = await repo.promoteCandidate(candidate, [{ atsType: atsType as DirectAtsType, atsRef, method: "name" }], "human", null);
      if (result.kind === "conflict") throw new Error(`Conflicto, no se escribió nada: ${result.reason}`);
      return console.log(`Aprobado: ${candidate.companyName} → ${result.boards.join(", ") || "(tablero ya era suyo)"} (${live} vacantes CO). Lo lee el próximo tick.`);
    }
    if (command === "reject") {
      if (!extra) throw new Error('Falta el motivo: reject <company_key> "<motivo>".');
      if (dryRun) return console.log(`--dry-run: se rechazaría ${candidate.companyName} (${candidate.decision}).`);
      const result = await repo.rejectCandidate(key, extra);
      return console.log(`Rechazado: ${candidate.companyName}; ${result.disabledBoards} tableros apagados; alias ${result.aliasRetired ? "retirado" : "sin cambios"}.`);
    }
    throw new Error("Uso: list | approve <company_key> <ats:ref> | reject <company_key> \"<motivo>\"");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[direct-discovery-review] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
