import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import {
  assertFetchableUrl,
  isBlockedAddress,
  safeFetchHtml,
  SafeFetchError,
  type HopResponse,
  type ResolvedAddress,
  type Resolver,
  type SafeFetchErrorCode,
  type Transport
} from "../src/resume-studio/job-link/safe-fetch.js";

// AI Resume Studio R2 — SSRF (doc 08, doc 11 §5.3). No socket is ever
// opened: DNS and transport are fakes that record what the fetcher asked.

interface FakeReply {
  status?: number;
  headers?: Record<string, string>;
  chunks?: Buffer[];
  /** Delay before each chunk, ms. */
  delayMs?: number;
  /** Never ends. */
  hang?: boolean;
}

function fakes(dns: Record<string, string[]>, pages: Record<string, FakeReply>) {
  const calls: { url: string; pinned: ResolvedAddress }[] = [];
  const resolver: Resolver = async (host) => {
    const answers = dns[host];
    if (!answers) throw new Error("ENOTFOUND");
    return answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  const transport: Transport = async (url, pinned) => {
    calls.push({ url: url.toString(), pinned });
    const reply = pages[url.toString()] ?? (url.pathname === "/robots.txt" ? { status: 404 } : { status: 404 });
    let discarded = false;
    const response: HopResponse = {
      status: reply.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...(reply.headers ?? {}) },
      discard: () => {
        discarded = true;
      },
      body: (async function* () {
        if (reply.hang) await new Promise(() => undefined);
        for (const chunk of reply.chunks ?? [Buffer.from("<html>ok</html>")]) {
          if (discarded) return;
          if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
          yield chunk;
        }
      })()
    };
    return response;
  };
  return { calls, resolver, transport };
}

async function code(promise: Promise<unknown>): Promise<SafeFetchErrorCode> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SafeFetchError, String(error));
    return error.code;
  }
  assert.fail("the fetch was allowed");
}

