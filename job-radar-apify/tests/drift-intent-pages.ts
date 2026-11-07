// Local SEO drift + cold TTFB for seo-intent-pages (SIP-050/051): the same
// disposable database served by the base checkout (path in .drift-base, e.g. an
// origin/main worktree with its own build) and by this branch, one after the
// other on the runner's port. Read-only. `npm run drift:intent-pages`.
import "./require-isolated-database.js";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { pool } from "../src/db/client.js";
import { buildJobPath } from "../src/lib/job-seo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_HTTP_PORT);
const BASE = `http://127.0.0.1:${PORT}`;
// The runner passes no custom variables (test-safety.ts), so the base
// checkout's path comes from an uncommitted local file, .drift-base.
import fs from "fs";
const BASE_DIR = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, "..", ".drift-base"), "utf8").trim();
  } catch {
    return "";
  }
})();
const BRANCH_DIR = path.join(__dirname, "..");
const RUNS = 3;

function start(dir: string): ChildProcess {
  return spawn(process.execPath, [...process.execArgv, path.join(dir, "src", "server.ts")], {
    cwd: process.cwd(),
    shell: false,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, PORT: String(PORT) }
  });
}

async function ready(server: ChildProcess): Promise<void> {
  for (let i = 0; i < 160; i++) {
    if (server.exitCode !== null) throw new Error(`server exited ${server.exitCode}`);
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server not ready");
}

function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    server.once("exit", () => resolve());
    server.kill("SIGTERM");
  });
}

const pick = (re: RegExp, html: string) => re.exec(html)?.[1] ?? null;
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);

function seo(status: number, html: string) {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return {
    status,
    title: pick(/<title>([\s\S]*?)<\/title>/, html),
    description: pick(/<meta name="description" content="([^"]*)"/, html),
    canonical: pick(/<link rel="canonical" href="([^"]+)"/, html),
    robots: pick(/<meta name="robots" content="([^"]+)"/, html) ?? "(default)",
    hreflang: [...html.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => `${m[1]}=${m[2]}`).join(" "),
    h1: pick(/<h1>([\s\S]*?)<\/h1>/, html),
    jsonLdTypes: ld.map((block) => JSON.parse(block)["@type"]).join(","),
    jsonLdHash: hash(ld.join("|")),
    h2: [...html.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => m[1]).join(" | ")
  };
}

async function capture(dir: string, urls: string[]) {
  const snapshots: Record<string, ReturnType<typeof seo>> = {};
  const cold: Record<string, number[]> = {};
  for (let run = 0; run < RUNS; run++) {
    const server = start(dir);
    try {
      await ready(server);
      for (const url of urls) {
        // First hit of a fresh process: cold app cache, unique query string.
        const t = performance.now();
        const res = await fetch(`${BASE}${url}${url.includes("?") ? "&" : "?"}coldcheck=${run}-${Date.now()}`);
        const html = await res.text();
        (cold[url] ??= []).push(Math.round(performance.now() - t));
        if (run === 0) snapshots[url] = seo(res.status, html);
      }
    } finally {
      await stop(server);
    }
  }
  const median = Object.fromEntries(Object.entries(cold).map(([url, times]) => [url, [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]]));
  return { snapshots, median };
}

async function main(): Promise<void> {
  if (!BASE_DIR) throw new Error(".drift-base (path of the base checkout) is required.");
  const job = await pool.query<{ id: string; title: string; location: string }>(
    `SELECT id, title, location FROM jobs WHERE is_active AND country = 'CO' AND location ILIKE 'Bogot%' ORDER BY id LIMIT 1`
  );
  const jobPath = buildJobPath({ jobId: job.rows[0].id, title: job.rows[0].title, location: job.rows[0].location });
  await pool.end();
  const urls = ["/", "/ve", "/dashboard", "/empleos/bogota", "/empleos/caracas", "/empleos/remoto", "/ve/empleos/remoto", "/ve/empleos/project-manager", "/empleos/sin-experiencia", "/empleos/bogota/sin-experiencia", jobPath];
  const base = await capture(BASE_DIR, urls);
  const branch = await capture(BRANCH_DIR, urls);
  const diffs: Record<string, Record<string, { base: unknown; branch: unknown }>> = {};
  for (const url of urls) {
    for (const key of Object.keys(base.snapshots[url]) as Array<keyof ReturnType<typeof seo>>) {
      if (base.snapshots[url][key] !== branch.snapshots[url][key]) {
        (diffs[url] ??= {})[key] = { base: base.snapshots[url][key], branch: branch.snapshots[url][key] };
      }
    }
  }
  console.log(JSON.stringify({ unchanged: urls.filter((url) => !diffs[url]), diffs, coldTtfbMedianMs: { base: base.median, branch: branch.median } }, null, 2));
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
