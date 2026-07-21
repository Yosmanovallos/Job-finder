// Orchestrator: RemoteOK + Remotive + WWR → Notion "Vacantes".
// Dry-run by default; --execute writes. Idempotent via a file-backed state store
// and executeSync's query-by-Job-ID guard, so it never duplicates the human-
// curated pages already in Vacantes nor its own prior runs. No Postgres needed.
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadProfile } from "@job-radar/domain";
import {
  defaultScoringConfig,
  loadScoringConfig,
  rankResults,
  scoreJob
} from "@job-radar/matching";
import { createNotionApi } from "./api.js";
import { createFileDlq } from "./dlq.js";
import { createFileStateStore } from "./file-state-store.js";
import { executeSync, planSync, type SyncItem } from "./sync.js";
import { fetchAllBoards } from "./boards.js";

function readEnv(name: string, root: string): string {
  const text = readFileSync(resolve(root, ".env"), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === name) return (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} no está en .env`);
}

async function main(): Promise<void> {
  const root = process.env.INIT_CWD ?? process.cwd();
  const execute = process.argv.includes("--execute");
  const now = new Date().toISOString();

  const profilePath = join(root, "config/profile.local.yaml");
  const profile = loadProfile(
    existsSync(profilePath) ? profilePath : join(root, "config/profile.example.yaml")
  );
  const scoringPath = join(root, "config/scoring.local.yaml");
  const scoring = existsSync(scoringPath) ? loadScoringConfig(scoringPath) : defaultScoringConfig();

  const { jobs, perSource, errors } = await fetchAllBoards(now);

  // Score against the profile; keep the ranked, non-blocked view (like notion:sync).
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const results = jobs.map((job) => scoreJob(profile, job, scoring));
  const decisiones: Record<string, number> = {};
  const blockerTally: Record<string, number> = {};
  for (const r of results) {
    decisiones[r.decision] = (decisiones[r.decision] ?? 0) + 1;
    for (const b of r.hard_blockers) blockerTally[b] = (blockerTally[b] ?? 0) + 1;
  }
  // --include-rejected surfaces hard-blocked jobs for MANUAL triage instead of
  // dropping them. They still carry decision "reject", so buildNotionRow tags
  // them Prioridad "Descartada" with the blockers spelled out in `Blockers` —
  // the review marker. Deliberately NOT done by loosening the profile, which
  // would regress the Fase 4 matching eval. Off by default.
  const includeRejected = process.argv.includes("--include-rejected");
  const ranked = includeRejected
    ? [...results].sort((a, b) => b.score - a.score || b.confidence - a.confidence)
    : rankResults(results, "high_recall");
  const items: SyncItem[] = ranked.map((match) => ({ job: jobById.get(match.jobId)!, match }));

  const statePath = resolve(root, "var/notion/vacantes-boards-state.json");
  const store = createFileStateStore(statePath);
  const plan = await planSync(items, store);

  // Source-stated contract type (freelance/contract/part_time). Only Remotive
  // and WWR declare it; RemoteOK omits it, so most jobs have no type at all.
  const tiposEmpleo: Record<string, number> = {};
  for (const job of jobs) {
    for (const t of job.employmentTypes) tiposEmpleo[t] = (tiposEmpleo[t] ?? 0) + 1;
  }
  const freelanceLike = jobs.filter((j) =>
    j.employmentTypes.some((t) => t === "freelance" || t === "contract")
  );

  const summary = {
    fuentes: perSource,
    errores_fetch: errors,
    vacantes_qa_ai: jobs.length,
    tipos_de_empleo: tiposEmpleo,
    freelance_o_contract: freelanceLike.map((j) => ({
      fuente: j.sourceId,
      titulo: j.titleRaw.slice(0, 70),
      tipo: j.employmentTypes.join(",")
    })),
    decisiones,
    top_blockers: Object.fromEntries(
      Object.entries(blockerTally)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    ),
    incluye_rechazadas: includeRejected,
    tras_scoring_no_bloqueadas: items.length,
    plan: plan.counts,
    muestra: plan.operations
      .filter((op) => op.kind !== "noop")
      .slice(0, 10)
      .map((op) => ({ op: op.kind, titulo: op.title.slice(0, 70), jobId: op.jobId }))
  };

  if (!execute) {
    console.log(
      JSON.stringify(
        {
          modo: "dry-run",
          ...summary,
          nota: "Sin escrituras. Corre con --execute para escribir en Vacantes."
        },
        null,
        2
      )
    );
    return;
  }

  const token = readEnv("NOTION_TOKEN", root);
  const dataSourceId = readEnv("NOTION_DATA_SOURCE_ID", root);
  const api = createNotionApi(token);
  const dlq = createFileDlq(resolve(root, "var/notion/boards-dlq.jsonl"));
  const result = await executeSync(plan, { api, store, dlq, dataSourceId });

  console.log(
    JSON.stringify(
      { modo: "execute", ...summary, resultado: result, data_source_id: dataSourceId },
      null,
      2
    )
  );
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
