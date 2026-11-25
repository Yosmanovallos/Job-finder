/**
 * AI Resume Studio R4 — safe local launcher for a manual test of the whole
 * flow (CV → vacancy → agent → pass → Wompi SANDBOX → download).
 *
 *   npm run dev:resume-studio                 (build + server on :3000)
 *   npm run dev:resume-studio -- --skip-build (reuse public/)
 *   npm run dev:resume-studio -- --port 3100
 *   npm run dev:resume-studio -- --dry-run    (checks only, no Docker)
 *   npm run dev:resume-studio -- --env-file ..\..\..\..\job-radar-apify\.env
 *                                             (a worktree using the main .env)
 *
 * Why it exists: the `.env` DATABASE_URL is PRODUCTION (CLAUDE.md), and the
 * rs_* tables must not reach Supabase before R5 (ADR 0017 §6). So:
 *
 * - A disposable PostgreSQL 16 runs in local Docker, same pinned image and
 *   hardening as `npm run test:integration` (loopback-only port, tmpfs, random
 *   password, --rm). Stopping the launcher (Ctrl+C) deletes it and its data.
 * - DATABASE_URL is replaced with that database; the launcher REFUSES to
 *   continue unless it points at loopback.
 * - Migrations (`scripts/migrate.ts`, then `scripts/migrate-resume-studio.ts`)
 *   run only against it.
 * - The children get an ALLOWLISTED environment. Every other `.env` key is
 *   passed as an empty string so the children's own dotenv.config() cannot
 *   bring it back (dotenv never overrides an existing key): no Notion, Google
 *   Indexing, Jooble, proxy, alert webhook or production database.
 * - REFUSES to start unless WOMPI_PUBLIC_KEY is `pub_test_…` and the
 *   integrity/events secrets are `test_…` (sandbox), and if
 *   RESUME_STUDIO_PAYMENTS_LIVE is set.
 * - Never prints a secret: only flags, key prefixes and the local port.
 *
 * Sign-in: the button «Entrar como usuario de prueba (solo local)» on
 * /hoja-de-vida (RESUME_STUDIO_DEV_AUTH, src/auth/dev-auth.ts) logs in a
 * fixed user (dev@localhost.test) that only exists in the disposable
 * database; Supabase is never called for it. If .env has the real
 * VITE_SUPABASE_URL/ANON_KEY, Google/email login keeps working as before
 * (read-only auth.getUser); without them, placeholders that point nowhere
 * are used. Every app row is written to the disposable database only.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POSTGRES_IMAGE = "postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const PASSTHROUGH = new Set(["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "tmpdir", "lang", "userprofile", "appdata", "localappdata", "home"]);
// Keys taken from .env as they are. Everything else in .env is blanked.
const FROM_DOTENV = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "WOMPI_PUBLIC_KEY",
  "WOMPI_INTEGRITY_SECRET",
  "WOMPI_EVENTS_SECRET",
  "RESUME_STUDIO_ENABLED",
  "RESUME_STUDIO_PAYMENTS",
  "RESUME_AI_PROVIDER",
  "RESUME_AI_WORKSPACE_ID",
  "RESUME_AI_API_KEY",
  "RESUME_AI_MODEL_FAST",
  "RESUME_AI_MODEL_REWRITE",
  "RESUME_AI_PRICE_FAST_IN",
  "RESUME_AI_PRICE_FAST_OUT",
  "RESUME_AI_PRICE_REWRITE_IN",
  "RESUME_AI_PRICE_REWRITE_OUT",
  "RESUME_AI_CAP_ADAPTATION_USD",
  "RESUME_AI_CAP_USER_DAILY_USD",
  "RESUME_AI_CAP_GLOBAL_DAILY_USD",
  "RESUME_AI_CAP_GLOBAL_MONTHLY_USD",
  "RESUME_AI_COP_PER_USD",
  "RESUME_AI_TIMEOUT_MS"
];

function fail(message: string): never {
  console.error(`\n[dev:resume-studio] ✋ ${message}\n`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readDotenv(): Record<string, string> {
  // R4c: --env-file lets a git worktree use the main checkout's .env without
  // copying it. Same allowlist either way; the children never read it.
  const given = arg("--env-file");
  const file = given ? path.resolve(given) : path.join(root, ".env");
  if (given && !existsSync(file)) fail(`No existe ${given}.`);
  if (!existsSync(file)) return {};
  return dotenv.parse(readFileSync(file));
}

export function buildChildEnv(dotenvValues: Record<string, string>, parent: NodeJS.ProcessEnv, databaseUrl: string, port: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) if (PASSTHROUGH.has(key.toLowerCase())) env[key] = value;
  // Blank every other .env key so a child's dotenv.config() cannot load it.
  for (const key of Object.keys(dotenvValues)) env[key] = "";
  for (const key of FROM_DOTENV) {
    const value = parent[key] ?? dotenvValues[key];
    if (value !== undefined) env[key] = value;
  }
  env.RESUME_STUDIO_ENABLED = env.RESUME_STUDIO_ENABLED || "true";
  env.RESUME_STUDIO_PAYMENTS = env.RESUME_STUDIO_PAYMENTS || "true";
  // Provider from .env; without a usable Qwen key the local run uses the free mock.
  const provider = (env.RESUME_AI_PROVIDER || "").trim().toLowerCase();
  env.RESUME_AI_PROVIDER = provider === "qwen" && env.RESUME_AI_API_KEY && env.RESUME_AI_WORKSPACE_ID ? "qwen" : provider === "none" ? "none" : "mock";
  env.RESUME_STUDIO_PAYMENTS_LIVE = "";
  env.DATABASE_URL = databaseUrl;
  env.PORT = port;
  env.NODE_ENV = "development";
  env.ENABLE_CRON = "false";
  // Local dev login (src/auth/dev-auth.ts): the server re-checks every guard
  // (loopback DB and request, non-production, Wompi sandbox) and the Vite
  // flag only compiles the button into THIS local build.
  env.RESUME_STUDIO_DEV_AUTH = "1";
  env.VITE_RESUME_STUDIO_DEV_AUTH = "1";
  // Without a Supabase project the build still needs the two values; these
  // point nowhere (a closed loopback port), so only the dev login works.
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
    env.VITE_SUPABASE_ANON_KEY = "dev-local-placeholder";
  }
  return env;
}

/** The two hard stops: loopback database, sandbox-only Wompi. Returns the problems found. */
export function safetyProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  let host = "";
  try {
    host = new URL(env.DATABASE_URL || "").hostname;
  } catch {
    problems.push("DATABASE_URL no es una URL válida.");
  }
  if (host && !LOOPBACK.has(host)) problems.push(`DATABASE_URL apunta a «${host}», no a loopback. No se arranca.`);
  if (env.RESUME_STUDIO_PAYMENTS === "true") {
    if (!(env.WOMPI_PUBLIC_KEY || "").startsWith("pub_test_")) problems.push("WOMPI_PUBLIC_KEY no es de sandbox (pub_test_…).");
    if (!(env.WOMPI_INTEGRITY_SECRET || "").startsWith("test_")) problems.push("WOMPI_INTEGRITY_SECRET no es de sandbox (test_…).");
    if (!(env.WOMPI_EVENTS_SECRET || "").startsWith("test_")) problems.push("WOMPI_EVENTS_SECRET no es de sandbox (test_…).");
  }
  if (env.RESUME_STUDIO_PAYMENTS_LIVE) problems.push("RESUME_STUDIO_PAYMENTS_LIVE no se permite en local.");
  if ((env.NODE_ENV || "").toLowerCase() === "production") problems.push("NODE_ENV=production no se permite en local.");
  return problems;
}

