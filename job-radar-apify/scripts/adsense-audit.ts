// AdSense readiness auditor (openspec/changes/adsense-readiness, F0).
//
//   npm run adsense:audit
//       Synthetic build + disposable PostgreSQL (scripts/run-isolated-tests.ts,
//       suite `adsense-audit`). Never touches production. Exits ≠ 0 while the
//       audited build does not reproduce the committed baseline matrix.
//
//   npm run adsense:audit -- --base-url http://127.0.0.1:3000 [--browser]
//       Against a server you started locally (loopback only).
//
//   npm run adsense:audit -- --live [--max-urls 40] [--delay-ms 1000] [--browser]
//       Against https://buscotrabajo.co: GET only, at most --max-urls requests
//       (default 40, hard cap 120), ≥ 1 s between requests, generic User-Agent.
//       REQUIRES the owner's explicit approval before each run.
//       --browser additionally loads the sampled pages in Chromium (their
//       same-origin assets too); Google requests are always aborted.
//
// Common flags: --attest <file.json> (owner decisions and MANUAL
// confirmations, see AuditAttestations), --expect <baseline.json> (exit 0
// only if the states equal that report's), --out <dir> (report directory;
// default: the OS temporary directory). Exit ≠ 0 when a measurable rule is
// not CUMPLE (or, with --expect, when the matrix differs).
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  GENERIC_USER_AGENT,
  LIVE_DEFAULT_MAX_URLS,
  LIVE_MIN_DELAY_MS,
  LIVE_ORIGIN
} from "./lib/adsense-audit-crawl.js";
import type { AuditAttestations, Estado } from "./lib/adsense-audit-rules.js";
import { runAudit, writeReport } from "./lib/adsense-audit-run.js";

export interface CliOptions {
  live: boolean;
  baseUrl: string | null;
  maxUrls: number;
  delayMs: number;
  browser: boolean;
  attest: string | null;
  expect: string | null;
  out: string | null;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    live: false,
    baseUrl: null,
    maxUrls: LIVE_DEFAULT_MAX_URLS,
    delayMs: LIVE_MIN_DELAY_MS,
    browser: false,
    attest: null,
    expect: null,
    out: null,
    dryRun: false
  };
  const value = (index: number, flag: string) => {
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`[adsense-audit] ${flag} necesita un valor`);
    return next;
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--live":
        options.live = true;
        break;
      case "--browser":
        options.browser = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--base-url":
        options.baseUrl = value(index++, arg);
        break;
      case "--max-urls":
        options.maxUrls = Number(value(index++, arg));
        break;
      case "--delay-ms":
        options.delayMs = Number(value(index++, arg));
        break;
      case "--attest":
        options.attest = value(index++, arg);
        break;
      case "--expect":
        options.expect = value(index++, arg);
        break;
      case "--out":
        options.out = value(index++, arg);
        break;
      default:
        throw new Error(`[adsense-audit] argumento desconocido: ${arg}`);
    }
  }
  if (options.live && options.baseUrl) throw new Error("[adsense-audit] usa --live o --base-url, no ambos");
  return options;
}

export async function readExpected(file: string): Promise<Record<string, Estado>> {
  const parsed = JSON.parse(await readFile(file, "utf8")) as { reglas?: { id: string; estado: Estado }[] };
  if (!Array.isArray(parsed.reglas)) throw new Error(`[adsense-audit] ${file} no es un informe del auditor`);
  return Object.fromEntries(parsed.reglas.map((rule) => [rule.id, rule.estado]));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.live && !options.baseUrl) {
    // Synthetic build + disposable database: the isolated runner owns that.
    const runner = fileURLToPath(new URL("./run-isolated-tests.ts", import.meta.url));
    const result = spawnSync(process.execPath, [...process.execArgv, runner, "adsense-audit", ...(options.dryRun ? ["--dry-run"] : [])], {
      stdio: "inherit"
    });
    process.exitCode = result.status ?? 1;
    return;
  }
  const base = options.live ? LIVE_ORIGIN : options.baseUrl!;
  if (options.dryRun) {
    console.log(JSON.stringify({ base, maxUrls: options.maxUrls, delayMs: options.delayMs, browser: options.browser, method: "GET", userAgent: GENERIC_USER_AGENT }, null, 2));
    return;
  }
  const attestations = options.attest ? (JSON.parse(await readFile(options.attest, "utf8")) as AuditAttestations) : undefined;
  const { report, exitCode, text } = await runAudit({
    base,
    live: options.live,
    mode: options.live ? "live" : "local",
    maxUrls: options.maxUrls,
    delayMs: options.delayMs,
    userAgent: GENERIC_USER_AGENT,
    browser: options.browser,
    attestations,
    expected: options.expect ? await readExpected(options.expect) : undefined
  });
  console.log(text);
  console.log(`\nInforme JSON: ${await writeReport(report, options.out ?? undefined)}`);
  process.exitCode = exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "[adsense-audit] falló");
    process.exitCode = 2;
  });
}
