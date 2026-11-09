import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import test from "node:test";
import { PublicApiLimiter } from "../src/lib/public-api-limiter.js";
import { PUBLIC_API_POLICY, PUBLIC_API_USAGE } from "../src/lib/public-api-policy.js";
import { parsePublicJobsQuery } from "../src/lib/public-jobs-api.js";
import { OPENAPI_DOCUMENT, LLMS_TXT, PUBLIC_PAGES, AGENT_SKILL_ARTIFACTS } from "../src/lib/agent-readiness.js";
import { readJsonBodyCapped } from "../src/server/http-helpers.js";
import { handleAgentReadinessRoute } from "../src/server/routes/agent-readiness.js";
import type { SendBody } from "../src/server/routes/agent-readiness.js";

function admit(limiter: PublicApiLimiter, client: string): void {
  const result = limiter.acquire(client);
  assert.equal(result.allowed, true);
  if (result.allowed) result.release();
}

test("five per sliding minute; rejected requests do not prolong the window", () => {
  let now = 0;
  const limiter = new PublicApiLimiter(() => now);
  for (let i = 0; i < 5; i++) admit(limiter, "client");
  assert.deepEqual(limiter.acquire("client"), { allowed: false, retryAfter: 60 });
  now = 59_999;
  assert.deepEqual(limiter.acquire("client"), { allowed: false, retryAfter: 1 });
  now = 60_000;
  admit(limiter, "client");
});

test("25 per sliding 24 hours and expiry at the exact boundary", () => {
  let now = 0;
  const limiter = new PublicApiLimiter(() => now);
  for (let minute = 0; minute < 5; minute++) {
    now = minute * 60_000;
    for (let i = 0; i < 5; i++) admit(limiter, "client");
  }
  now = 300_000;
  assert.deepEqual(limiter.acquire("client"), { allowed: false, retryAfter: 86_100 });
  now = 86_400_000;
  admit(limiter, "client");
});

test("global minute quota holds even with a new client identity on every request", () => {
  const limiter = new PublicApiLimiter(() => 0);
  for (let i = 0; i < 30; i++) admit(limiter, `client-${i}`);
  assert.deepEqual(limiter.acquire("rotated"), { allowed: false, retryAfter: 60 });
});

test("global daily quota, bounded history and expiry", () => {
  let now = 0;
  const limiter = new PublicApiLimiter(() => now);
  for (let i = 0; i < 500; i++) {
    now = Math.floor(i / 30) * 60_000;
    admit(limiter, `client-${i}`);
  }
  now = 1_020_000;
  assert.deepEqual(limiter.acquire("rotated"), { allowed: false, retryAfter: 85_380 });
  now = 86_400_000;
  admit(limiter, "after-expiry");
});

test("two concurrent requests, idempotent release and no admission while busy", () => {
  const limiter = new PublicApiLimiter(() => 0);
  const first = limiter.acquire("one");
  const second = limiter.acquire("two");
  assert.equal(first.allowed && second.allowed, true);
  assert.deepEqual(limiter.acquire("three"), { allowed: false, retryAfter: 60 });
  if (first.allowed) { first.release(); first.release(); }
  const third = limiter.acquire("three");
  assert.equal(third.allowed, true);
  assert.equal(limiter.acquire("four").allowed, false);
  if (second.allowed) second.release();
  if (third.allowed) third.release();
});

test("search defaults to three, rejects pagination and rejects duplicate or malformed limits", () => {
  const parsed = parsePublicJobsQuery(new URLSearchParams());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.limit, 3);
    assert.equal(parsed.value.offset, 0);
  }
  for (const query of ["limit=4", "limit=50", "offset=1", "offset=5000", "limit=1&limit=2", "limit=-1", "limit=1.5"]) {
    assert.equal(parsePublicJobsQuery(new URLSearchParams(query)).ok, false, query);
  }
});

test("OpenAPI, docs, llms and skill explain the effective sample policy", () => {
  const params = OPENAPI_DOCUMENT.paths["/api/v1/jobs"].get.parameters;
  assert.equal(params.find((param) => param.name === "limit")?.schema.maximum, PUBLIC_API_POLICY.results);
  assert.equal(params.find((param) => param.name === "offset")?.schema.maximum, 0);
  assert.equal(OPENAPI_DOCUMENT.components.schemas.Pagination.properties.hasMore.const, false);
  assert.ok(LLMS_TXT.includes(PUBLIC_API_USAGE));
  assert.ok(JSON.stringify(PUBLIC_PAGES["/docs"]).includes(PUBLIC_API_USAGE));
  assert.ok(AGENT_SKILL_ARTIFACTS["/.well-known/agent-skills/search-buscotrabajo-jobs/SKILL.md"]?.includes(PUBLIC_API_USAGE));
});

