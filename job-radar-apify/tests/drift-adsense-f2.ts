// Local drift for adsense-readiness F2: the same disposable database served by
// the base checkout (path in .drift-base, e.g. a 449c981 worktree with its own
// build) and by this branch, one after the other on the runner's port. Two
// official and two third-party job pages, their city hub and both job
// sitemaps. Expected: everything identical except «Más empleos» (CX-5 order).
// `npm run drift:adsense-f2`. Writes only its own f2drift- rows.
import "./require-isolated-database.js";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { pool } from "../src/db/client.js";
import { buildJobPath } from "../src/lib/job-seo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_HTTP_PORT);
const BASE = `http://127.0.0.1:${PORT}`;
const BASE_DIR = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, "..", ".drift-base"), "utf8").trim();
  } catch {
    return "";
  }
})();
const BRANCH_DIR = path.join(__dirname, "..");

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
const hash = (value: string | null) => (value === null ? null : createHash("sha256").update(value).digest("hex").slice(0, 12));
const RELATED = /<section data-related-jobs>[\s\S]*?<\/section>/;

function snapshot(status: number, raw: string) {
  const html = raw.replace(/\r\n/g, "\n");
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const app = pick(/<div id="app">([\s\S]*?)<\/div>\s*<script/, html) ?? "";
  const links = pick(/window\.__SSR_JOB_LINKS__=(\{[\s\S]*?\});<\/script>/, html);
  const parsedLinks = links ? (JSON.parse(links) as { related?: Array<{ path: string }> }) : null;
  return {
    status,
    title: pick(/<title>([\s\S]*?)<\/title>/, html),
    description: pick(/<meta name="description" content="([^"]*)"/, html),
    canonical: pick(/<link rel="canonical" href="([^"]+)"/, html),
    robots: pick(/<meta name="robots" content="([^"]+)"/, html) ?? "(default)",
    adsMarker: html.includes('<meta name="bt-ads" content="on" />'),
    h1: pick(/<h1>([\s\S]*?)<\/h1>/, html),
    jsonLdTypes: ld.map((block) => JSON.parse(block)["@type"]).join(","),
    jsonLdHash: hash(ld.join("|")),
    ssrJobHash: hash(pick(/window\.__SSR_JOB__=(\{[\s\S]*?\});<\/script>/, html)),
    ssrLinksWithoutRelatedHash: parsedLinks ? hash(JSON.stringify({ ...parsedLinks, related: undefined })) : null,
    appWithoutRelatedHash: hash(app.replace(RELATED, "")),
    relatedCount: parsedLinks?.related?.length ?? 0,
    relatedJobs: (parsedLinks?.related ?? []).map((link) => link.path.split("/")[2].slice(0, 8)).join(" ")
  };
}

async function capture(dir: string, urls: string[]) {
  const out: Record<string, ReturnType<typeof snapshot>> = {};
  const server = start(dir);
  try {
    await ready(server);
    // Cold pass warms the hub pages the job pages peek for related links.
    for (const url of urls) await (await fetch(`${BASE}${url}`)).text();
    await new Promise((r) => setTimeout(r, 1500));
    for (const url of urls) {
      const res = await fetch(`${BASE}${url}`);
      out[url] = snapshot(res.status, await res.text());
    }
  } finally {
    await stop(server);
  }
  return out;
}

