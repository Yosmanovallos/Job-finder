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
import { createLogger } from "@job-radar/observability";
import { checkDbStatus } from "./commands/db-status.js";
import { runDiscover, selectSources } from "./commands/source-commands.js";
import { runValidation } from "./commands/validate-yaml-file.js";

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

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
