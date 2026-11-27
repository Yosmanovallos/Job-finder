/**
 * AI Resume Studio R4d — weekly coverage report of the vacancy-link reader.
 * READ-ONLY. Reads the aggregated rs_job_link_outcomes table (day, site host,
 * outcome, count — no user, no URL path, no vacancy text) and prints:
 *   - how many links were read without asking to paste (the coverage %);
 *   - how often people pasted the text after a link failed;
 *   - the sites that most often ended in «pega el texto», with the reason.
 * The top of that list is what to fix next (a new ATS reader, a format…).
 *
 *   npx tsx scripts/resume-studio-link-report.ts              (last 7 days, local DB)
 *   npx tsx scripts/resume-studio-link-report.ts --days 30
 *   npx tsx scripts/resume-studio-link-report.ts --json       (machine-readable)
 *
 * Like the other rs_* scripts it refuses a non-local DATABASE_URL unless
 * --allow-remote-db is passed on purpose (the table reaches Supabase only
 * with R5's approved migration).
 */
import dotenv from "dotenv";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import { coverageReport } from "../src/resume-studio/job-link/coverage.js";

dotenv.config();

const REASON: Record<string, string> = {
  paste_no_structured_data: "la página no trae datos que podamos leer",
  paste_anti_bot: "protección anti-bots",
  paste_login_wall: "pide iniciar sesión",
  paste_linkedin: "LinkedIn (no se descarga por sus términos)",
  paste_robots: "robots.txt lo prohíbe",
  paste_fetch_failed: "la página no respondió",
  paste_not_found: "la vacante ya no existe",
  error: "error interno al leer"
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const days = Number(arg("--days") ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error("--days debe ser un entero entre 1 y 366.");
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const { linkOutcomeRows } = await import("../src/db/resume-studio-job-repository.js");
  try {
    const report = coverageReport(await linkOutcomeRows(days));
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify({ days, ...report }, null, 2));
      return;
    }
    console.log(`Cobertura del lector de links — últimos ${days} días`);
    console.log(`  Links leídos: ${report.total}`);
    console.log(`  Leídos solos (sin pegar texto): ${report.resolved} (${report.resolvedPct}%)`);
    console.log(`  Veces que la persona pegó el texto: ${report.pasted}`);
    console.log("\nPor resultado:");
    for (const o of report.byOutcome) console.log(`  ${String(o.hits).padStart(6)}  ${o.outcome}`);
    console.log("\nSitios que más piden pegar el texto (arreglar primero):");
    if (!report.topFailing.length) console.log("  (ninguno)");
    for (const f of report.topFailing) {
      console.log(`  ${String(f.hits).padStart(6)}  ${f.host} — ${f.reasons.map((r) => REASON[r] ?? r).join("; ")}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[link-report] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
