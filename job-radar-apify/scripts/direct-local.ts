/**
 * Local sandbox for official employer vacancies (docs/adr/0006-direct-employers.md).
 * A persistent Postgres 16 in Docker on 127.0.0.1 only — never the `.env`
 * database (that one is production). Every child script gets this URL
 * explicitly, and each of them refuses a non-loopback URL on its own too.
 *
 *   npm run direct:local -- up       start (or create) the local database
 *   npm run direct:local -- run      up + migrate + seed + tick + report
 *   npm run direct:local -- tick     tick again (all boards, ignoring the interval)
 *   npm run direct:local -- report   official vs job-board counts per employer
 *   npm run direct:local -- discover [args]  discovery (D3) against the local DB
 *   npm run direct:local -- coverage discovery coverage funnel
 *   npm run direct:local -- review [args]    list / approve / reject candidates
 *   npm run direct:local -- down     stop the container (data kept)
 *   npm run direct:local -- reset    delete the container AND its data
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const root = fileURLToPath(new URL("../", import.meta.url));
// Same pinned image as the isolated test runner (scripts/run-isolated-tests.ts).
const IMAGE = "postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685";
const CONTAINER = "buscotrabajo-direct-local";
const VOLUME = "buscotrabajo-direct-local-data";
const PORT = 55433;
// Loopback-only throwaway credentials: the port is published on 127.0.0.1.
const LOCAL_URL = `postgresql://direct_local:direct_local@127.0.0.1:${PORT}/buscotrabajo_local`;

function docker(args: string[], allowFailure = false): string {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw new Error(`docker ${args[0]} falló: ${(error as { stderr?: string }).stderr?.trim() || (error as Error).message}`);
  }
}

async function up(): Promise<void> {
  const state = docker(["inspect", "--format", "{{.State.Running}}", CONTAINER], true);
  if (state === "") {
    docker([
      "run", "--detach", "--name", CONTAINER,
      "--label", "buscotrabajo=direct-local",
      "--memory", "512m",
      "--publish", `127.0.0.1:${PORT}:5432`,
      "--volume", `${VOLUME}:/var/lib/postgresql/data`,
      "--env", "POSTGRES_USER=direct_local",
      "--env", "POSTGRES_PASSWORD=direct_local",
      "--env", "POSTGRES_DB=buscotrabajo_local",
      IMAGE
    ]);
  } else if (state !== "true") {
    docker(["start", CONTAINER]);
  }
  const pool = new Pool({ connectionString: LOCAL_URL, max: 1, connectionTimeoutMillis: 1_000 });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt++) {
      try {
        await pool.query("SELECT 1");
        ready = true;
      } catch {
        await delay(500);
      }
    }
    if (!ready) throw new Error("el Postgres local no respondió en 30 s");
    // The base schema the app reads (jobs + identity keys), with the
    // synthetic rows of the test fixture — no production data ever.
    const hasJobs = await pool.query(`SELECT to_regclass('public.jobs') IS NOT NULL AS present`);
    if (!hasJobs.rows[0].present) {
      await pool.query(await readFile(new URL("../tests/fixtures/production-baseline.sql", import.meta.url), "utf8"));
      const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
      for (const name of ["job-seo-v2", "company-identity"]) {
        const block = new RegExp(`-- BEGIN ${name}\\r?\\n([\\s\\S]*?)-- END ${name}`).exec(schema)?.[1];
        if (!block) throw new Error(`schema.sql no contiene el bloque ${name}`);
        await pool.query(block);
      }
    }
  } finally {
    await pool.end();
  }
  console.log(`[direct-local] BD local lista: ${LOCAL_URL}`);
}

function runScript(script: string, args: string[] = []): void {
  const result = spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}`, ...args], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: LOCAL_URL }
  });
  if (result.status !== 0) throw new Error(`${script} terminó con código ${result.status}`);
}

async function main() {
  const command = process.argv[2];
  switch (command) {
    case "up":
      return up();
    case "run":
      await up();
      runScript("migrate-direct-employers.ts");
      runScript("seed-direct-employers.ts");
      runScript("run-direct-tick.ts", ["--force", ...process.argv.slice(3)]);
      return runScript("direct-report.ts");
    case "tick":
      return runScript("run-direct-tick.ts", ["--force", ...process.argv.slice(3)]);
    case "report":
      return runScript("direct-report.ts");
    case "discover":
      runScript("migrate-direct-employers.ts");
      return runScript("discover-direct-employers.ts", process.argv.slice(3));
    case "coverage":
      return runScript("direct-coverage.ts");
    case "review":
      return runScript("direct-discovery-review.ts", process.argv.slice(3));
    case "down":
      docker(["stop", CONTAINER], true);
      return console.log("[direct-local] Contenedor detenido (datos conservados).");
    case "reset":
      docker(["rm", "--force", CONTAINER], true);
      docker(["volume", "rm", VOLUME], true);
      return console.log("[direct-local] Contenedor y datos locales eliminados.");
    default:
      throw new Error("Uso: npm run direct:local -- up|run|tick|report|discover|coverage|review|down|reset");
  }
}

main().catch((error) => {
  console.error("[direct-local] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
