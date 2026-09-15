import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTestEnvironment, validateTestEnvironment, assertTestConnection } from "./test-safety.js";

const runId = "0123456789abcdef0123456789abcdef";
const directory = path.join(tmpdir(), `job-radar-test-${runId}`);
const databaseUrl = `postgresql://job_radar_test:test-password@127.0.0.1:55432/job_radar_test_${runId}`;
const integration = () => buildTestEnvironment({ PATH: "safe-path" }, {
  runId, directory, databaseUrl, httpPort: 3981, mode: "integration"
});

test("P0-ENV-001: inherited credentials and process injection are discarded", () => {
  const env = buildTestEnvironment({
    PATH: "safe-path", SystemRoot: "C:\\Windows", DATABASE_URL: "production-secret",
    GOOGLE_INDEXING_PRIVATE_KEY: "secret", NODE_OPTIONS: "--require malicious",
    HTTP_PROXY: "secret", PGHOST: "production", ALLOW_TEST_DB_WIPE: "true"
  }, { runId, directory, databaseUrl, httpPort: 3981, mode: "integration" });
  assert.equal(env.PATH, "safe-path");
  assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal(env.DATABASE_URL, databaseUrl);
  for (const key of ["GOOGLE_INDEXING_PRIVATE_KEY", "NODE_OPTIONS", "HTTP_PROXY", "PGHOST", "ALLOW_TEST_DB_WIPE"]) {
    assert.equal(env[key], undefined);
  }
  assert.equal(env.ENABLE_CRON, "false");
});

test("P0-DB-001: accepts only the generated local database and temporary directory", () => {
  assert.doesNotThrow(() => validateTestEnvironment(integration(), directory));
});

for (const url of [
  "postgresql://user:secret@production.example.com:5432/jobs",
  `postgresql://job_radar_test:secret@localhost:55432/job_radar_test_${runId}`,
  `postgresql://job_radar_test:secret@127.0.0.1:55432/postgres`,
  `${databaseUrl}?host=production.example.com`,
  `${databaseUrl}?options=-csearch_path%3Dpublic`,
  `${databaseUrl}#fragment`,
  databaseUrl.replace("postgresql:", "https:"),
  databaseUrl.replace("job_radar_test:", "postgres:"),
  databaseUrl.replace("127.0.0.1", "127.0.0.1.evil.example"),
  databaseUrl.replace(runId, "f".repeat(32))
]) {
  test(`P0-DB-002: rejects unsafe target ${new URL(url).hostname}/${new URL(url).pathname}`, () => {
    const env = { ...integration(), DATABASE_URL: url, TEST_DATABASE_URL: url };
    assert.throws(() => validateTestEnvironment(env, directory), /P0/);
  });
}

test("P0-DB-003: missing marker, mismatched URL and repository cwd fail closed", () => {
  const env = integration();
  assert.throws(() => validateTestEnvironment({}, directory), /P0/);
  assert.throws(() => validateTestEnvironment({ ...env, DATABASE_URL: "other" }, directory), /P0/);
  assert.throws(() => validateTestEnvironment(env, process.cwd()), /P0/);
  assert.throws(() => validateTestEnvironment({ ...env, TEST_HTTP_PORT: "5432" }, directory), /P0/);
  assert.throws(() => validateTestEnvironment({ ...env, JOB_RADAR_TEST_MODE: "production" }, directory), /P0/);
});

test("P0-NET-001: only the exact database and HTTP ports are permitted", () => {
  const env = integration();
  assert.doesNotThrow(() => assertTestConnection("127.0.0.1", 55432, env));
  assert.doesNotThrow(() => assertTestConnection("127.0.0.1", "3981", env));
  for (const [host, port] of [["production.example.com", 443], ["127.0.0.1", 5432], ["localhost", 3981], [undefined, 3981], ["::1", 55432]]) {
    assert.throws(() => assertTestConnection(host, port, env), /P0/);
  }
});

test("P0-NET-002: offline mode does not permit even a local connection", () => {
  assert.throws(() => assertTestConnection("127.0.0.1", 55432, {
    ...integration(), JOB_RADAR_TEST_MODE: "offline"
  }), /P0/);
});

test("P0-ENV-002: preload blocks TCP, HTTP and dotenv before application imports", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), `job-radar-test-${runId}-`));
  try {
    const env = buildTestEnvironment(process.env, { runId, directory: cwd, databaseUrl, httpPort: 3981, mode: "offline" });
    const result = spawnSync(process.execPath, [
      "--import", import.meta.resolve("tsx"), "--import", new URL("./require-test-environment.ts", import.meta.url).href,
      "--input-type=module", "--eval", `
        import assert from 'node:assert/strict';
        import net from 'node:net';
        import http from 'node:http';
        const { default: dotenv } = await import(${JSON.stringify(import.meta.resolve("dotenv"))});
        assert.deepEqual(dotenv.config(), { parsed: {} });
        assert.deepEqual(dotenv.configDotenv(), { parsed: {} });
        assert.throws(() => net.connect({ host: '127.0.0.1', port: 55432 }), /P0/);
        assert.throws(() => http.get('http://127.0.0.1:55432/'), /P0/);
        await assert.rejects(fetch('http://127.0.0.1:55432/'), (error) => /P0/.test(error.cause?.message));
      `
    ], { cwd, env, encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

for (const file of ["validate-seo-job-pages.ts", "validate-companies-search.ts", "validate-job-pagination.ts", "validate-public-baseline.ts", "validate-isolated-database.ts", "validate-adapters.ts"]) {
  test(`P0-ENTRY-001: direct invocation of ${file} fails before loading the application`, () => {
    const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL(file, import.meta.url))], {
      env: buildTestEnvironment(process.env, { runId, directory, databaseUrl, httpPort: 3981, mode: "offline" }),
      encoding: "utf8", timeout: 15000
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\[P0\]/);
    assert.doesNotMatch(result.stderr, /Falta DATABASE_URL/);
  });
}
