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
import { createLogger } from "@job-radar/observability";
import { checkDbStatus } from "./commands/db-status.js";
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

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
