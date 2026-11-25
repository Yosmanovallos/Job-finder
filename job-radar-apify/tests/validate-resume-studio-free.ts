import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveJobs } from "../src/db/job-repository.js";
import { pool } from "../src/db/client.js";
import type { Job } from "../src/sources/types.js";

// T-FREE (doc 09 §5, ADR 0017 §5–6): the AI Resume Studio never changes the
// free job product. The real server is started twice against the same
// disposable database — RESUME_STUDIO_ENABLED unset, then "true" — and the
// job surfaces must answer byte-for-byte the same (status, content type,
// body). With the flag off, /hoja-de-vida and /api/resume/* are 404.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_HTTP_PORT);
const BASE = `http://127.0.0.1:${PORT}`;
const URL_PREFIX = "https://www.example.com/job/resume-free-";

function makeJob(id: string, title: string): Job {
  return {
    jobId: id,
    title,
    company: "ZzFree Corp",
    location: "Bogotá, Colombia",
    url: `${URL_PREFIX}${id}`,
    dateText: "Hace 1 día",
    source: "LinkedIn",
    publishedAt: new Date(Date.now() - 24 * 3600000).toISOString()
  };
}

async function startServer(flag: string | undefined): Promise<ChildProcess> {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(PORT) };
  delete env.RESUME_STUDIO_ENABLED;
  if (flag !== undefined) env.RESUME_STUDIO_ENABLED = flag;
  const server = spawn(process.execPath, [...process.execArgv, path.join(__dirname, "..", "src", "server.ts")], {
    cwd: process.cwd(),
    shell: false,
    stdio: "ignore",
    env
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`El servidor terminó con código ${server.exitCode}.`);
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return server;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("El servidor no respondió a tiempo.");
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  server.kill();
  await exited;
  // Wait until the port is free again.
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await fetch(`${BASE}/api/health`);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface Snapshot {
  status: number;
  contentType: string | null;
  bodySha: string;
  /** R4c: header links «Hoja de vida» (flag on) that replaced «Preguntas». */
  navSwaps: number;
}
const bodies = new Map<string, string>();
// R4c: the ONE allowed difference with the flag on is the header's last link
// («Preguntas» → «Hoja de vida», src/sections/Header.tsx). It is counted, then
// masked back, so every other byte of the job surfaces must still be equal.
const NAV_ON = /href="\/hoja-de-vida" data-discover="true">Hoja de vida<\/a>/g;
const NAV_OFF = 'href="/preguntas" data-discover="true">Preguntas</a>';

async function snapshot(url: string, accept = "text/html"): Promise<Snapshot> {
  const res = await fetch(`${BASE}${url}`, { headers: { Accept: accept } });
  // Per-process values are masked before comparing: the home SSR seed's
  // render time ("now") and the public API's random requestId.
  const raw = await res.text();
  const navSwaps = raw.match(NAV_ON)?.length ?? 0;
  const body = raw
    .replace(NAV_ON, NAV_OFF)
    .replace(/"now":"\d{4}-\d{2}-\d{2}T[\d:.]+Z"/g, '"now":"<masked>"')
    .replace(/"requestId":"[0-9a-f-]{36}"/g, '"requestId":"<masked>"');
  bodies.set(`${bodies.size}:${url}`, body);
  return { status: res.status, contentType: res.headers.get("content-type"), bodySha: createHash("sha256").update(body).digest("hex"), navSwaps };
}

async function main() {
  console.log("\n🧪 SUITE: T-FREE — vacantes y dashboard iguales con la bandera apagada y encendida\n");
  await pool.query(`DELETE FROM jobs WHERE url LIKE $1`, [`${URL_PREFIX}%`]);
  await saveJobs([makeJob("a", "Analista ZzFree"), makeJob("b", "Auxiliar ZzFree")], "Test Resume Free");
  const jobId = (await pool.query<{ id: string }>(`SELECT id FROM jobs WHERE url = $1`, [`${URL_PREFIX}a`])).rows[0]?.id;
  assert.ok(jobId, "no se guardó la vacante de prueba");
  await pool.end();

  // Job surfaces: free product, must not move with the Resume Studio flag.
  const surfaces: [string, string?][] = [
    ["/dashboard"],
    ["/dashboard?coldcheck=resume-free"],
    ["/"],
    [`/empleos/${jobId}`],
    ["/empleos/bogota"],
    ["/api/jobs?limit=5", "application/json"],
    ["/api/v1/jobs?limit=3", "application/json"],
    ["/robots.txt", "text/plain"],
    ["/llms.txt", "text/plain"]
  ];
  const moduleUrls: [string, string?][] = [
    ["/hoja-de-vida"],
    ["/hoja-de-vida/editar"],
    ["/api/resume/consent", "application/json"],
    ["/api/resume/resumes", "application/json"],
    ["/hoja-de-vida/postulaciones"],
    ["/api/resume/applications", "application/json"]
  ];

  const results: Record<string, Record<string, Snapshot>> = {};
  for (const [label, flag] of [["off", undefined], ["on", "true"]] as const) {
    const server = await startServer(flag);
    try {
      results[label] = {};
      for (const [url, accept] of [...surfaces, ...moduleUrls]) results[label][url] = await snapshot(url, accept);
    } finally {
      await stopServer(server);
    }
  }

  for (const [url] of surfaces) {
    if (results.on[url].bodySha !== results.off[url].bodySha) {
      const [a, b] = [...bodies.entries()].filter(([k]) => k.endsWith(`:${url}`)).map(([, v]) => v);
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      console.error(`DIFF ${url} @${i}\nOFF: ${a.slice(Math.max(0, i - 150), i + 150)}\nON:  ${b.slice(Math.max(0, i - 150), i + 150)}`);
    }
    const { navSwaps: _on, ...on } = results.on[url];
    const { navSwaps: offSwaps, ...off } = results.off[url];
    assert.deepEqual(on, off, `T-FREE: ${url} cambió al encender la bandera`);
    assert.equal(offSwaps, 0, `T-FREE: ${url} muestra «Hoja de vida» con la bandera apagada`);
    assert.notEqual(results.off[url].status, 0);
  }
  // The server-rendered home shows «Hoja de vida» only with the flag on.
  assert.ok(results.on["/"].navSwaps >= 1, "T-FREE: con la bandera encendida la home debe enlazar «Hoja de vida»");
  console.log(surfaces.map(([url]) => `   ${results.off[url].status} ${url}`).join("\n"));
  for (const url of ["/dashboard", "/", `/empleos/${jobId}`, "/api/jobs?limit=5", "/api/v1/jobs?limit=3"]) {
    assert.equal(results.off[url].status, 200, `${url} debe responder 200 en la prueba`);
  }
  console.log(`✅ [PASSED] ${surfaces.length} superficies de vacantes idénticas (estado, tipo y cuerpo) con la bandera apagada y encendida.`);

  for (const [url] of moduleUrls) {
    assert.equal(results.off[url].status, 404, `con la bandera apagada ${url} debe ser 404`);
  }
  // A bare "1" or "TRUE" must not turn it on either (strict flag).
  const loose = await startServer("TRUE");
  try {
    assert.equal((await snapshot("/api/resume/consent", "application/json")).status, 404, "solo \"true\" enciende el módulo");
  } finally {
    await stopServer(loose);
  }
  console.log("✅ [PASSED] Bandera apagada (o no exactamente \"true\"): /hoja-de-vida y /api/resume/* = 404.");

  assert.equal(results.on["/api/resume/consent"].status, 401, "encendida, la API exige sesión");
  assert.equal(results.on["/api/resume/resumes"].status, 401);
  assert.equal(results.on["/api/resume/applications"].status, 401, "R4b: postulaciones también piden sesión");
  assert.notEqual(results.on["/hoja-de-vida/postulaciones"].status, 404, "R4b: el tablero existe con la bandera encendida");
  assert.notEqual(results.on["/hoja-de-vida"].status, 404, "encendida, la página existe");
  console.log("✅ [PASSED] Bandera encendida: la API pide sesión (401) y la página existe.");
  console.log("\nT-FREE: OK.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