function docker(args: string[], extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync("docker", args, { encoding: "utf8", env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }).trim();
}

function runChild(command: string[], env: NodeJS.ProcessEnv, label: string): void {
  console.log(`[dev:resume-studio] ${label}…`);
  execFileSync(process.execPath, command, { cwd: root, env, stdio: "inherit", timeout: 180000 });
}

async function main() {
  const port = arg("--port") ?? "3000";
  if (!/^\d{4,5}$/.test(port)) fail("--port no válido.");
  const values = readDotenv();

  // Preflight with a placeholder loopback URL: refuse before touching Docker.
  const preflight = buildChildEnv(values, process.env, "postgresql://x@127.0.0.1:1/x", port);
  const problems = safetyProblems(preflight);
  if (problems.length) fail(problems.join("\n  "));
  const summary = {
    RESUME_STUDIO_ENABLED: preflight.RESUME_STUDIO_ENABLED,
    RESUME_STUDIO_PAYMENTS: preflight.RESUME_STUDIO_PAYMENTS,
    RESUME_AI_PROVIDER: preflight.RESUME_AI_PROVIDER,
    WOMPI_PUBLIC_KEY: preflight.WOMPI_PUBLIC_KEY ? "pub_test_… (oculta)" : "(sin llave)",
    "claves .env bloqueadas": Object.keys(values).filter((k) => !FROM_DOTENV.includes(k)).length
  };
  console.log("[dev:resume-studio] Configuración:", summary);
  if (process.argv.includes("--dry-run")) {
    console.log("[dev:resume-studio] --dry-run: chequeos OK, no se arrancó nada.");
    return;
  }

  const endpoint = docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
  if (!endpoint.startsWith("npipe://") && !endpoint.startsWith("unix://")) fail("Solo se admite un motor Docker local.");

  // A launcher killed hard leaves its container: its data is disposable, remove it.
  for (const leftover of docker(["ps", "-q", "--filter", "label=resume-studio-dev"]).split(/\s+/).filter(Boolean)) {
    docker(["stop", "--time", "3", leftover]);
    console.log("[dev:resume-studio] Contenedor sobrante de una sesión anterior eliminado.");
  }

  const runId = randomBytes(8).toString("hex");
  const password = randomBytes(24).toString("hex");
  const database = `resume_studio_dev_${runId}`;
  const container = docker(
    [
      "run", "--detach", "--rm",
      "--name", `resume-studio-dev-${runId}`,
      "--label", `resume-studio-dev=${runId}`,
      "--memory", "512m", "--cpus", "1",
      "--publish", "127.0.0.1::5432",
      "--tmpfs", "/var/lib/postgresql/data",
      "--env", "POSTGRES_USER=resume_dev",
      "--env", `POSTGRES_DB=${database}`,
      "--env", "POSTGRES_PASSWORD",
      POSTGRES_IMAGE
    ],
    { POSTGRES_PASSWORD: password }
  );
  let server: ChildProcess | null = null;
  let stopped = false;
  const stop = (code: number) => {
    if (stopped) return;
    stopped = true;
    if (server && !server.killed) server.kill();
    try {
      docker(["stop", "--time", "3", container]);
      console.log("[dev:resume-studio] Base desechable eliminada.");
    } catch {
      console.warn(`[dev:resume-studio] No se pudo detener el contenedor; bórralo con: docker stop resume-studio-dev-${runId}`);
    }
    process.exit(code);
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  try {
    const hostPort = docker(["port", container, "5432/tcp"]).match(/^127\.0\.0\.1:(\d+)$/m)?.[1];
    if (!hostPort) throw new Error("Docker no publicó un puerto exclusivamente local.");
    const databaseUrl = `postgresql://resume_dev:${password}@127.0.0.1:${hostPort}/${database}`;
    const env = buildChildEnv(values, process.env, databaseUrl, port);
    const again = safetyProblems(env);
    if (again.length) throw new Error(again.join(" "));

    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 1000 });
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt++) {
      try {
        await pool.query("SELECT 1");
        ready = true;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (ready) {
      // Supabase-like roles, so the RLS/REVOKE checks of migrate-resume-studio apply locally too.
      for (const role of ["anon", "authenticated"]) {
        await pool.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
      }
    }
    await pool.end();
    if (!ready) throw new Error("El Postgres desechable no respondió.");
    console.log(`[dev:resume-studio] Postgres desechable listo en 127.0.0.1:${hostPort} (se borra al salir).`);

    const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
    runChild([tsx, "scripts/migrate.ts"], env, "Aplicando schema.sql a la base desechable");
    runChild([tsx, "scripts/migrate-resume-studio.ts"], env, "Aplicando el bloque resume-studio (rs_*) a la base desechable");
    if (!process.argv.includes("--skip-build")) {
      runChild([path.join(root, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", "public"], env, "Compilando el frontend");
    }

    console.log(
      `\n[dev:resume-studio] Abre http://localhost:${port}/hoja-de-vida y pulsa «Entrar como usuario de prueba (solo local)» — Ctrl+C para detener y borrar la base.\n`
    );
    server = spawn(process.execPath, [tsx, "src/server.ts"], { cwd: root, env, stdio: "inherit" });
    server.on("exit", (code) => stop(code ?? 0));
  } catch (error) {
    console.error(`[dev:resume-studio] Falló: ${(error as Error).message}`);
    stop(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void main();
