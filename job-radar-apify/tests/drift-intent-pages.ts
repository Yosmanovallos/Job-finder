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
    h2: [...html.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => m[1]).join(" | "),
    // seo-intent-wave2: the hubs' «Búsquedas populares» links and a job
    // page's related jobs (D6), read on the warm pass.
    intentLinks: [...(pick(/<nav data-intent-links[^>]*>([\s\S]*?)<\/nav>/, html) ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1]).join(" "),
    relatedJobs: [...(pick(/<section data-related-jobs>([\s\S]*?)<\/section>/, html) ?? "").matchAll(/<li>[\s\S]*?href="([^"]+)"/g)].map((m) => m[1]).join(" ")
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
        await res.text();
        (cold[url] ??= []).push(Math.round(performance.now() - t));
      }
      if (run === 0) {
        // Warm pass for the SEO snapshot: the sitemap loads every intent
        // total (hub links) and the first pass warmed the hub pages that
        // job pages peek for their related jobs.
        await (await fetch(`${BASE}/sitemap-categories.xml`)).text();
        await new Promise((r) => setTimeout(r, 1500));
        for (const url of urls) {
          const res = await fetch(`${BASE}${url}`);
          snapshots[url] = seo(res.status, await res.text());
        }
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
  await seedSynthetic();
  const jobPathOf = async (where: string) => {
    const job = await pool.query<{ id: string; title: string; location: string }>(
      `SELECT id, title, location FROM jobs WHERE is_active AND ${where} ORDER BY id LIMIT 1`
    );
    return buildJobPath({ jobId: job.rows[0].id, title: job.rows[0].title, location: job.rows[0].location });
  };
  const jobPath = await jobPathOf(`country = 'CO' AND location ILIKE 'Bogot%'`);
  const guayanaJobPath = await jobPathOf(`url_hash LIKE 'drift-%' AND location ILIKE 'Ciudad Guayana%'`);
  const urls = [
    "/", "/ve", "/dashboard", "/empleos/bogota", "/empleos/caracas", "/empleos/remoto", "/ve/empleos/remoto",
    "/ve/empleos/project-manager", "/empleos/sin-experiencia", "/empleos/bogota/sin-experiencia", jobPath,
    // seo-intent-wave2
    "/empleos/medellin", "/empleos/cali", "/empleos/ciudad-guayana", "/empleos/medellin/sin-experiencia",
    "/empleos/cali/sin-experiencia", "/empleos/fines-de-semana", "/empleos/medio-tiempo", "/empleos/temporada",
    "/ve/empleos/fines-de-semana", guayanaJobPath
  ];
  try {
    await runDrift(urls);
    // SIW-061: the first request of a fresh process, ONE URL per process,
    // base and branch alternated so machine drift hits both alike.
    await isolatedTtfb(["/dashboard", "/empleos/bogota", "/empleos/medellin", "/empleos/cali", "/empleos/caracas", "/empleos/ciudad-guayana", "/empleos/remoto", jobPath]);
  } finally {
    await pool.query(`DELETE FROM jobs WHERE url_hash LIKE 'drift-%'`);
    await pool.end();
  }
}

// Synthetic rows (prefix drift-) so the new pages, the hub links and the
// Ciudad Guayana / Puerto Ordaz hub have something to show on both servers.
async function seedSynthetic(): Promise<void> {
  await pool.query(`DELETE FROM jobs WHERE url_hash LIKE 'drift-%'`);
  const rows: Array<[string, string, string]> = [];
  for (let i = 0; i < 12; i++) rows.push([`Auxiliar sin experiencia drift ${i}`, "Medellín, Antioquia", "CO"]);
  for (let i = 0; i < 12; i++) rows.push([`Mesero fines de semana drift ${i}`, "Cali, Valle del Cauca", "CO"]);
  for (let i = 0; i < 11; i++) rows.push([`Cajero medio tiempo drift ${i}`, "Bogotá, D.C.", "CO"]);
  for (let i = 0; i < 11; i++) rows.push([`Impulsadora temporada navideña drift ${i}`, "Barranquilla, Atlántico", "CO"]);
  for (let i = 0; i < 4; i++) rows.push([`Asistente comercial drift ${i}`, "Puerto Ordaz, Bolívar", "VE"]);
  for (let i = 0; i < 4; i++) rows.push([`Vendedor drift ${i}`, "Ciudad Guayana, Bolívar", "VE"]);
  let n = 0;
  for (const [title, location, country] of rows) {
    n++;
    await pool.query(
      `INSERT INTO jobs (url_hash, title, company, location, country, url, source, sources, published_at, seo_ready, is_active)
       VALUES ('drift-' || $1, $2, $3, $4, $5, $6, 'Computrabajo', jsonb_build_array('Computrabajo'), NOW() - INTERVAL '1 day' - ($7::int * INTERVAL '1 minute'), TRUE, TRUE)`,
      [n, title, `Empresa drift ${n % 3}`, location, country, `https://example.com/drift/${n}`, n]
    );
  }
}

const TTFB_RUNS = 5;

async function firstHit(dir: string, url: string): Promise<number> {
  const server = start(dir);
  try {
    await ready(server);
    const t = performance.now();
    const res = await fetch(`${BASE}${url}${url.includes("?") ? "&" : "?"}ttfb=${Date.now()}`);
    await res.text();
    return Math.round(performance.now() - t);
  } finally {
    await stop(server);
  }
}

async function isolatedTtfb(urls: string[]): Promise<void> {
  const out: Record<string, { base: number; branch: number; deltaPct: number }> = {};
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  for (const url of urls) {
    const base: number[] = [];
    const branch: number[] = [];
    for (let run = 0; run < TTFB_RUNS; run++) {
      base.push(await firstHit(BASE_DIR, url));
      branch.push(await firstHit(BRANCH_DIR, url));
    }
    const b = median(base);
    const r = median(branch);
    out[url] = { base: b, branch: r, deltaPct: Math.round(((r - b) / Math.max(b, 1)) * 100) };
  }
  console.log(JSON.stringify({ isolatedColdTtfbMedianMs: out }, null, 2));
}

async function runDrift(urls: string[]): Promise<void> {
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
