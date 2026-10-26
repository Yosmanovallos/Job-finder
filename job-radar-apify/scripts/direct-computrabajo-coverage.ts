/**
 * Read-only census of Colombian Computrabajo companies and the official
 * employer boards already linked to them. Run through the Direct Employers
 * Tick workflow with mode=computrabajo-coverage for production evidence.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import { parseAgencyKeys } from "../src/direct/discovery/candidates.js";
import { buildComputrabajoBacklog, parseOfficialReviews } from "../src/direct/discovery/computrabajo-backlog.js";

dotenv.config();

async function main(): Promise<void> {
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const { loadComputrabajoCoverage } = await import("../src/db/direct-discovery-repository.js");
  try {
    const agencies = parseAgencyKeys(JSON.parse(await readFile(new URL("../data/direct-discovery-agencies.json", import.meta.url), "utf8")));
    const reviews = parseOfficialReviews(JSON.parse(await readFile(new URL("../data/computrabajo-official-reviews.json", import.meta.url), "utf8")));
    const rows = await loadComputrabajoCoverage();
    const backlog = buildComputrabajoBacklog(rows, agencies, reviews);
    if (process.argv.includes("--all")) {
      for (const row of backlog) console.log(JSON.stringify(row));
      console.log(JSON.stringify({ kind: "summary", total: backlog.length, target: backlog.filter((row) => !row.isAgency).length, pending: backlog.filter((row) => !row.isAgency && row.status === "pending_review").length }));
      return;
    }
    const employers = rows.filter((row) => !agencies.has(row.companyKey));
    const sum = (selected: typeof rows) => selected.reduce((total, row) => total + row.directoryCount, 0);
    const covered = employers.filter((row) => row.enabledBoards > 0);
    const withJobs = covered.filter((row) => row.liveOfficialJobs > 0);
    const uncovered = employers.filter((row) => row.enabledBoards === 0);
    const withDomain = uncovered.filter((row) => row.websiteDomain);
    const review = uncovered.filter((row) => row.decision === "needs_review");
    const pct = (part: number, whole: number) => whole ? `${((part / whole) * 100).toFixed(1)} %` : "—";

    console.log(`Computrabajo Colombia: ${rows.length} empresas con nombre válido · ${sum(rows)} vacantes vigentes (fuente primaria o deduplicada).`);
    console.log(`  Agencias conocidas: ${rows.length - employers.length} empresas · ${sum(rows.filter((row) => agencies.has(row.companyKey)))} vacantes.`);
    console.log(`  Empresas objetivo: ${employers.length} · ${sum(employers)} vacantes.`);
    console.log(`  Con tablero oficial habilitado: ${covered.length}/${employers.length} (${pct(covered.length, employers.length)}) · ${sum(covered)} vacantes de Computrabajo.`);
    console.log(`  Con al menos una vacante oficial vigente: ${withJobs.length} empresas.`);
    console.log(`  Sin tablero oficial: ${uncovered.length} empresas · ${sum(uncovered)} vacantes de Computrabajo.`);
    console.log(`    Revisión manual documentada: ${backlog.filter((row) => !row.isAgency && row.enabledBoards === 0 && row.status !== "pending_review").length} empresas; pendientes de revisión manual: ${backlog.filter((row) => !row.isAgency && row.enabledBoards === 0 && row.status === "pending_review").length}.`);
    console.log(`    De ellas, con dominio ya verificado: ${withDomain.length} empresas · ${sum(withDomain)} vacantes.`);
    console.log(`    Con posible tablero para revisión: ${review.length} empresas · ${sum(review)} vacantes.`);
    console.log("\nPrimeras 30 empresas sin tablero, por vacantes de Computrabajo:");
    for (const row of uncovered.slice(0, 30)) {
      console.log(`  ${String(row.directoryCount).padStart(5)}  ${row.companyName.slice(0, 45).padEnd(45)}  ${row.decision ?? "sin sondeo"}  ${row.websiteDomain ?? "sin dominio"}`);
    }
    console.log("\nEmpresas de Computrabajo con dominio curado y sin tablero:");
    for (const row of withDomain) {
      console.log(`  ${String(row.directoryCount).padStart(5)}  ${row.companyName.slice(0, 45).padEnd(45)}  ${row.websiteDomain}  ${row.decision ?? "sin sondeo"}`);
    }
    console.log("\nEmpresas de Computrabajo con tablero oficial habilitado:");
    for (const row of covered) {
      console.log(`  ${String(row.directoryCount).padStart(5)}  ${row.companyName.slice(0, 45).padEnd(45)}  ${row.liveOfficialJobs} vacantes oficiales vigentes`);
    }
    console.log("Un tablero verificado no demuestra que cada vacante de Computrabajo tenga equivalente oficial; las cifras se muestran por separado.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[computrabajo-coverage] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
