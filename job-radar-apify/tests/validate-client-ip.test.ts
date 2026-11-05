import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClientIp, resolveClientIp } from "../src/lib/security-monitor.js";

test("the trusted edge header wins over a client-supplied X-Forwarded-For", () => {
  const result = resolveClientIp(
    { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1, 203.0.113.7" },
    "172.16.0.2"
  );
  assert.deepEqual(result, { ip: "203.0.113.7", source: "trusted-header" });
});

test("rotating a forged X-Forwarded-For does not change the bucket", () => {
  const ips = new Set(
    ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map(
      (forged) => resolveClientIp({ "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": forged }, undefined).ip
    )
  );
  assert.deepEqual([...ips], ["198.51.100.4"]);
});

test("the trusted header name is configurable", () => {
  const result = resolveClientIp(
    { "true-client-ip": "198.51.100.9", "cf-connecting-ip": "198.51.100.1" },
    undefined,
    "True-Client-IP"
  );
  assert.deepEqual(result, { ip: "198.51.100.9", source: "trusted-header" });
});

test("an invalid trusted header falls back to the leftmost X-Forwarded-For, never the socket", () => {
  const result = resolveClientIp(
    { "cf-connecting-ip": "not-an-ip", "x-forwarded-for": "192.0.2.10, 172.16.0.1" },
    "172.16.0.2"
  );
  assert.deepEqual(result, { ip: "192.0.2.10", source: "x-forwarded-for" });
});

test("without any forwarding header (local dev) the socket address is used", () => {
  assert.deepEqual(resolveClientIp({}, "::ffff:127.0.0.1"), { ip: "127.0.0.1", source: "socket" });
  assert.deepEqual(resolveClientIp({}, undefined), { ip: "unknown", source: "unknown" });
});

test("IPv6 addresses are bucketed by their /64", () => {
  assert.equal(normalizeClientIp("2001:db8:aa:bb:1:2:3:4"), "2001:db8:aa:bb::/64");
  assert.equal(normalizeClientIp("2001:db8:aa:bb::ffff"), "2001:db8:aa:bb::/64");
  assert.equal(normalizeClientIp("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(normalizeClientIp("::1"), "0:0:0:0::/64");
  assert.equal(
    resolveClientIp({ "cf-connecting-ip": "2001:db8:aa:bb:9:9:9:9" }, undefined).ip,
    resolveClientIp({ "cf-connecting-ip": "2001:db8:aa:bb:1:1:1:1" }, undefined).ip
  );
});

test("garbage is rejected", () => {
  assert.equal(normalizeClientIp(""), null);
  assert.equal(normalizeClientIp("  "), null);
  assert.equal(normalizeClientIp("999.1.1.1"), null);
  assert.equal(normalizeClientIp("1.2.3.4; DROP"), null);
});
