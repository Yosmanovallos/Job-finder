/**
 * Employer discovery, phase D3 (docs/adr/0006-direct-employers.md §7.1):
 * directory candidates -> ATS board by name (Greenhouse / SmartRecruiters
 * verify; Lever / Ashby only to review) and by the employer's own site
 * (curated domains only) -> verified boards become employer_sources, read by
 * the normal tick. Insert-only; conflicts go to needs_review. Never writes
 * `jobs`. Never imported by the web server.
 *
 *   npx tsx scripts/discover-direct-employers.ts --dry-run [--candidates-file f.json] [--limit N]
 *       Probes and prints decisions. Writes nothing (reads the directory
 *       from the database only when no file is given).
 *   npx tsx scripts/discover-direct-employers.ts [--limit N] [--min-count N] [--max-enables N]
 *       Local database only unless --allow-remote-db (src/direct/db-guard.ts).
 *
 * Budgets (AGENTS.md rule 12): --limit candidates per run (default 100,
 * max 1000), 3 candidates at a time, at most ~10 ATS requests and 5 site
 * requests per candidate, --max-enables boards switched on per run
 * (default 20), and a --deadline-min wall clock (default 15) after which no
 * new candidate starts.
 */
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import { boundedGet } from "../src/direct/http.js";
import { curatedDomains, parseAgencyKeys, parseDirectorySnapshot, toCandidates, type DirectoryEntry } from "../src/direct/discovery/candidates.js";
import { boundedSiteGet } from "../src/direct/discovery/html-http.js";
import { probeCandidate, verifiedBoards, type DiscoveryCandidate, type ProbeOutcome } from "../src/direct/discovery/probe.js";
import { probeSite } from "../src/direct/discovery/site-probe.js";

dotenv.config();

const CONCURRENCY = 3;
const DIRECTORY_LIMIT = 20_000;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function intArg(name: string, fallback: number, max: number): number {
  const value = Number(argValue(name) ?? fallback);
  return Math.min(Math.max(Number.isFinite(value) ? Math.floor(value) : fallback, 0), max);
}

