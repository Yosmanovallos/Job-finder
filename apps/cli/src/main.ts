#!/usr/bin/env node
import { resolve } from "node:path";
import { Command } from "commander";
import { loadDotEnv, loadEnv } from "@job-radar/config";
import {
  DEFAULT_FACTS_PATH,
  DEFAULT_PROFILE_PATH,
  loadFacts,
  loadProfile
} from "@job-radar/domain";
import { buildAdapter, DEFAULT_SOURCES_PATH, loadSourcesConfig } from "@job-radar/sources";
import { createDb } from "@job-radar/db";
import { replayDedupe, rowToCanonical, runIngest, runVerify } from "@job-radar/ingestion";
import { rankResults, scoreJob } from "@job-radar/matching";
import {
  importLabels,
  latestReport,
  resolveProfile,
  resolveScoring,
  runMatchingEval
} from "./commands/match-commands.js";
import { createLogger } from "@job-radar/observability";
import { checkDbStatus } from "./commands/db-status.js";
import { runDiscover, selectSources } from "./commands/source-commands.js";
import { runValidation } from "./commands/validate-yaml-file.js";
import { llmCostEstimate, runLlmMockEval } from "./commands/llm-commands.js";
import { createNotionApi } from "@job-radar/notion";
import {
  notionSchemaCheck,
  requireNotionConfig,
  runNotionReconcile,
  runNotionSync
} from "./commands/notion-commands.js";

const program = new Command();

