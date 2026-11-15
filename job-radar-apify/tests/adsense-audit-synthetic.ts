// Shared harness of the AdSense auditor on the synthetic build
// (openspec/changes/adsense-readiness, F0). Used by:
//   tests/run-adsense-audit.ts      → `npm run adsense:audit` (the audit itself)
//   tests/validate-adsense-audit.ts → `npm run test:adsense-audit` (baseline gate)
// Both run under scripts/run-isolated-tests.ts: Vite build with envDir
// false, disposable PostgreSQL, loopback-only network.
import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { buildJobPath } from "../src/lib/job-seo.js";
import type { Estado } from "../scripts/lib/adsense-audit-rules.js";
import { GENERIC_USER_AGENT } from "../scripts/lib/adsense-audit-crawl.js";
import { runAudit } from "../scripts/lib/adsense-audit-run.js";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const base = `http://127.0.0.1:${process.env.TEST_HTTP_PORT}`;
export const baselineFile = path.join(root, "docs/seo-evidence/adsense-audit-baseline.json");

const job = (jobId: string, title: string, location: string) => buildJobPath({ jobId, title, location });
/** Seeded by tests/fixtures/adsense-audit.sql. */
export const JOBS = {
  official: job("a0000000-0000-4000-8000-000000000001", "Analista de operaciones sintético oficial", "Medellín, Colombia"),
  thirdParty: job("a0000000-0000-4000-8000-000000000002", "Analista de operaciones sintético terceros uno", "Bogotá, Colombia"),
  sibling: job("a0000000-0000-4000-8000-000000000003", "Analista de operaciones sintético terceros dos", "Bogotá, Colombia"),
  expired: job("a0000000-0000-4000-8000-000000000004", "Analista de operaciones sintético vencida", "Bogotá, Colombia")
};

async function seed(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  try {
    await pool.query(await readFile(path.join(root, "tests/fixtures/adsense-audit.sql"), "utf8"));
  } finally {
    await pool.end();
  }
}

/** Seeds, starts the server, self-checks the seed, runs `body`, stops the server. */
export async function withSyntheticSite<T>(body: () => Promise<T>): Promise<T> {
  await seed();
  const server = spawn(process.execPath, [...process.execArgv, fileURLToPath(new URL("../src/server.ts", import.meta.url))], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: process.env.TEST_HTTP_PORT },
    stdio: ["ignore", "ignore", "inherit"]
  });
  const stop = () => server.kill("SIGTERM");
  process.once("exit", stop);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80 && !ready; attempt++) {
      if (server.exitCode !== null) throw new Error("[adsense-audit] el servidor terminó antes de iniciar");
      ready = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }).then((response) => response.ok, () => false);
      if (!ready) await delay(250);
    }
    assert.ok(ready, "[adsense-audit] el servidor no inició");

    // Seed self-check: a bad seed must not be recorded as a site failure.
    const official = await fetch(`${base}${JOBS.official}`).then(async (response) => ({ status: response.status, html: await response.text() }));
    assert.equal(official.status, 200, "semilla: la vacante oficial responde 200");
    assert.ok(official.html.includes('<meta name="bt-ads" content="on" />'), "semilla: la vacante oficial lleva el marcador");
    assert.ok(official.html.includes('"JobPosting"'), "semilla: la vacante oficial emite JobPosting");
    assert.equal((await fetch(`${base}${JOBS.expired}`)).status, 410, "semilla: la vacante vencida responde 410");
    // Warm the city-hub page cache the job pages peek for «Más empleos en <ciudad>».
    await fetch(`${base}/empleos/bogota`);
    await delay(1500);
    return await body();
  } finally {
    stop();
    process.off("exit", stop);
  }
}

/** The full synthetic audit: every sampled page over HTTP and in Chromium. */
export function auditSyntheticSite(expected?: Record<string, Estado>) {
  return runAudit({
    base,
    live: false,
    mode: "sintetico",
    maxUrls: 400,
    delayMs: 0,
    userAgent: GENERIC_USER_AGENT,
    browser: true,
    plan: { jobs: JOBS, hubSmall: "/empleos/santa-marta" },
    expected
  });
}
