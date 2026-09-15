import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { buildTestEnvironment, validateTestEnvironment } from "../tests/test-safety.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const postgresImage = "postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685";
const suites: Record<string, string[]> = {
  unit: ["validate-test-safety.test.ts", "validate-dashboard-filters.ts", "validate-role-matching.ts", "validate-run-telemetry.test.ts"],
  integration: ["validate-isolated-database.ts", "validate-job-pagination.ts", "validate-seo-job-pages.ts", "validate-companies-search.ts", "validate-sitemap-streaming.ts", "validate-run-observability.ts"],
  sitemap: ["validate-sitemap-streaming.ts"],
  observability: ["validate-run-observability.ts"],
  pagination: ["validate-job-pagination.ts"],
  seo: ["validate-seo-job-pages.ts"],
  companies: ["validate-companies-search.ts"],
  baseline: ["validate-public-baseline.ts"]
};
const selection = process.argv[2] || "unit";
if (!Object.hasOwn(suites, selection) || process.argv.slice(3).some((arg) => arg !== "--dry-run")) {
  throw new Error("[P0] Suite inválida. Usa unit, integration, sitemap, observability, pagination, seo, companies o baseline; --dry-run es opcional.");
}

function docker(args: string[], env: NodeJS.ProcessEnv): string {
  try {
    return execFileSync("docker", args, { env, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    throw new Error("[P0] Docker local falló. Verifica que esté iniciado y que la imagen de prueba esté disponible.");
  }
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error || !address || typeof address === "string") reject(error || new Error("No se pudo asignar el puerto."));
        else resolve(address.port);
      });
    });
  });
}

async function executeSuite(file: string, env: NodeJS.ProcessEnv, cwd: string): Promise<void> {
  const imports = ["--import", import.meta.resolve("tsx"), "--import", new URL("../tests/require-test-environment.ts", import.meta.url).href];
  const child = spawn(process.execPath, [
    ...imports, ...(file.endsWith(".test.ts") ? ["--test"] : []), path.join(root, "tests", file)
  ], { cwd, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  const chunks: string[] = [];
  let outputBytes = 0;
  const consume = (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > 4 * 1024 * 1024) { kill(); return; }
    process.stdout.write(chunk);
    chunks.push(chunk.toString());
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  const kill = () => {
    if (child.pid && child.exitCode === null) {
      if (process.platform === "win32") {
        try { execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 10000 }); } catch { child.kill(); }
      } else if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
    }
  };
  const timer = setTimeout(kill, 120000);
  const interrupt = () => kill();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`[P0] ${file} falló (exit ${code}).`)));
    });
  } finally {
    clearTimeout(timer);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await writeFile(path.join(cwd, `${file}.log`), chunks.join(""));
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ selection, suites: suites[selection], postgresImage: selection === "unit" ? null : postgresImage, externalSources: false }, null, 2));
    return;
  }
  const runId = randomBytes(16).toString("hex");
  const directory = await mkdtemp(path.join(tmpdir(), `job-radar-test-${runId}-`));
  const database = `job_radar_test_${runId}`;
  const password = randomBytes(24).toString("hex");
  const httpPort = await freePort();
  const env = buildTestEnvironment(process.env, {
    runId, directory, databaseUrl: `postgresql://job_radar_test:${password}@127.0.0.1:55432/${database}`,
    httpPort, mode: selection === "unit" ? "offline" : "integration"
  });
  let container: string | undefined;
  let pool: Pool | undefined;
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 10000 }).trim();
  const results: { suite: string; status: string; durationMs: number }[] = [];
  console.log(`[P0] Entorno temporal: ${directory}`);
  try {
    if (selection === "baseline") {
      const buildOptions = {
        root, envDir: false,
        build: { outDir: "public" },
        define: {
          "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env.VITE_SUPABASE_URL),
          "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(env.VITE_SUPABASE_ANON_KEY)
        }
      };
      execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval",
        `const { build } = await import(${JSON.stringify(import.meta.resolve("vite"))}); await build(${JSON.stringify(buildOptions)});`
      ], { cwd: root, env: { ...env, NODE_ENV: "production" }, stdio: "inherit", timeout: 120000 });
    }
    if (selection !== "unit") {
      const endpoint = docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], env);
      if (!endpoint.startsWith("npipe://") && !endpoint.startsWith("unix://")) {
        throw new Error("[P0] Solo se admite un motor Docker local; no se ejecutarán pruebas en un host remoto.");
      }
      container = docker([
        "run", "--detach", "--rm", "--name", `job-radar-test-${runId}`,
        "--label", `job-radar-test=${runId}`, "--memory", "256m", "--cpus", "1",
        "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data",
        "--env", "POSTGRES_USER=job_radar_test", "--env", `POSTGRES_DB=${database}`,
        "--env", "POSTGRES_PASSWORD", postgresImage
      ], { ...env, POSTGRES_PASSWORD: password });
      const port = docker(["port", container, "5432/tcp"], env).match(/^127\.0\.0\.1:(\d+)$/)?.[1];
      if (!port) throw new Error("[P0] Docker no publicó un puerto exclusivamente local.");
      env.TEST_DATABASE_PORT = port;
      env.DATABASE_URL = env.TEST_DATABASE_URL = `postgresql://job_radar_test:${password}@127.0.0.1:${port}/${database}`;
      validateTestEnvironment(env, directory);
      pool = new Pool({ connectionString: env.TEST_DATABASE_URL, max: 1, connectionTimeoutMillis: 1000 });
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        try { await pool.query("SELECT 1"); ready = true; break; } catch { await delay(500); }
      }
      if (!ready) throw new Error("[P0] PostgreSQL desechable no inició dentro del presupuesto.");
      await pool.query(await readFile(path.join(root, "tests/fixtures/production-baseline.sql"), "utf8"));
      await pool.query("INSERT INTO test_sandbox (run_id) VALUES ($1)", [runId]);
      await pool.end();
      pool = undefined;
    }
    for (const suite of suites[selection]) {
      const started = Date.now();
      try {
        await executeSuite(suite, env, directory);
        results.push({ suite, status: "passed", durationMs: Date.now() - started });
      } catch (error) {
        results.push({ suite, status: "failed", durationMs: Date.now() - started });
        throw error;
      }
    }
  } finally {
    await pool?.end();
    if (container) docker(["stop", "--time", "3", container], env);
    await writeFile(path.join(directory, "results.json"), JSON.stringify({ selection, baseCommit: sourceSha, status: results.length === suites[selection].length && results.every((result) => result.status === "passed") ? "passed" : "failed", nodeVersion: process.version, postgresImage: selection === "unit" ? null : postgresImage, capturedAt: new Date().toISOString(), results, syntheticFixture: "production-baseline.sql", externalSources: false }, null, 2));
    console.log(`[P0] Evidencia local: ${path.join(directory, "results.json")}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "[P0] Falló la verificación aislada.");
  process.exitCode = 1;
});