test("SSRF-1 the address policy blocks every private, loopback, link-local, metadata and reserved range", () => {
  for (const address of [
    "127.0.0.1", "127.1.2.3", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "198.18.0.1", "224.0.0.1", "255.255.255.255", "192.0.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "::127.0.0.1", "2001:db8::1",
    "not-an-ip"
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "190.24.1.1", "172.32.0.1", "100.128.0.1", "2800:3f0:4005::200e", "::ffff:8.8.8.8", "2002:808:808::"]) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test("SSRF-2 schemes, ports, credentials and internal names are refused before any DNS", () => {
  const cases: [string, SafeFetchErrorCode][] = [
    ["file:///etc/passwd", "blocked_scheme"],
    ["ftp://example.com/x", "blocked_scheme"],
    ["gopher://example.com:70/", "blocked_scheme"],
    ["javascript:alert(1)", "blocked_scheme"],
    ["http://example.com:22/", "blocked_port"],
    ["https://example.com:8443/", "blocked_port"],
    ["http://user:pass@example.com/", "blocked_credentials"],
    ["http://localhost/", "blocked_host"],
    ["http://api.internal/", "blocked_host"],
    ["http://metadata.google.internal/computeMetadata/v1/", "blocked_host"],
    ["http://intranet/", "blocked_host"],
    ["http://127.0.0.1/", "blocked_address"],
    ["http://2130706433/", "blocked_address"], // decimal 127.0.0.1, normalized by the URL parser
    ["http://0x7f.1/", "blocked_address"],
    ["http://017700000001/", "blocked_address"],
    ["http://[::ffff:127.0.0.1]/", "blocked_address"],
    ["http://[::1]:80/", "blocked_address"],
    ["http://169.254.169.254/latest/meta-data/", "blocked_address"],
    ["not a url", "invalid_url"]
  ];
  for (const [url, expected] of cases) {
    assert.throws(() => assertFetchableUrl(url), (error: unknown) => error instanceof SafeFetchError && error.code === expected, url);
  }
  assert.equal(assertFetchableUrl("https://www.elempleo.com/co/ofertas-trabajo/x").hostname, "www.elempleo.com");
});

test("SSRF-3 a name resolving to a private address, or to public AND private, is refused; no connection is made", async () => {
  const { calls, resolver, transport } = fakes(
    { "evil.example": ["10.0.0.5"], "mixed.example": ["93.184.216.34", "127.0.0.1"], "v6.example": ["::ffff:169.254.169.254"] },
    {}
  );
  assert.equal(await code(safeFetchHtml("https://evil.example/job", { resolver, transport })), "blocked_address");
  assert.equal(await code(safeFetchHtml("https://mixed.example/job", { resolver, transport })), "blocked_address");
  assert.equal(await code(safeFetchHtml("https://v6.example/job", { resolver, transport })), "blocked_address");
  assert.equal(calls.length, 0);
});

test("SSRF-4 the socket is pinned to the vetted address (no DNS rebinding window)", async () => {
  const { calls, resolver, transport } = fakes({ "jobs.example": ["93.184.216.34"] }, { "https://jobs.example/v/1": { chunks: [Buffer.from("<p>x</p>")] } });
  const result = await safeFetchHtml("https://jobs.example/v/1", { resolver, transport });
  assert.equal(result.status, 200);
  assert.ok(calls.every((call) => call.pinned.address === "93.184.216.34"));
  // The real transport hands Node a lookup that only ever returns the pinned address.
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/resume-studio/job-link/safe-fetch.ts", import.meta.url), "utf8"));
  assert.match(source, /lookup: \(\(_host: string, options: \{ all\?: boolean \}, callback/);
  assert.match(source, /agent: false/);
});

test("SSRF-5 every redirect hop is re-vetted: a 302 to a private IP or internal name is refused", async () => {
  const { calls, resolver, transport } = fakes(
    { "jobs.example": ["93.184.216.34"], "rebind.example": ["192.168.0.10"] },
    {
      "https://jobs.example/a": { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } },
      "https://jobs.example/b": { status: 301, headers: { location: "https://rebind.example/x" } },
      "https://jobs.example/c": { status: 307, headers: { location: "http://localhost:8080/admin" } },
      "https://jobs.example/d": { status: 302, headers: { location: "file:///etc/passwd" } }
    }
  );
  assert.equal(await code(safeFetchHtml("https://jobs.example/a", { resolver, transport })), "blocked_address");
  assert.equal(await code(safeFetchHtml("https://jobs.example/b", { resolver, transport })), "blocked_address");
  assert.equal(await code(safeFetchHtml("https://jobs.example/c", { resolver, transport })), "blocked_port");
  assert.equal(await code(safeFetchHtml("https://jobs.example/d", { resolver, transport })), "blocked_scheme");
  assert.ok(!calls.some((call) => /169\.254|rebind|localhost|file:/.test(call.url)), "no request reached the redirect target");
});

test("SSRF-6 at most 3 redirects", async () => {
  const pages: Record<string, FakeReply> = {};
  for (let i = 0; i < 6; i++) pages[`https://jobs.example/r${i}`] = { status: 302, headers: { location: `/r${i + 1}` } };
  const { resolver, transport } = fakes({ "jobs.example": ["93.184.216.34"] }, pages);
  assert.equal(await code(safeFetchHtml("https://jobs.example/r0", { resolver, transport, robots: false })), "too_many_redirects");
  pages["https://jobs.example/r2"] = { chunks: [Buffer.from("<p>fin</p>")] };
  assert.equal((await safeFetchHtml("https://jobs.example/r0", { resolver, transport, robots: false })).redirects, 2);
});

test("SSRF-7 bodies over 2 MB are cut while streaming, also when compressed or when Content-Length lies", async () => {
  const mb = Buffer.alloc(1024 * 1024, 0x61);
  const { resolver, transport } = fakes(
    { "big.example": ["93.184.216.34"] },
    {
      "https://big.example/declared": { headers: { "content-length": String(50 * 1024 * 1024) } },
      "https://big.example/streamed": { headers: { "content-length": "10" }, chunks: [mb, mb, mb] },
      "https://big.example/gzip": { headers: { "content-encoding": "gzip" }, chunks: [gzipSync(Buffer.alloc(30 * 1024 * 1024, 0x61))] },
      "https://big.example/ok-gzip": { headers: { "content-encoding": "gzip" }, chunks: [gzipSync(Buffer.from("<p>hola</p>"))] }
    }
  );
  const deps = { resolver, transport, robots: false };
  assert.equal(await code(safeFetchHtml("https://big.example/declared", deps)), "too_large");
  assert.equal(await code(safeFetchHtml("https://big.example/streamed", deps)), "too_large");
  assert.equal(await code(safeFetchHtml("https://big.example/gzip", deps)), "too_large");
  assert.equal((await safeFetchHtml("https://big.example/ok-gzip", deps)).body, "<p>hola</p>");
});

test("SSRF-8 one deadline for the whole fetch: a slow or hanging body times out", async () => {
  const { resolver, transport } = fakes(
    { "slow.example": ["93.184.216.34"] },
    {
      "https://slow.example/drip": { chunks: Array.from({ length: 50 }, () => Buffer.from("x")), delayMs: 20 },
      "https://slow.example/hang": { hang: true }
    }
  );
  const started = Date.now();
  assert.equal(await code(safeFetchHtml("https://slow.example/drip", { resolver, transport, robots: false, timeoutMs: 150 })), "timeout");
  assert.equal(await code(safeFetchHtml("https://slow.example/hang", { resolver, transport, robots: false, timeoutMs: 150 })), "timeout");
  assert.ok(Date.now() - started < 2000);
});

test("SSRF-9 only text/html is read; other types and unknown encodings are refused", async () => {
  const { resolver, transport } = fakes(
    { "t.example": ["93.184.216.34"] },
    {
      "https://t.example/json": { headers: { "content-type": "application/json" } },
      "https://t.example/pdf": { headers: { "content-type": "application/pdf" } },
      "https://t.example/none": { headers: { "content-type": "" } },
      "https://t.example/zstd": { headers: { "content-encoding": "zstd" } },
      "https://t.example/xhtml": { headers: { "content-type": "application/xhtml+xml" } }
    }
  );
  const deps = { resolver, transport, robots: false };
  assert.equal(await code(safeFetchHtml("https://t.example/json", deps)), "not_html");
  assert.equal(await code(safeFetchHtml("https://t.example/pdf", deps)), "not_html");
  assert.equal(await code(safeFetchHtml("https://t.example/none", deps)), "not_html");
  assert.equal(await code(safeFetchHtml("https://t.example/zstd", deps)), "not_html");
  assert.equal((await safeFetchHtml("https://t.example/xhtml", deps)).status, 200);
});

test("SSRF-10 robots.txt is honored for our bot; an unreachable robots.txt means no fetch", async () => {
  const { calls, resolver, transport } = fakes(
    { "r.example": ["93.184.216.34"], "down.example": ["93.184.216.34"] },
    {
      "https://r.example/robots.txt": { headers: { "content-type": "text/plain" }, chunks: [Buffer.from("User-agent: *\nDisallow: /privado/\n")] },
      "https://down.example/robots.txt": { status: 503 }
    }
  );
  assert.equal(await code(safeFetchHtml("https://r.example/privado/vacante", { resolver, transport })), "robots_disallowed");
  assert.equal(calls.filter((call) => call.url.includes("/privado/")).length, 0);
  assert.equal((await safeFetchHtml("https://r.example/publico/vacante", { resolver, transport })).status, 404);
  assert.equal(await code(safeFetchHtml("https://down.example/vacante", { resolver, transport })), "robots_disallowed");
});

test("SSRF-11 headers identify a generic client: no cookies, no personal data, identity encoding", async () => {
  let sent: Record<string, string> = {};
  const transport: Transport = async (_url, _pinned, headers) => {
    sent = headers;
    return { status: 200, headers: { "content-type": "text/html" }, discard: () => undefined, body: (async function* () {})() };
  };
  await safeFetchHtml("https://jobs.example/x", { resolver: async () => [{ address: "93.184.216.34", family: 4 }], transport, robots: false });
  assert.deepEqual(Object.keys(sent).sort(), ["Accept", "Accept-Encoding", "Accept-Language", "User-Agent"]);
  assert.equal(sent["Accept-Encoding"], "identity");
  assert.match(sent["User-Agent"], /^BuscoTrabajoBot\/1\.0 \(\+https:\/\/buscotrabajo\.co\)$/);
});