// Synthetic Bogotá hub: clustered titles, official and third-party copies.
async function seedSynthetic(): Promise<void> {
  await pool.query(`DELETE FROM jobs WHERE url_hash LIKE 'f2drift-%'`);
  const rows: Array<[string, string, string]> = [
    ["Analista de Datos", "Portal oficial", "Bancolombia"],
    ["Auxiliar de Bodega", "Portal oficial", "Alpina"],
    ["Analista de Datos Senior", "LinkedIn", "Empresa F2 Uno"],
    ["Auxiliar de Bodega Nocturno", "Computrabajo", "Empresa F2 Dos"],
    ["Analista de Cartera", "Elempleo", "Empresa F2 Tres"],
    ["Auxiliar Contable", "Computrabajo", "Empresa F2 Uno"],
    ["Mesero", "Computrabajo", "Empresa F2 Cuatro"],
    ["Mesero de Eventos", "Magneto", "Empresa F2 Cinco"],
    ["Conductor de Camión", "Computrabajo", "Empresa F2 Seis"],
    ["Desarrollador Backend Node", "LinkedIn", "Empresa F2 Siete"],
    ["Desarrollador Frontend React", "LinkedIn", "Empresa F2 Siete"],
    ["Cajero", "Elempleo", "Empresa F2 Ocho"],
    ["Asesor Comercial", "Computrabajo", "Empresa F2 Nueve"],
    ["Asesor Comercial Externo", "Magneto", "Empresa F2 Nueve"],
    ["Enfermera Jefe", "Elempleo", "Empresa F2 Diez"],
    ["Operario de Producción", "Computrabajo", "Empresa F2 Once"]
  ];
  let n = 0;
  for (const [title, source, company] of rows) {
    n++;
    await pool.query(
      `INSERT INTO jobs (url_hash, title, company, location, country, url, source, sources, description, requirements, published_at, seo_ready, is_active)
       VALUES ('f2drift-' || $1::text, $2, $3, 'Bogotá, D.C.', 'CO', $4, $5::text, jsonb_build_array($5::text), $6, $7::jsonb,
               NOW() - INTERVAL '2 days' - ($1::int * INTERVAL '1 minute'), TRUE, TRUE)`,
      [
        String(n).padStart(2, "0"),
        title,
        company,
        `https://careers.example.invalid/f2drift/${n}`,
        source,
        `Buscamos ${title.toLowerCase()} para el equipo de Bogotá.\nTrabajarás con procesos documentados y metas mensuales claras.\nOfrecemos contrato y formación desde el primer día.`,
        JSON.stringify([`Experiencia relacionada con ${title.toLowerCase()}.`, "Disponibilidad de tiempo completo."])
      ]
    );
  }
}

async function main(): Promise<void> {
  if (!BASE_DIR) throw new Error(".drift-base (path of the base checkout) is required.");
  await seedSynthetic();
  const jobPath = async (where: string) => {
    const job = await pool.query<{ id: string; title: string; location: string }>(
      `SELECT id, title, location FROM jobs WHERE url_hash LIKE 'f2drift-%' AND ${where} ORDER BY url_hash LIMIT 1`
    );
    return buildJobPath({ jobId: job.rows[0].id, title: job.rows[0].title, location: job.rows[0].location });
  };
  const urls = [
    await jobPath(`source = 'Portal oficial' AND title = 'Analista de Datos'`),
    await jobPath(`source = 'Portal oficial' AND title = 'Auxiliar de Bodega'`),
    await jobPath(`source = 'LinkedIn' AND title = 'Analista de Datos Senior'`),
    await jobPath(`source = 'Computrabajo' AND title = 'Mesero'`),
    "/empleos/bogota",
    "/sitemap-jobs.xml",
    "/sitemap-jobs-recent.xml"
  ];
  try {
    const base = await capture(BASE_DIR, urls);
    const branch = await capture(BRANCH_DIR, urls);
    const diffs: Record<string, Record<string, { base: unknown; branch: unknown }>> = {};
    for (const url of urls) {
      for (const key of Object.keys(base[url]) as Array<keyof ReturnType<typeof snapshot>>) {
        if (base[url][key] !== branch[url][key]) (diffs[url] ??= {})[key] = { base: base[url][key], branch: branch[url][key] };
      }
    }
    console.log(JSON.stringify({ urls, unchanged: urls.filter((url) => !diffs[url]), diffs, branch }, null, 2));
  } finally {
    await pool.query(`DELETE FROM jobs WHERE url_hash LIKE 'f2drift-%'`);
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
