import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import {
  devAuthAllowed,
  evaluateDevAuth,
  isDevToken,
  isLoopbackRequest,
  issueDevToken,
  matchesDevToken,
  resetDevAuthForTests
} from "../src/auth/dev-auth.js";

// Local-only dev login guards (src/auth/dev-auth.ts), offline. The HTTP
// round trip with the real verifySession is tests/validate-resume-studio-dev-auth.ts.

const OK = {
  RESUME_STUDIO_DEV_AUTH: "1",
  DATABASE_URL: "postgresql://u:p@127.0.0.1:55001/db",
  NODE_ENV: "development",
  WOMPI_PUBLIC_KEY: "pub_test_x"
};

function req(remoteAddress: string, headers: Record<string, string> = { host: "localhost:3000" }): IncomingMessage {
  return { socket: { remoteAddress }, headers } as unknown as IncomingMessage;
}

test("process guards: all four must hold", () => {
  assert.deepEqual(evaluateDevAuth(OK), { active: true, problems: [] });
  for (const host of ["localhost", "[::1]"]) {
    assert.equal(evaluateDevAuth({ ...OK, DATABASE_URL: `postgresql://u@${host}:5432/db` }).active, true, host);
  }
  const off: Record<string, string | undefined>[] = [
    { RESUME_STUDIO_DEV_AUTH: undefined },
    { RESUME_STUDIO_DEV_AUTH: "true" },
    { DATABASE_URL: "postgresql://u:p@db.example.supabase.co:5432/postgres" },
    { DATABASE_URL: "postgresql://u:p@127.0.0.1.example.com:5432/x" },
    { DATABASE_URL: "" },
    { NODE_ENV: "production" },
    { NODE_ENV: " Production " },
    { WOMPI_PUBLIC_KEY: "pub_prod_x" },
    { WOMPI_PUBLIC_KEY: undefined }
  ];
  for (const change of off) assert.equal(evaluateDevAuth({ ...OK, ...change } as NodeJS.ProcessEnv).active, false, JSON.stringify(change));
  assert.deepEqual(evaluateDevAuth({}), { active: false, problems: [] }, "sin la variable no hay nada que registrar");
});

test("request guard: loopback socket, localhost Host, no proxy headers", () => {
  assert.equal(isLoopbackRequest(req("127.0.0.1")), true);
  assert.equal(isLoopbackRequest(req("::1", { host: "[::1]:3000" })), true);
  assert.equal(isLoopbackRequest(req("::ffff:127.0.0.1", { host: "127.0.0.1:3100" })), true);
  assert.equal(isLoopbackRequest(req("10.0.0.5")), false);
  assert.equal(isLoopbackRequest(req("127.0.0.1", { host: "buscotrabajo.co" })), false);
  assert.equal(isLoopbackRequest(req("127.0.0.1", { host: "localhost.evil.com" })), false);
  assert.equal(isLoopbackRequest(req("127.0.0.1", {})), false);
  assert.equal(isLoopbackRequest(req("127.0.0.1", { host: "localhost", "x-forwarded-for": "1.2.3.4" })), false);
  assert.equal(isLoopbackRequest(req("127.0.0.1", { host: "localhost", forwarded: "for=1.2.3.4" })), false);
  assert.equal(devAuthAllowed(req("127.0.0.1"), OK), true);
  assert.equal(devAuthAllowed(req("127.0.0.1"), { ...OK, NODE_ENV: "production" }), false);
});

test("token: random per process, constant-time match, nothing before issue", () => {
  resetDevAuthForTests();
  assert.equal(matchesDevToken("rsdev_" + "0".repeat(64)), false);
  const token = issueDevToken();
  assert.match(token, /^rsdev_[0-9a-f]{64}$/);
  assert.equal(issueDevToken(), token);
  assert.equal(isDevToken(token), true);
  assert.equal(isDevToken("eyJhbGciOi"), false);
  assert.equal(matchesDevToken(token), true);
  assert.equal(matchesDevToken(token.slice(0, -1)), false);
  assert.equal(matchesDevToken(`${token}0`), false);
  resetDevAuthForTests();
  assert.notEqual(issueDevToken(), token);
});
