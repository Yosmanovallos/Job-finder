// adsense-readiness F4 cold-start check (docs/DASHBOARD-PERFORMANCE-RUNBOOK.md):
// fresh server processes, alternating base and branch, against the isolated
// runner's disposable PostgreSQL. Every request uses a unique ?coldcheck=
// URL. Measures the first `/` of each process (mobile layout, the PSI case),
// the desktop `/` right after, one hub and /dashboard.
//
// The base is a plain export of the commit to compare, built, at
// <os tmpdir>/job-radar-bench-base/job-radar-apify (node_modules may be a
// junction to this checkout's). `npx tsx scripts/run-isolated-tests.ts home-cold`.
import "./require-isolated-database.js";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { pool } from "../src/db/client.js";
import { queryMarketRows } from "../src/db/job-repository.js";
import { buildMarketSnapshot } from "../src/lib/market-report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const BRANCH_DIR = path.join(here, "..");
const BASE_DIR = path.join(os.tmpdir(), "job-radar-bench-base", "job-radar-apify");
const PORT = Number(process.env.TEST_HTTP_PORT);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROUNDS = 9;
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

if (!fs.existsSync(path.join(BASE_DIR, "public", "index.html"))) {
  throw new Error(`Falta la base construida en ${BASE_DIR}`);
}

function start(dir: string, env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, [...process.execArgv, path.join(dir, "src", "server.ts")], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT), ...env }
  });
}

async function waitReady(server: ChildProcess): Promise<number> {
  const started = performance.now();
  for (let i = 0; i < 400; i++) {
    if (server.exitCode !== null) throw new Error("server exited");
    try {
      if ((await fetch(`${BASE_URL}/api/health`)).ok) return performance.now() - started;
    } catch {
      // not yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server not ready");
}

async function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
    server.kill("SIGTERM");
  });
}

async function timed(pathname: string, ua = DESKTOP_UA): Promise<{ ms: number; status: number; bytes: number; body: string }> {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}coldcheck=${randomBytes(6).toString("hex")}`;
  const started = performance.now();
  const res = await fetch(url, { headers: { "User-Agent": ua } });
  const body = await res.text();
  return { ms: performance.now() - started, status: res.status, bytes: Buffer.byteLength(body), body };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

async function main(): Promise<void> {
  // The branch reads a real edition built from this database, so the
  // measurement includes the report figures on the home and the hub.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "market-bench-"));
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const rows = await queryMarketRows(client, "CO");
    await client.query("ROLLBACK");
    const snapshot = await buildMarketSnapshot(rows, { country: "CO", cutoff: new Date() });
    fs.writeFileSync(path.join(dir, `CO-${snapshot.period}.json`), JSON.stringify(snapshot));
  } finally {
    client.release();
  }

  const variants = [
    { name: "base", dir: BASE_DIR, env: {} as Record<string, string> },
    { name: "branch", dir: BRANCH_DIR, env: { MARKET_REPORTS_DIR: dir } }
  ];
  const results: Record<string, Record<string, number[]>> = { base: {}, branch: {} };
  const record = (variant: string, key: string, value: number) => {
    (results[variant]![key] ??= []).push(value);
  };
  const sizes: Record<string, number> = {};
  for (let round = 0; round < ROUNDS; round++) {
    const order = round % 2 === 0 ? variants : [...variants].reverse();
    for (const variant of order) {
      const server = start(variant.dir, variant.env);
      try {
        record(variant.name, "startup_ms", await waitReady(server));
        const homeMobile = await timed("/", MOBILE_UA);
        record(variant.name, "home_first_mobile_ms", homeMobile.ms);
        sizes[`${variant.name}_home_bytes`] = homeMobile.bytes;
        record(variant.name, "home_desktop_ms", (await timed("/", DESKTOP_UA)).ms);
        record(variant.name, "home_warm_mobile_ms", (await timed("/", MOBILE_UA)).ms);
        const hub = await timed("/empleos/bogota");
        record(variant.name, "hub_bogota_ms", hub.ms);
        sizes[`${variant.name}_hub_bytes`] = hub.bytes;
        record(variant.name, "dashboard_ms", (await timed("/dashboard")).ms);
        if (variant.name === "branch") {
          const report = await timed(`/informes/empleo-colombia-${JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]!), "utf-8")).period}`);
          if (report.status !== 200) throw new Error(`report ${report.status}`);
          record(variant.name, "report_ms", report.ms);
          if (!homeMobile.body.includes("Cifras del informe del mercado laboral")) throw new Error("home without report figures");
          if (!hub.body.includes("data-hub-comparison")) throw new Error("hub without comparison");
        }
      } finally {
        await stop(server);
      }
    }
  }
  const summary: Record<string, Record<string, { median: number; min: number; max: number }>> = {};
  for (const [variant, metrics] of Object.entries(results)) {
    summary[variant] = {};
    for (const [key, values] of Object.entries(metrics)) {
      summary[variant]![key] = { median: Math.round(median(values) * 10) / 10, min: Math.round(Math.min(...values)), max: Math.round(Math.max(...values)) };
    }
  }
  console.log(JSON.stringify({ rounds: ROUNDS, summary, sizes }, null, 2));
  fs.rmSync(dir, { recursive: true, force: true });
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