// pnpm scripts run with cwd inside apps/cli; INIT_CWD is where the user
// invoked pnpm, so relative --profile/--facts paths resolve as they typed them.
function resolveUserPath(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

program.name("job-radar").description("Local job radar CLI (Phase 0 scaffold)").version("0.1.0");

program
  .command("db:status")
  .description("Check connectivity to the configured PostgreSQL database")
  .action(async () => {
    loadDotEnv();
    const env = loadEnv();
    const logger = createLogger({ service: "cli", level: env.LOG_LEVEL });
    const result = await checkDbStatus(env.DATABASE_URL, logger);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  });

program
  .command("profile:validate")
  .description("Validate a search profile YAML file against the domain schema")
  .option("--profile <path>", "Path to the profile YAML file", DEFAULT_PROFILE_PATH)
  .action((options: { profile: string }) => {
    const report = runValidation(resolveUserPath(options.profile), loadProfile);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  });

program
  .command("facts:validate")
  .description("Validate the authorized CV facts vault (reports never echo file values)")
  .option("--facts <path>", "Path to the facts YAML file", DEFAULT_FACTS_PATH)
  .action((options: { facts: string }) => {
    const report = runValidation(resolveUserPath(options.facts), loadFacts);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  });

program
  .command("sources:list")
  .description("List configured job sources")
  .option("--sources <path>", "Path to the sources YAML file", DEFAULT_SOURCES_PATH)
  .action((options: { sources: string }) => {
    const file = loadSourcesConfig(resolveUserPath(options.sources));
    console.log(
      JSON.stringify(
        {
          ok: true,
          count: file.sources.length,
          sources: file.sources.map((source) => ({
            id: source.id,
            adapter: source.adapter,
            board_token: source.board_token,
            enabled: source.enabled,
            rate_limit_per_minute: source.rate_limit_per_minute
          }))
        },
        null,
        2
      )
    );
  });

program
  .command("source:health")
  .description("Run the healthcheck of the selected source(s)")
  .requiredOption(
    "--source <name>",
    'Adapter name ("greenhouse") or source id ("greenhouse:gitlab")'
  )
  .option("--sources <path>", "Path to the sources YAML file", DEFAULT_SOURCES_PATH)
  .action(async (options: { source: string; sources: string }) => {
    const file = loadSourcesConfig(resolveUserPath(options.sources));
    const selected = selectSources(file.sources, options.source);
    if (selected.length === 0) {
      console.log(
        JSON.stringify({ ok: false, error: `No enabled source matches "${options.source}"` })
      );
      process.exitCode = 1;
      return;
    }
    const results = [];
    for (const config of selected) {
      results.push(await buildAdapter(config).healthcheck());
    }
    const ok = results.every((result) => result.healthy);
    console.log(JSON.stringify({ ok, results }, null, 2));
    process.exitCode = ok ? 0 : 1;
  });

program
  .command("discover")
  .description(
    "Discover jobs from configured sources (always dry-run in Phase 2 — nothing is persisted)"
  )
  .requiredOption(
    "--source <name>",
    'Adapter name ("greenhouse") or source id ("greenhouse:gitlab")'
  )
  .option("--profile <id>", "Profile id (informational until matching phases)", "default")
  .option("--limit <n>", "Maximum jobs to fetch", "20")
  .option("--dry-run", "Do not persist results (the only mode in Phase 2)", false)
  .option("--sources <path>", "Path to the sources YAML file", DEFAULT_SOURCES_PATH)
  .action(async (options: { source: string; profile: string; limit: string; sources: string }) => {
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isInteger(limit) || limit <= 0) {
      console.log(JSON.stringify({ ok: false, error: "--limit must be a positive integer" }));
      process.exitCode = 1;
      return;
    }
    const report = await runDiscover({
      sourcesPath: resolveUserPath(options.sources),
      source: options.source,
      limit,
      profileId: options.profile
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  });

function openDb() {
  loadDotEnv(resolveUserPath(".env"));
  const env = loadEnv();
  return createDb(env.DATABASE_URL);
}

program
  .command("ingest")
  .description("Discover, fetch, extract and persist jobs with dedupe and versioning")
  .option("--source <name>", "Adapter name or source id (default: all enabled)")
  .option("--limit <n>", "Maximum jobs per source (marks the run as partial)")
  .option("--dry-run", "Walk the pipeline without writing anything", false)
  .option("--sources <path>", "Path to the sources YAML file", DEFAULT_SOURCES_PATH)
  .action(
    async (options: { source?: string; limit?: string; dryRun: boolean; sources: string }) => {
      const file = loadSourcesConfig(resolveUserPath(options.sources));
      const limit = options.limit === undefined ? undefined : Number.parseInt(options.limit, 10);
      const handle = options.dryRun ? null : openDb();
      try {
        const report = await runIngest(handle?.db ?? null, {
          configs: file.sources,
          ...(options.source === undefined ? {} : { selector: options.source }),
          ...(limit === undefined ? {} : { limit }),
          dryRun: options.dryRun
        });
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = report.runs.every((run) => run.status !== "failed") ? 0 : 1;
      } finally {
        await handle?.close();
      }
    }
  );

program
  .command("dedupe")
  .description("Re-apply extraction + dedupe over the raw documents of a stored run")
  .option("--run <id>", "Run id or 'latest'", "latest")
  .option("--sources <path>", "Path to the sources YAML file", DEFAULT_SOURCES_PATH)
  .action(async (options: { run: string; sources: string }) => {
    const file = loadSourcesConfig(resolveUserPath(options.sources));
    const handle = openDb();
    try {
      const report = await replayDedupe(handle.db, {
        configs: file.sources,
        ...(options.run === "latest" ? {} : { runId: options.run })
      });
      if (!report) {
        console.log(JSON.stringify({ ok: false, error: "No stored runs found" }));
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify({ ok: true, ...report }, null, 2));
    } finally {
      await handle.close();
    }
  });

program
  .command("verify")
  .description("Verify freshness of stored jobs (never closes on a single failure)")
  .option("--due", "Only jobs due for verification (default behavior)", true)
  .option("--hours <n>", "Consider jobs due after this many hours", "24")
  .option("--limit <n>", "Maximum jobs to verify", "50")
  .option("--sources <path>", "Path to the sources YAML file", DEFAULT_SOURCES_PATH)
  .action(async (options: { hours: string; limit: string; sources: string }) => {
    const file = loadSourcesConfig(resolveUserPath(options.sources));
    const handle = openDb();
    try {
      const report = await runVerify(handle.db, {
        configs: file.sources,
        dueHours: Number.parseInt(options.hours, 10),
        limit: Number.parseInt(options.limit, 10)
      });
      console.log(JSON.stringify({ ok: true, ...report }, null, 2));
    } finally {
      await handle.close();
    }
  });

program
  .command("match")
  .description("Score and rank stored jobs against the profile (no LLM)")
  .option("--profile <id>", "Profile id (default resolves profile.local/example)", "default")
  .option("--view <mode>", "high_precision | high_recall", "high_recall")
  .option("--top <n>", "How many results to print", "15")
  .action(async (options: { profile: string; view: string; top: string }) => {
    const root = process.env.INIT_CWD ?? process.cwd();
    const profile = resolveProfile(root, options.profile);
    const scoring = resolveScoring(root);
    const view = options.view === "high_precision" ? "high_precision" : "high_recall";
    const handle = openDb();
    try {
      const rows = await handle.db.query.jobs.findMany();
      const meta = new Map(
        rows.map((row) => [
          row.id,
          { title: row.titleRaw, company: row.companyNameRaw, url: row.canonicalUrl }
        ])
      );
      const results = rows.map((row) => scoreJob(profile, rowToCanonical(row), scoring));
      const ranked = rankResults(results, view).slice(0, Number.parseInt(options.top, 10));
      console.log(
        JSON.stringify(
          {
            ok: true,
            profile: options.profile,
            scoring_version: scoring.scoring_version,
            view,
            total_jobs: rows.length,
            shown: ranked.length,
            results: ranked.map((result) => ({
              title: meta.get(result.jobId)?.title ?? "",
              company: meta.get(result.jobId)?.company ?? "",
              url: meta.get(result.jobId)?.url ?? "",
              score: result.score,
              confidence: result.confidence,
              decision: result.decision,
              why_apply: result.why_apply,
              why_not_apply: result.why_not_apply,
              uncertain: result.uncertain_requirements
            }))
          },
          null,
          2
        )
      );
    } finally {
      await handle.close();
    }
  });

program
  .command("eval:matching")
  .description("Run the offline matching baseline eval on the synthetic dataset")
  .action(() => {
    const root = process.env.INIT_CWD ?? process.cwd();
    const { summary, jsonPath, markdownPath } = runMatchingEval(root);
    console.log(JSON.stringify({ ok: true, summary, jsonPath, markdownPath }, null, 2));
  });

program
  .command("report:latest")
  .description("Print the latest eval report")
  .action(() => {
    const root = process.env.INIT_CWD ?? process.cwd();
    const report = latestReport(root);
    if (report === null) {
      console.log(
        JSON.stringify({ ok: false, error: "No reports found. Run eval:matching first." })
      );
      process.exitCode = 1;
      return;
    }
    console.log(report);
  });

program
  .command("labels:import")
  .description("Import human labels from a CSV (job_id,label[,reason])")
  .requiredOption("--file <path>", "CSV file to import")
  .action((options: { file: string }) => {
    const root = process.env.INIT_CWD ?? process.cwd();
    const result = importLabels(root, resolveUserPath(options.file));
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  });

program
  .command("llm:cost-estimate")
  .description("Estimate the cloud cost of one daily run under the configured budgets")
  .action(() => {
    const root = process.env.INIT_CWD ?? process.cwd();
    console.log(JSON.stringify({ ok: true, ...llmCostEstimate(root) }, null, 2));
  });

program
  .command("eval:llm")
  .description(
    "Offline LLM-pipeline eval with a deterministic mock (does NOT satisfy activation gates)"
  )
  .action(async () => {
    const root = process.env.INIT_CWD ?? process.cwd();
    const result = await runLlmMockEval(root);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  });

program
  .command("notion:schema:check")
  .description("Validate the Notion Vacantes data source against the expected schema")
  .action(async () => {
    loadDotEnv(resolveUserPath(".env"));
    const env = loadEnv();
    const { token, dataSourceId } = requireNotionConfig(env);
    const api = createNotionApi(token);
    const { ok, report } = await notionSchemaCheck(api, dataSourceId);
    console.log(JSON.stringify({ ...report, ok }, null, 2));
    process.exitCode = ok ? 0 : 1;
  });

program
  .command("notion:sync")
  .description("Project ranked jobs into Notion (dry-run by default; --execute writes)")
  .option("--execute", "Apply the plan against Notion (default: dry-run preview)", false)
  .option("--dry-run", "Explicit dry-run (default behaviour)", false)
  .option("--top <n>", "How many ranked jobs to project", "50")
  .option("--profile <id>", "Profile id", "default")
  .action(async (options: { execute: boolean; dryRun: boolean; top: string; profile: string }) => {
    const root = process.env.INIT_CWD ?? process.cwd();
    loadDotEnv(resolveUserPath(".env"));
    const env = loadEnv();
    const handle = openDb();
    try {
      const result = await runNotionSync({
        db: handle.db,
        profile: resolveProfile(root, options.profile),
        scoring: resolveScoring(root),
        root,
        env,
        top: Number.parseInt(options.top, 10),
        execute: options.execute && !options.dryRun
      });
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok === true ? 0 : 1;
    } finally {
      await handle.close();
    }
  });

program
  .command("notion:reconcile")
  .description("Re-align local sync state with Notion pages (never deletes anything)")
  .option("--execute", "Persist adoptions/error marks (default: dry-run report)", false)
  .action(async (options: { execute: boolean }) => {
    loadDotEnv(resolveUserPath(".env"));
    const env = loadEnv();
    const handle = openDb();
    try {
      const result = await runNotionReconcile({ db: handle.db, env, execute: options.execute });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await handle.close();
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