function request(pathname: string, clientIp: string, method = "GET", body?: unknown, send?: SendBody) {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const res = new ServerResponse(req);
  let responseBody = "";
  const parsedUrl = new URL(pathname, "https://buscotrabajo.co");
  const done = handleAgentReadinessRoute(req, res, {
    pathname: parsedUrl.pathname, method, parsedUrl, clientIp,
    loadIndexHtml: async () => "<html><body></body></html>",
    sendBody: send ?? (async (_req, response, status, headers, text) => {
      response.statusCode = status;
      for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) response.setHeader(name, value);
      }
      responseBody = text.toString();
    })
  });
  if (body !== undefined) req.push(JSON.stringify(body));
  req.push(null);
  return { req, res, done, body: () => JSON.parse(responseBody) as Record<string, unknown> };
}

test("REST, HEAD, invalid search, MCP and A2A consume the same client quota", async () => {
  const client = "quota-shared";
  for (const [path, method, body] of [
    ["/api/v1/countries", "GET", undefined],
    ["/mcp", "POST", { jsonrpc: "2.0", id: 1, method: "initialize" }],
    ["/a2a", "POST", {}],
    ["/api/v1/jobs?limit=4", "GET", undefined],
    ["/api/v1/countries", "HEAD", undefined]
  ] as const) {
    const call = request(path, client, method, body);
    await call.done;
    assert.notEqual(call.res.statusCode, 429, path);
  }
  for (const path of ["/api/v1/countries", "/mcp", "/a2a"]) {
    const call = request(path, client, path.startsWith("/api/") ? "HEAD" : "POST", {});
    await call.done;
    assert.equal(call.res.statusCode, 429, path);
    assert.ok(Number(call.res.getHeader("Retry-After")) > 0);
    assert.equal(call.res.getHeader("Cache-Control"), "private, no-store");
  }
});

test("metadata responses are not shared-cacheable and OPTIONS/discovery bypass sample quota", async () => {
  const call = request("/api/v1/countries", "metadata");
  await call.done;
  assert.equal(call.res.statusCode, 200);
  assert.equal(call.res.getHeader("Cache-Control"), "private, no-store");
  for (let i = 0; i < 6; i++) await request("/api/v1/jobs", "preflight", "OPTIONS").done;
  const admitted = request("/api/v1/countries", "preflight");
  await admitted.done;
  assert.equal(admitted.res.statusCode, 200);
  const discovery = request("/openapi.json", "quota-shared");
  await discovery.done;
  assert.equal(discovery.res.statusCode, 200);
});

test("route concurrency is released after a response failure", async () => {
  await assert.rejects(request("/api/v1/countries", "failure", "GET", undefined,
    async () => { throw new Error("synthetic send failure"); }).done, /synthetic/);
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  const first = request("/api/v1/countries", "after-failure-one", "GET", undefined, async () => gate);
  const second = request("/api/v1/countries", "after-failure-two", "GET", undefined, async () => gate);
  const busy = request("/api/v1/countries", "busy");
  await busy.done;
  assert.equal(busy.res.statusCode, 429);
  unblock();
  await Promise.all([first.done, second.done]);
  assert.equal(first.res.statusCode, 200);
  assert.equal(second.res.statusCode, 200);

});

test("protocol body reader handles valid, oversized, aborted and timed-out bodies", async () => {
  const valid = new IncomingMessage(new Socket());
  const result = readJsonBodyCapped(valid, 20, 100);
  valid.push('{"ok":true}'); valid.push(null);
  assert.deepEqual(await result, { ok: true, value: { ok: true } });
  const large = new IncomingMessage(new Socket());
  const oversized = readJsonBodyCapped(large, 2, 100);
  large.push("123");
  assert.deepEqual(await oversized, { ok: false });
  const aborted = new IncomingMessage(new Socket());
  const disconnected = readJsonBodyCapped(aborted, 20, 100);
  aborted.emit("aborted");
  assert.deepEqual(await disconnected, { ok: false });
  const slow = new IncomingMessage(new Socket());
  assert.deepEqual(await readJsonBodyCapped(slow, 20, 5), { ok: false });
  assert.equal(slow.listenerCount("data"), 0);
});
