import assert from "node:assert/strict";
import test from "node:test";
import { buildChildEnv, safetyProblems } from "../scripts/dev-resume-studio.js";

// R4 local launcher (npm run dev:resume-studio): the child environment is an
// allowlist (every other .env key blanked so dotenv cannot bring it back),
// and the launcher refuses a non-loopback database or non-sandbox Wompi keys.
// Synthetic values only.

const DOTENV = {
  DATABASE_URL: "postgresql://postgres:secret@db.example.supabase.co:5432/postgres",
  NOTION_TOKEN: "secret_notion",
  GOOGLE_INDEXING_PRIVATE_KEY: "-----BEGIN",
  SECURITY_ALERT_WEBHOOK_URL: "https://hooks.example/x",
  VITE_SUPABASE_URL: "https://project.supabase.co",
  VITE_SUPABASE_ANON_KEY: "anon",
  WOMPI_PUBLIC_KEY: "pub_test_abc",
  WOMPI_INTEGRITY_SECRET: "test_integrity_abc",
  WOMPI_EVENTS_SECRET: "test_events_abc",
  RESUME_AI_PROVIDER: "qwen"
};
const LOCAL = "postgresql://resume_dev:pw@127.0.0.1:55001/resume_studio_dev_x";

test("child env: only allowlisted keys survive; the rest of .env is blanked; DB is the local one", () => {
  const env = buildChildEnv(DOTENV, { Path: "C:/bin", SOME_SHELL_SECRET: "nope" }, LOCAL, "3000");
  assert.equal(env.DATABASE_URL, LOCAL);
  for (const key of ["NOTION_TOKEN", "GOOGLE_INDEXING_PRIVATE_KEY", "SECURITY_ALERT_WEBHOOK_URL"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(env, key), key);
    assert.equal(env[key], "", key);
  }
  assert.equal(env.SOME_SHELL_SECRET, undefined);
  assert.equal(env.Path, "C:/bin");
  assert.equal(env.WOMPI_PUBLIC_KEY, "pub_test_abc");
  assert.equal(env.RESUME_AI_PROVIDER, "mock", "qwen sin llave → mock");
  const withKey = buildChildEnv({ ...DOTENV, RESUME_AI_API_KEY: "k", RESUME_AI_WORKSPACE_ID: "ws-1" }, {}, LOCAL, "3000");
  assert.equal(withKey.RESUME_AI_PROVIDER, "qwen");
  assert.equal(buildChildEnv({ ...DOTENV, RESUME_AI_PROVIDER: "" }, {}, LOCAL, "3000").RESUME_AI_PROVIDER, "mock");
  assert.equal(env.RESUME_STUDIO_ENABLED, "true");
  assert.equal(env.RESUME_STUDIO_PAYMENTS, "true");
  assert.equal(env.RESUME_STUDIO_PAYMENTS_LIVE, "");
  assert.deepEqual(safetyProblems(env), []);
});

test("refuses: production database, production Wompi keys, live flag", () => {
  const prodDb = buildChildEnv(DOTENV, {}, DOTENV.DATABASE_URL, "3000");
  assert.match(safetyProblems(prodDb).join(), /loopback/);
  const prodKey = buildChildEnv({ ...DOTENV, WOMPI_PUBLIC_KEY: "pub_prod_abc" }, {}, LOCAL, "3000");
  assert.match(safetyProblems(prodKey).join(), /pub_test_/);
  const prodSecret = buildChildEnv({ ...DOTENV, WOMPI_EVENTS_SECRET: "prod_events_abc" }, {}, LOCAL, "3000");
  assert.match(safetyProblems(prodSecret).join(), /WOMPI_EVENTS_SECRET/);
  const live = { ...buildChildEnv(DOTENV, {}, LOCAL, "3000"), RESUME_STUDIO_PAYMENTS_LIVE: "true" };
  assert.match(safetyProblems(live).join(), /LIVE/);
  // Shell values win over .env, but are checked the same way.
  const shell = buildChildEnv(DOTENV, { WOMPI_PUBLIC_KEY: "pub_prod_shell" }, LOCAL, "3000");
  assert.match(safetyProblems(shell).join(), /pub_test_/);
});
