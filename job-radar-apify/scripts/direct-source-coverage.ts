/**
 * Read-only census of the companies a set of job boards brings (default:
 * Indeed + Glassdoor) against the official employer boards and the
 * discovery queue (docs/direct/bolsas-a-empleadores-2026-11.md). Run
 * through the Direct Employers Tick workflow with mode=browser-boards-coverage
 * for production evidence. Writes nothing: one READ ONLY snapshot per slice.
 *
 *   npx tsx scripts/direct-source-coverage.ts [--sources Indeed,Glassdoor] [--allow-remote-db]
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import { parseAgencyKeys } from "../src/direct/discovery/candidates.js";
import { FOCUS_PRESETS, parseFocusSources, summarizeSourceCensus } from "../src/direct/discovery/source-focus.js";

dotenv.config();

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const sources = parseFocusSources(argValue("--sources") ?? FOCUS_PRESETS["browser-boards"].join(","));
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const { loadSourceCoverage } = await import("../src/db/direct-discovery-repository.js");
  try {
    const agencies = parseAgencyKeys(JSON.parse(await readFile(new URL("../data/direct-discovery-agencies.json", import.meta.url), "utf8")));
    const co = await loadSourceCoverage(sources, "CO");
    const ve = await loadSourceCoverage(sources, "VE");
    const none = await loadSourceCoverage(sources, "none");
    const computrabajoKeys = new Set((await loadSourceCoverage(["Computrabajo"], "CO")).map((row) => row.companyKey));
    const census = summarizeSourceCensus({ sources, co, veCompanies: ve.length, noCountryCompanies: none.length, agencies, computrabajoKeys });
    const label = sources.join(" + ");

    console.log(`${label}: empresas distintas con vacantes vigentes — Colombia ${census.companies.CO}, Venezuela ${census.companies.VE}, sin país ${census.companies.none}.`);
    console.log(`  Venezuela y sin país se informan aparte: el descubrimiento solo verifica tableros con vacantes en Colombia (ADR 0006 §7.1/§13).`);
    console.log(`Colombia (${census.vacancies} vacantes de esas bolsas):`);
    console.log(`  Agencias conocidas: ${census.agencies}.`);
    console.log(`  Ya con tablero oficial habilitado: ${census.withBoard} (con ≥ 1 vacante oficial vigente: ${census.withLiveOfficialJobs}).`);
    console.log(`  Objetivo (sin tablero, no agencia): ${census.targets}; de ellas, también en Computrabajo: ${census.alsoOnComputrabajo}.`);
    console.log(`  Estado en la cola de descubrimiento: ${Object.entries(census.byDecision).sort((a, b) => b[1] - a[1]).map(([key, value]) => `${key} ${value}`).join(" · ") || "—"}.`);
    console.log(`  Abiertas y listas para sondeo: ${census.dueNow}; abiertas en espera (backoff): ${census.inBackoff}.`);
    console.log(`  Candidatas nuevas frente a la programación actual (listas y fuera de Computrabajo): ${census.newDueNotOnComputrabajo}.`);

    console.log(`\nEmpresas objetivo de ${label} en Colombia, por vacantes:`);
    for (const row of co.filter((entry) => !agencies.has(entry.companyKey) && entry.enabledBoards === 0).slice(0, 60)) {
      const flags = [computrabajoKeys.has(row.companyKey) ? "también Computrabajo" : null, row.probeDue === false ? "en backoff" : null].filter(Boolean).join(", ");
      console.log(`  ${String(row.directoryCount).padStart(4)}  ${row.companyName.slice(0, 45).padEnd(45)}  ${(row.decision ?? "sin fila").padEnd(15)} ${flags}`);
    }
    console.log(`\n${JSON.stringify({ kind: "summary", ...census })}`);
    console.log("Un tablero verificado no demuestra que cada vacante de estas bolsas tenga equivalente oficial; las cifras se muestran por separado.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[source-coverage] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
