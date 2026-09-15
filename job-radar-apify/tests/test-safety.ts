import path from "node:path";
import { tmpdir } from "node:os";

interface TestOptions {
  runId: string;
  directory: string;
  databaseUrl: string;
  httpPort: number;
  mode: "offline" | "integration";
}

export function buildTestEnvironment(parent: NodeJS.ProcessEnv, options: TestOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "tmpdir", "lang"]);
  for (const [key, value] of Object.entries(parent)) {
    if (allowed.has(key.toLowerCase())) env[key] = value;
  }
  return {
    ...env,
    NODE_ENV: "test",
    ENABLE_CRON: "false",
    VITE_SUPABASE_URL: `http://127.0.0.1:${options.httpPort}`,
    VITE_SUPABASE_ANON_KEY: "p0-synthetic-anonymous-key",
    WOMPI_EVENTS_SECRET: "p0-synthetic-events-secret",
    WOMPI_INTEGRITY_SECRET: "p0-synthetic-integrity-secret",
    JOB_RADAR_TEST_MODE: options.mode,
    JOB_RADAR_TEST_RUN: options.runId,
    TEST_WORK_DIR: options.directory,
    TEST_DATABASE_URL: options.databaseUrl,
    DATABASE_URL: options.databaseUrl,
    TEST_DATABASE_PORT: new URL(options.databaseUrl).port,
    TEST_HTTP_PORT: String(options.httpPort)
  };
}

export function validateTestEnvironment(env: NodeJS.ProcessEnv, cwd: string): URL {
  const reject = (): never => { throw new Error("[P0] Entorno no aislado. Usa npm run test:integration o npm run test:unit; no se admite la base habitual."); };
  const runId = env.JOB_RADAR_TEST_RUN || "";
  if (!/^[a-f0-9]{32}$/.test(runId) || !["offline", "integration"].includes(env.JOB_RADAR_TEST_MODE || "")) reject();
  let url: URL;
  try { url = new URL(env.TEST_DATABASE_URL || ""); } catch { return reject(); }
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.username !== "job_radar_test" ||
      !url.password || url.pathname !== `/job_radar_test_${runId}` || url.search || url.hash ||
      env.DATABASE_URL !== env.TEST_DATABASE_URL || url.port !== env.TEST_DATABASE_PORT) reject();
  const dbPort = Number(url.port);
  const httpPort = Number(env.TEST_HTTP_PORT);
  if (!Number.isInteger(dbPort) || dbPort < 1024 || dbPort > 65535 || dbPort === 5432 ||
      !Number.isInteger(httpPort) || httpPort < 1024 || httpPort > 65535 || httpPort === 5432 || httpPort === dbPort) reject();
  const directory = path.resolve(env.TEST_WORK_DIR || ".");
  if (path.resolve(cwd) !== directory || path.dirname(directory) !== path.resolve(tmpdir()) ||
      !new RegExp(`^job-radar-test-${runId}(?:-[a-zA-Z0-9]+)?$`).test(path.basename(directory))) reject();
  return url;
}

export function assertTestConnection(host: unknown, port: unknown, env: NodeJS.ProcessEnv): void {
  if (env.JOB_RADAR_TEST_MODE !== "integration" || host !== "127.0.0.1" ||
      ![env.TEST_DATABASE_PORT, env.TEST_HTTP_PORT].includes(String(port))) {
    throw new Error("[P0] Conexión bloqueada: las pruebas solo pueden acceder a sus puertos locales asignados.");
  }
}