function line(candidate: DiscoveryCandidate, outcome: ProbeOutcome): string {
  const boards = outcome.evidence
    .filter((entry) => ["verified", "needs_review", "unsupported", "magneto"].includes(entry.outcome))
    .map((entry) => `${entry.atsType}:${entry.atsRef}${entry.colombiaLive !== undefined ? ` (${entry.colombiaLive} CO)` : ""} [${entry.outcome}/${entry.method}]`)
    .join(", ");
  return (
    `  ${candidate.companyName.slice(0, 32).padEnd(33)}${String(candidate.directoryCount).padStart(5)}  ` +
    `${outcome.decision.padEnd(15)} nombre=${outcome.nameProbe.padEnd(7)} sitio=${outcome.siteProbe.padEnd(16)} ${boards}` +
    (outcome.site?.offsiteCareersHosts.length ? ` · empleo en otro host: ${outcome.site.offsiteCareersHosts.join(", ")}` : "")
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limit = intArg("--limit", 100, 1_000);
  // Every company with a visible job belongs to the Colombia coverage census.
  const minCount = intArg("--min-count", 1, 1_000_000);
  const maxEnables = intArg("--max-enables", 20, 200);
  const deadlineAt = Date.now() + intArg("--deadline-min", 15, 60) * 60_000;
  const candidatesFile = argValue("--candidates-file");

  const agencyKeys = parseAgencyKeys(JSON.parse(await readFile(new URL("../data/direct-discovery-agencies.json", import.meta.url), "utf8")));
  const domains = curatedDomains();
  const fileEntries: DirectoryEntry[] | null = candidatesFile ? parseDirectorySnapshot(JSON.parse(await readFile(candidatesFile, "utf8"))) : null;

  const needsDb = !dryRun || !fileEntries;
  if (needsDb) assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const repo = needsDb ? await import("../src/db/direct-discovery-repository.js") : null;
  const { pool } = needsDb ? await import("../src/db/client.js") : { pool: null };

  const deps = {
    http: boundedGet,
    probeSite: (domain: string) =>
      probeSite(domain, { get: boundedSiteGet, sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) })
  };

  try {
    const entries = fileEntries ?? (await repo!.loadDirectoryCandidates(DIRECTORY_LIMIT));
    const all = toCandidates(entries, agencyKeys, domains);
    console.log(
      `[discover] Directorio: ${all.length} empresas (${all.filter((candidate) => candidate.websiteDomain).length} con dominio curado, ` +
        `${all.filter((candidate) => candidate.isAgency).length} agencias).`
    );

    let queue: (DiscoveryCandidate & { attempts: number })[];
    if (dryRun) {
      queue = all
        .filter((candidate) => candidate.directoryCount >= minCount)
        .sort((a, b) => b.directoryCount - a.directoryCount)
        .slice(0, limit)
        .map((candidate) => ({ ...candidate, attempts: 0 }));
    } else {
      const sync = await repo!.syncCandidates(all);
      console.log(`[discover] Sincronizados: ${sync.inserted} nuevos, ${sync.refreshed} actualizados, ${sync.known} ya cubiertos por una empresa.`);
      if (!fileEntries && entries.length > 0 && entries.length < DIRECTORY_LIMIT) {
        const retired = await repo!.retireMissingCandidates(all.map((candidate) => candidate.companyKey));
        console.log(`[discover] Fuera del directorio activo: ${retired} candidatos conservados con contador 0.`);
      } else {
        console.log("[discover] No se retiran candidatos: snapshot vacío, parcial o al límite.");
      }
      const due = await repo!.pickDueCandidates(limit, minCount);
      queue = due.map((row) => ({ ...row, isAgency: agencyKeys.has(row.companyKey) }));
    }
    console.log(`[discover] A revisar en esta corrida: ${queue.length} (mínimo ${minCount} vacantes en bolsas).${dryRun ? " --dry-run: no se escribe nada." : ""}\n`);

    const tally: Record<string, number> = {};
    let enabled = 0;
    let deferred = 0;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (next < queue.length && Date.now() < deadlineAt && enabled < maxEnables) {
          const candidate = queue[next++];
          let outcome: ProbeOutcome;
          try {
            outcome = await probeCandidate(candidate, deps);
          } catch (error) {
            console.log(`  ${candidate.companyName.slice(0, 32).padEnd(33)} error: ${(error as Error).message?.slice(0, 120)}`);
            tally.error = (tally.error ?? 0) + 1;
            continue;
          }
          let decision: string = outcome.decision;
          if (!dryRun) {
            if (outcome.decision === "verified") {
              if (enabled >= maxEnables) {
                // Over the cap: left as is, the next run picks it first.
                deferred++;
                decision = "deferred";
              } else {
                const boards = verifiedBoards(outcome.evidence);
                enabled += boards.length;
                const promotion = await repo!.promoteCandidate(candidate, boards, "auto", outcome);
                if (promotion.kind === "conflict") {
                  enabled -= boards.length;
                  await repo!.recordProbe(candidate, { ...outcome, decision: "needs_review", reason: promotion.reason }, candidate.attempts);
                  decision = `needs_review (${promotion.reason})`;
                }
              }
            } else {
              await repo!.recordProbe(candidate, outcome, candidate.attempts);
            }
          }
          tally[outcome.decision] = (tally[outcome.decision] ?? 0) + 1;
          console.log(line(candidate, { ...outcome, decision: decision as ProbeOutcome["decision"] }));
        }
      })
    );

    const stoppedBy = next < queue.length ? (enabled >= maxEnables ? "tope de habilitaciones" : "deadline") : null;
    console.log(
      `\n[discover] ${next} revisadas${stoppedBy ? ` (se detuvo por ${stoppedBy}; ${queue.length - next} quedan para la próxima)` : ""}: ` +
        Object.entries(tally).map(([key, value]) => `${key} ${value}`).join(" · ") +
        (dryRun ? "" : ` · tableros habilitados ${enabled}${deferred ? ` · diferidas ${deferred}` : ""}`)
    );
    if (!dryRun) {
      console.log(`[discover] ${repo!.formatTickCapacity(await repo!.tickCapacity())}`);
    }
  } finally {
    await pool?.end();
  }
}

main().catch((error) => {
  console.error("[discover] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
