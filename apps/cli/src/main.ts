#!/usr/bin/env node
import { Command } from "commander";
import { loadDotEnv, loadEnv } from "@job-radar/config";
import { createLogger } from "@job-radar/observability";
import { checkDbStatus } from "./commands/db-status.js";

const program = new Command();

program
  .name("job-radar")
  .description("Local job radar CLI (Phase 0 scaffold)")
  .version("0.1.0");

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

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
