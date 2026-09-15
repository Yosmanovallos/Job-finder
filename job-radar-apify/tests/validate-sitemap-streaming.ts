import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { getJobsLight, maskLockedFields } from "../src/db/job-repository.js";
import { buildJobsSitemapXml } from "../src/lib/job-seo.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.TEST_HTTP_PORT);
const baseUrl = `http://127.0.0.1:${port}`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });

function startServer(): ChildProcess {
  return spawn(process.execPath, ["--max-old-space-size=192", ...process.execArgv, path.join(root, "src/server.ts")], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    shell: false,
    detached: false,
    stdio: "inherit"
  });
}

async function waitForServer(server: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`El servidor terminó con código ${server.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Cold tsx startup may take several seconds.
    }
    await delay(250);
  }
  throw new Error("El servidor no inició dentro del presupuesto.");
}

async function healthMemory(): Promise<NodeJS.MemoryUsage> {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { memory: NodeJS.MemoryUsage };
  return body.memory;
}

function openPausedSitemap(): Promise<{ request: http.ClientRequest; response: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const request = http.get(`${baseUrl}/sitemap-jobs.xml`, (response) => {
      response.pause();
      resolve({ request, response });
    });
    request.once("error", reject);
  });
}

async function waitForCursorCleanup(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const active = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND state <> 'idle'
         AND query ILIKE '%sitemap_jobs_cursor%'`
    );
    if (Number(active.rows[0]?.count ?? 0) === 0) return;
    await delay(100);
  }
  assert.fail("El cursor siguió activo después de desconectar el cliente.");
}

const server = startServer();
try {
  await waitForServer(server);

  const legacyJobs = maskLockedFields(await getJobsLight(50_000), "free");
  const legacyXml = buildJobsSitemapXml(legacyJobs);
  const streamedSmall = await fetch(`${baseUrl}/sitemap-jobs.xml`);
  assert.equal(streamedSmall.status, 200);
  assert.equal(await streamedSmall.text(), legacyXml);
  console.log("✅ El stream conserva exactamente el XML y la elegibilidad del endpoint anterior.");

  await pool.query(
    `INSERT INTO jobs (id, url_hash, title, company, location, country, url, source, sources, published_at)
     SELECT md5('p1-large-' || i)::uuid, md5('p1-large-url-' || i),
            'Vacante P1 ' || i, 'Empresa P1 ' || (i % 100), 'Bogotá, Colombia', 'CO',
            'https://example.com/jobs/p1-large-' || i, 'Synthetic', '["Synthetic"]'::jsonb,
            NOW() - i * INTERVAL '1 second'
     FROM generate_series(1, 100000) AS i`
  );
  const before = await healthMemory();
  const coldResponse = await fetch(`${baseUrl}/sitemap-jobs.xml`);
  assert.equal(coldResponse.status, 200);
  const coldXml = await coldResponse.text();
  assert.equal((coldXml.match(/<url>/g) || []).length, 50_000);
  assert.ok(coldXml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(coldXml.endsWith("</urlset>\n"));
  const afterCold = await healthMemory();

  const hotResponse = await fetch(`${baseUrl}/sitemap-jobs.xml`);
  assert.equal(hotResponse.status, 200);
  const hotXml = await hotResponse.text();
  assert.equal(hotXml, coldXml);
  const afterHot = await healthMemory();
  const peakHeapGrowth = Math.max(afterCold.heapUsed, afterHot.heapUsed) - before.heapUsed;
  const peakRss = Math.max(afterCold.rss, afterHot.rss);
  const renderFreeMemoryBytes = 512 * 1024 * 1024;
  assert.ok(peakHeapGrowth < 64 * 1024 * 1024, `El heap creció ${(peakHeapGrowth / 1024 / 1024).toFixed(1)} MB.`);
  assert.ok(
    peakRss < renderFreeMemoryBytes * 0.7,
    `El RSS llegó a ${(peakRss / 1024 / 1024).toFixed(1)} MB y dejó menos de 30% de margen.`
  );
  console.log(
    `✅ Corpus de 100.000 filas: límite de 50.000, caché frío/caliente, ` +
      `heap +${(peakHeapGrowth / 1024 / 1024).toFixed(1)} MB y RSS ${(peakRss / 1024 / 1024).toFixed(1)} MB.`
  );

  const paused = await openPausedSitemap();
  const concurrent = await fetch(`${baseUrl}/sitemap-jobs.xml`);
  assert.equal(concurrent.status, 503);
  assert.equal(concurrent.headers.get("retry-after"), "30");
  const navigation = await fetch(`${baseUrl}/dashboard`);
  assert.equal(navigation.status, 200);
  paused.response.destroy();
  paused.request.destroy();
  await waitForCursorCleanup();
  console.log("✅ Cliente lento: backpressure, concurrencia acotada, navegación disponible y cancelación al desconectar.");

  await pool.query("ALTER TABLE jobs RENAME TO jobs_p1_unavailable");
  try {
    const unavailable = await fetch(`${baseUrl}/sitemap-jobs.xml`);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("cache-control"), "no-store");
    assert.match(await unavailable.text(), /temporalmente no disponible/i);
  } finally {
    await pool.query("ALTER TABLE jobs_p1_unavailable RENAME TO jobs");
  }
  console.log("✅ Un fallo de PostgreSQL devuelve una respuesta segura y reintentable.");
} finally {
  server.kill("SIGTERM");
  await pool.end();
}
