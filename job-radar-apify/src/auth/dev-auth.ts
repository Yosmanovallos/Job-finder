import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

// AI Resume Studio — LOCAL-ONLY development login (npm run dev:resume-studio).
//
// The owner has no email/password account and Google OAuth always returns
// to the production domain, so the local flow could not be tested. This
// lets a fixed test user in, and ONLY when every guard holds:
//
//   1. RESUME_STUDIO_DEV_AUTH === "1" (set by scripts/dev-resume-studio.ts);
//   2. DATABASE_URL points at loopback (the disposable database);
//   3. NODE_ENV !== "production";
//   4. WOMPI_PUBLIC_KEY starts with "pub_test_" (sandbox);
//   5. the request itself is loopback: socket from 127.0.0.1/::1, a
//      localhost Host header (DNS-rebinding) and no proxy headers.
//
// If the variable is set but a guard fails, it is ignored and logged once.
// The token is random per server process; nothing here calls or writes to
// Supabase. Production never sets the variable, and even if it did, guards
// 2–5 fail there.

export const DEV_AUTH_USER = {
  id: "d0000000-0000-4000-8000-00000000de00",
  email: "dev@localhost.test",
  name: "Usuario de prueba (local)"
} as const;

const TOKEN_PREFIX = "rsdev_";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

let token: string | null = null;
let loggedKey = "";

export interface DevAuthStatus {
  active: boolean;
  /** Why it is off although RESUME_STUDIO_DEV_AUTH was set (no secrets). */
  problems: string[];
}

/** Pure check of the process-level guards (1–4). */
export function evaluateDevAuth(env: NodeJS.ProcessEnv = process.env): DevAuthStatus {
  if (env.RESUME_STUDIO_DEV_AUTH !== "1") return { active: false, problems: [] };
  const problems: string[] = [];
  let host = "";
  try {
    host = new URL(env.DATABASE_URL || "").hostname;
  } catch {
    /* reported below */
  }
  if (!LOOPBACK_HOSTS.has(host)) problems.push("DATABASE_URL no es loopback");
  if ((env.NODE_ENV || "").trim().toLowerCase() === "production") problems.push("NODE_ENV=production");
  if (!(env.WOMPI_PUBLIC_KEY || "").startsWith("pub_test_")) problems.push("WOMPI_PUBLIC_KEY no es pub_test_");
  return { active: problems.length === 0, problems };
}

/** Guards 1–4, logging once when the variable is set but ignored. */
export function devAuthActive(env: NodeJS.ProcessEnv = process.env): boolean {
  const status = evaluateDevAuth(env);
  const key = status.problems.join("|");
  if (env.RESUME_STUDIO_DEV_AUTH === "1" && key !== loggedKey) {
    loggedKey = key;
    if (status.active) console.warn("[dev-auth] Login de desarrollo ACTIVO (solo loopback, base desechable, Wompi sandbox).");
    else console.warn(`[dev-auth] RESUME_STUDIO_DEV_AUTH ignorado: ${status.problems.join(", ")}.`);
  }
  return status.active;
}

/** Guard 5: the request reached us directly from this machine. */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket?.remoteAddress || "";
  if (!LOOPBACK_ADDRESSES.has(address)) return false;
  if (req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"] || req.headers["forwarded"]) return false;
  const host = String(req.headers.host || "");
  let hostname = "";
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  return LOOPBACK_HOSTS.has(hostname);
}

/** All five guards. */
export function devAuthAllowed(req: IncomingMessage, env: NodeJS.ProcessEnv = process.env): boolean {
  return devAuthActive(env) && isLoopbackRequest(req);
}

/** The per-process token handed out by POST /api/resume/dev-login. */
export function issueDevToken(): string {
  token ??= `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
  return token;
}

export function isDevToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}

/** Constant-time match against the issued token (false before any issue). */
export function matchesDevToken(value: string): boolean {
  if (!token) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Tests only: forget the issued token and the log memo. */
export function resetDevAuthForTests(): void {
  token = null;
  loggedKey = "";
}
