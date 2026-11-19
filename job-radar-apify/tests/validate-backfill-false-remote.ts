import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/client.js";
import { saveJobs } from "../src/db/job-repository.js";
import { sqlJobModality } from "../src/lib/job-modality.js";
import type { Job } from "../src/sources/types.js";

// scripts/backfill-false-remote.ts on the isolated database: it clears the
// remote claims the sources never made, and nothing else.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "https://www.example.com/job/false-remote-";

const job = (key: string, extra: Partial<Job>): Job => ({
  jobId: `false-remote-${key}`,
  title: "Analista",
  company: "ZzFalseRemote",
  location: "Bogotá",
  url: `${PREFIX}${key}`,
  dateText: "",
  source: "LinkedIn",
  country: "CO",
  publishedAt: new Date(Date.now() - 60_000).toISOString(),
  ...extra
});

const seed: Job[] = [
  job("elempleo", { source: "Elempleo", title: "Enfermero autorizaciones", remoteType: "fully_remote", applicantCountries: ["CO"] }),
  job("linkedin-hybrid", { title: "Científico de datos - híbrido en Bogotá", remoteType: "fully_remote" }),
  job("linkedin-remote-title", { title: "Python Engineer - Remote Work", remoteType: "fully_remote" }),
  job("magneto", { source: "Magneto", title: "Conductor Liniero y Empalmador FTTH", location: "Remoto", country: null }),
  job("magneto-hybrid", { source: "Magneto", title: "Asistente de Sistemas TI (Híbrido)", location: "Remoto", country: null }),
  // Sources that state their own modality: untouched.
  job("weremoto", { source: "WeRemoto", title: "Soporte al cliente", location: "Remoto", country: null, remoteType: "fully_remote", applicantCountries: ["CO"] }),
  job("getonboard", { source: "GetOnBoard", title: "Backend Developer", location: "Remoto", country: null, remoteType: "fully_remote", applicantCountries: ["CO"] }),
  job("getonboard-hybrid", { source: "GetOnBoard", title: "Project Manager TI", location: "Colombia", remoteType: "hybrid" }),
  job("linkedin-plain", { title: "Contador" })
];

function runScript(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, path.join(root, "scripts", "backfill-false-remote.ts"), ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function state(): Promise<Record<string, { remote_type: string | null; location: string; country: string | null; modality: string }>> {
  const rows = await pool.query(
    `SELECT url, remote_type, location, country, ${sqlJobModality()} AS modality FROM jobs WHERE url LIKE $1`,
    [`${PREFIX}%`]
  );
  return Object.fromEntries(rows.rows.map((row) => [row.url.slice(PREFIX.length), row]));
}

async function run(): Promise<void> {
  await pool.query(`DELETE FROM jobs WHERE url LIKE $1`, [`${PREFIX}%`]);
  await saveJobs(seed, "False remote test");
  const before = await state();
  assert.equal(Object.keys(before).length, seed.length);
  assert.equal(before.elempleo.modality, "remoto", "the bug: an on-site Elempleo job labeled remote");
  assert.equal(before.magneto.modality, "remoto", "the bug: an on-site Magneto job labeled remote");

  const dry = await runScript([]);
  assert.equal(dry.code, 0, dry.output);
  assert.deepEqual(await state(), before, "dry-run writes nothing");

  const applied = await runScript(["--apply"]);
  assert.equal(applied.code, 0, applied.output);
  const after = await state();

  assert.equal(after.elempleo.remote_type, null);
  assert.equal(after.elempleo.modality, "unknown");
  assert.equal(after["linkedin-hybrid"].modality, "hibrido", "the title decides once the false claim is gone");
  assert.equal(after["linkedin-remote-title"].modality, "remoto", "a title that says remote still counts");
  assert.deepEqual(
    [after.magneto.location, after.magneto.country, after.magneto.modality],
    ["Colombia", "CO", "unknown"]
  );
  assert.equal(after["magneto-hybrid"].modality, "hibrido");
  for (const key of ["weremoto", "getonboard", "getonboard-hybrid", "linkedin-plain"]) {
    assert.deepEqual(after[key], before[key], `${key} is untouched`);
  }

  const again = await runScript(["--apply"]);
  assert.equal(again.code, 0, again.output);
  assert.deepEqual(await state(), after, "idempotent");

  await pool.query(`DELETE FROM jobs WHERE url LIKE $1`, [`${PREFIX}%`]);
  await pool.end();
  console.log("\n✅ El backfill corrige solo las vacantes marcadas remotas sin evidencia.\n");
}

run().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
