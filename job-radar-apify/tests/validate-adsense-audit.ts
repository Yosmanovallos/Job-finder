// AdSense auditor on the synthetic build (openspec/changes/adsense-readiness,
// F0). Runs under scripts/run-isolated-tests.ts (`npm run adsense:audit`):
// Vite build with envDir false, disposable PostgreSQL, loopback-only network.
//
// 1. Seeds the job pages the matrix needs (tests/fixtures/adsense-audit.sql).
// 2. Runs the full audit (HTTP + Chromium parity) and writes the JSON report
//    to the run's temporary directory.
// 3. Gate: the states equal the committed baseline
//    (docs/seo-evidence/adsense-audit-baseline.json). The audit's own exit
//    code is reported, and is ≠ 0 while measurable rules fail — expected
//    until F2–F5 land.
// 4. Exercises the `--live` profile (sitemap discovery, URL budget, ≥ 1 s
//    pause, GET only, generic User-Agent) against this local server.
import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { buildJobPath } from "../src/lib/job-seo.js";
import { readExpected } from "../scripts/adsense-audit.js";
import { GENERIC_USER_AGENT, GetFetcher, collectFacts, FIXED_PAGES } from "../scripts/lib/adsense-audit-crawl.js";
import { RULES } from "../scripts/lib/adsense-audit-rules.js";
import { runAudit, writeReport } from "../scripts/lib/adsense-audit-run.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = `http://127.0.0.1:${process.env.TEST_HTTP_PORT}`;
const baselineFile = path.join(root, "docs/seo-evidence/adsense-audit-baseline.json");

const job = (jobId: string, title: string, location: string) => buildJobPath({ jobId, title, location });
const JOBS = {
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

async function main(): Promise<void> {
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

    const expected = await readExpected(baselineFile).catch(() => undefined);
    const { report, exitCode, text } = await runAudit({
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
    console.log(text);
    const file = await writeReport(report, process.cwd());
    console.log(`[adsense-audit] informe: ${file}`);

    assert.equal(report.reglas.length, 50, "ADS-001: 50 entradas");
    assert.deepEqual(report.reglas.map((rule) => rule.id), RULES.map((rule) => rule.id));
    assert.deepEqual(report.indicadores.metodos, ["GET"], "ADS-001: solo GET");
    const serialized = JSON.stringify(report);
    assert.ok(!/<\/[a-z]+>|<(div|p|script|a|article|section) /i.test(serialized), "el informe no contiene HTML");
    assert.ok(!serialized.includes("Vacante sintética del auditor"), "el informe no contiene texto de las páginas");
    if (expected) {
      assert.deepEqual(report.diferencias, [], `el auditor reproduce la línea base: ${JSON.stringify(report.diferencias)}`);
    } else {
      console.log("[adsense-audit] sin línea base comprometida: solo se informa");
    }
    console.log(`[adsense-audit] código del auditor sin --expect: ${report.resumen.mediblesQueNoCumplen.length === 0 ? 0 : 1} (${report.resumen.mediblesQueNoCumplen.length} medibles sin cumplir)`);
    void exitCode;

    // --live profile against this local server: budget, pause, GET only.
    // (The User-Agent header is asserted offline in validate-adsense-audit.test.ts.)
    const fetcher = new GetFetcher({ base, live: false, maxUrls: 8, delayMs: 1000, userAgent: GENERIC_USER_AGENT });
    const started = Date.now();
    const facts = await collectFacts(fetcher, { pages: FIXED_PAGES, linkChecks: 10, jobSampleSize: 4 }, "local");
    const elapsed = Date.now() - started;
    assert.ok(fetcher.count <= 8, `perfil --live: presupuesto de URLs respetado (${fetcher.count})`);
    assert.ok(elapsed >= (fetcher.count - 1) * 1000 - 50, `perfil --live: pausa ≥ 1 s (${elapsed} ms para ${fetcher.count})`);
    assert.deepEqual([...fetcher.methods], ["GET"]);
    assert.ok(facts.requests === fetcher.count);
    console.log(`[adsense-audit] perfil --live contra el servidor local: ${fetcher.count} GET en ${elapsed} ms, UA «${GENERIC_USER_AGENT}»`);
    await writeFile(path.join(process.cwd(), "adsense-audit-live-profile.json"), JSON.stringify({ requests: fetcher.count, elapsedMs: elapsed, methods: [...fetcher.methods] }, null, 2));
  } finally {
    stop();
    process.off("exit", stop);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "[adsense-audit] falló");
  process.exitCode = 1;
});
