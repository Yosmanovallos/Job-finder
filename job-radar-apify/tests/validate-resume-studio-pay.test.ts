import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { emptyResumeFacts, type ResumeFacts } from "../src/lib/resume-studio.js";
import { computeWompiChecksum, verifyWompiChecksum } from "../src/payments/wompi-signature.js";
import { buildResumeDocumentXml, buildResumeDocx, crc32, xmlEscape } from "../src/resume-studio/docx.js";
import {
  PASS_IDS,
  RESUME_PASSES,
  freePeriodEnd,
  freePeriodStart,
  isPassId,
  passAmountInCents,
  passPeriodEnd,
  passPeriodStart
} from "../src/resume-studio/payments/passes.js";
import { fetchWompiTransaction, integritySignature, readWompiKeys, wompiApiBase, type FetchLike } from "../src/resume-studio/payments/wompi.js";

// AI Resume Studio R4 (offline): Wompi event signature with constant-time
// comparison (doc 08 H1), pass catalog and quota windows, the server DOCX
// (escaping, valid zip) and the Wompi API lookup with an injected fetch.
// Synthetic secrets only; no network, no database, no real money.

const SECRET = "test_events_synthetic_secret";

function signed(data: unknown, properties: string[], timestamp = 1700000000) {
  const event = { data, signature: { properties, checksum: "" }, timestamp };
  event.signature.checksum = computeWompiChecksum(event, SECRET)!;
  return event;
}

const TX = { transaction: { id: "1234-1700000000-11111", status: "APPROVED", amount_in_cents: 1490000, reference: "rs_pass_x" } };
const PROPS = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];

test("H1: a correctly signed event verifies; the expected checksum is the documented formula", () => {
  const event = signed(TX, PROPS);
  const manual = crypto.createHash("sha256").update(`1234-1700000000-11111APPROVED14900001700000000${SECRET}`).digest("hex");
  assert.equal(event.signature.checksum, manual);
  assert.equal(verifyWompiChecksum(event, SECRET), true);
});

test("H1: upper-case checksum (as Wompi documents it) still verifies", () => {
  const event = signed(TX, PROPS);
  event.signature.checksum = event.signature.checksum.toUpperCase();
  assert.equal(verifyWompiChecksum(event, SECRET), true);
});

test("H1: tampered amount, wrong secret, short/odd checksums and missing parts are rejected without throwing", () => {
  const event = signed(TX, PROPS);
  const tampered = { ...event, data: { transaction: { ...TX.transaction, amount_in_cents: 100 } } };
  assert.equal(verifyWompiChecksum(tampered, SECRET), false);
  assert.equal(verifyWompiChecksum(event, "other"), false);
  assert.equal(verifyWompiChecksum(event, undefined), false);
  for (const checksum of ["", "abc", "z".repeat(64), `${event.signature.checksum}00`, 42, null]) {
    assert.equal(verifyWompiChecksum({ ...event, signature: { ...event.signature, checksum } as never }, SECRET), false);
  }
  assert.equal(verifyWompiChecksum({ ...event, signature: { properties: [], checksum: event.signature.checksum } }, SECRET), false);
  assert.equal(verifyWompiChecksum({ ...event, signature: { properties: ["a b"], checksum: event.signature.checksum } }, SECRET), false);
  assert.equal(verifyWompiChecksum({ ...event, timestamp: undefined }, SECRET), false);
  assert.equal(verifyWompiChecksum({} as never, SECRET), false);
});

test("H1: the comparison uses crypto.timingSafeEqual", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/payments/wompi-signature.ts", import.meta.url), "utf8");
  assert.match(source, /crypto\.timingSafeEqual\(/);
  assert.doesNotMatch(source, /checksum\s*===|===\s*(given|normalized)\b/);
  const webhook = await readFile(new URL("../src/payments/webhook.ts", import.meta.url), "utf8");
  assert.doesNotMatch(webhook, /expected === payload/);
});

test("catalog: three one-time passes with the proposed prices (COP, IVA included) and quotas", () => {
  assert.deepEqual([...PASS_IDS], ["pass_7d", "pass_1m", "pass_3m"]);
  assert.equal(passAmountInCents("pass_7d"), 690000);
  assert.equal(passAmountInCents("pass_1m"), 1490000);
  assert.equal(passAmountInCents("pass_3m"), 2970000);
  assert.deepEqual(
    PASS_IDS.map((id) => [RESUME_PASSES[id].durationDays, RESUME_PASSES[id].adaptationsPerPeriod, RESUME_PASSES[id].periodDays]),
    [[7, 10, 7], [30, 30, 30], [90, 30, 30]]
  );
  assert.equal(PASS_IDS.filter((id) => RESUME_PASSES[id].recommended).join(), "pass_3m");
  for (const bad of ["pro", "pro_max", "PASS_1M", "", null, 1, "pass_1m "]) assert.equal(isPassId(bad), false);
});

test("quota windows: pass periods of 30 days inside a 90-day pass, 7-day pass is one period; free = Colombian calendar month", () => {
  const start = new Date("2026-11-01T15:00:00Z");
  const day = 86400000;
  assert.equal(passPeriodStart(start, 30, new Date(start.getTime() + 29 * day)).toISOString(), start.toISOString());
  assert.equal(passPeriodStart(start, 30, new Date(start.getTime() + 31 * day)).toISOString(), new Date(start.getTime() + 30 * day).toISOString());
  const expires = new Date(start.getTime() + 7 * day);
  assert.equal(passPeriodEnd(start, 7, new Date(start.getTime() + 2 * day), expires).toISOString(), expires.toISOString());
  // 2026-12-01 03:00 UTC is still 30 Nov in Colombia.
  assert.equal(freePeriodStart(new Date("2026-12-01T03:00:00Z")).toISOString(), "2026-11-01T05:00:00.000Z");
  assert.equal(freePeriodStart(new Date("2026-12-01T06:00:00Z")).toISOString(), "2026-12-01T05:00:00.000Z");
  assert.equal(freePeriodEnd(new Date("2026-12-31T23:00:00Z")).toISOString(), "2027-01-01T05:00:00.000Z");
});

test("keys: sandbox only until live is approved; host is fixed by the key prefix", () => {
  assert.deepEqual(readWompiKeys({}), { ok: false, problem: "missing" });
  assert.deepEqual(readWompiKeys({ WOMPI_PUBLIC_KEY: "pub_prod_x", WOMPI_INTEGRITY_SECRET: "s" }), { ok: false, problem: "live_not_allowed" });
  assert.equal(readWompiKeys({ WOMPI_PUBLIC_KEY: "pub_prod_x", WOMPI_INTEGRITY_SECRET: "s", RESUME_STUDIO_PAYMENTS_LIVE: "true" }).ok, true);
  assert.equal(readWompiKeys({ WOMPI_PUBLIC_KEY: "pub_test_x", WOMPI_INTEGRITY_SECRET: "s" }).ok, true);
  assert.equal(readWompiKeys({ WOMPI_PUBLIC_KEY: "https://evil.example", WOMPI_INTEGRITY_SECRET: "s" }).ok, false);
  assert.equal(wompiApiBase("pub_test_abc"), "https://sandbox.wompi.co/v1");
  assert.equal(wompiApiBase("pub_prod_abc"), "https://production.wompi.co/v1");
  assert.equal(
    integritySignature("ref", 690000, "COP", "sec"),
    crypto.createHash("sha256").update("ref690000COPsec").digest("hex")
  );
});

function fakeFetch(body: unknown, status = 200): FetchLike & { urls: string[] } {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  }) as unknown as FetchLike & { urls: string[] };
  f.urls = urls;
  return f;
}

test("Wompi API lookup: fixed sandbox URL, strict shape, id must match, bad ids never fetched", async () => {
  const ok = fakeFetch({ data: { id: "15-1700-99", status: "APPROVED", reference: "rs_pass_a", amount_in_cents: 690000, currency: "COP" } });
  assert.deepEqual(await fetchWompiTransaction("15-1700-99", "pub_test_k", ok), {
    id: "15-1700-99",
    status: "APPROVED",
    reference: "rs_pass_a",
    amountInCents: 690000,
    currency: "COP"
  });
  assert.deepEqual(ok.urls, ["https://sandbox.wompi.co/v1/transactions/15-1700-99"]);
  assert.equal(await fetchWompiTransaction("15-1700-99", "pub_test_k", fakeFetch({ data: { id: "other", status: "APPROVED", reference: "r", amount_in_cents: 1, currency: "COP" } })), null);
  assert.equal(await fetchWompiTransaction("15-1700-99", "pub_test_k", fakeFetch({ data: { id: "15-1700-99", status: "APPROVED", reference: "r", amount_in_cents: "1", currency: "COP" } })), null);
  assert.equal(await fetchWompiTransaction("15-1700-99", "pub_test_k", fakeFetch("not json")), null);
  assert.equal(await fetchWompiTransaction("15-1700-99", "pub_test_k", fakeFetch({}, 404)), null);
  const never = fakeFetch({});
  for (const id of ["../admin", "a/b", "x".repeat(65), "", "id?x=1"]) assert.equal(await fetchWompiTransaction(id, "pub_test_k", never), null);
  assert.equal(never.urls.length, 0);
});

function sampleFacts(): ResumeFacts {
  const facts = emptyResumeFacts();
  facts.basics.fullName = "Ana <script>alert(1)</script> & Co";
  facts.basics.headline = 'Analista "datos"';
  facts.summary = "Línea uno\nLínea dos \u0001 con control";
  facts.experience.push({
    id: "exp-1",
    source: "user",
    role: "Analista",
    company: "Empresa Sintética S.A.S.",
    city: "Bogotá",
    startDate: "2022-01",
    endDate: "",
    current: true,
    bullets: [{ id: "b-1", source: "user", text: "Automaticé reportes </w:t><w:t>inyectado" }]
  } as ResumeFacts["experience"][number]);
  facts.skills.push({ id: "s-1", source: "user", name: "SQL" } as ResumeFacts["skills"][number]);
  return facts;
}

test("DOCX: every user string is escaped; forbidden XML characters dropped", () => {
  assert.equal(xmlEscape(`<a & "b">\u0000`), "&lt;a &amp; &quot;b&quot;&gt;");
  const xml = buildResumeDocumentXml(sampleFacts(), "clasica");
  assert.ok(!xml.includes("<script>"));
  assert.ok(xml.includes("&lt;script&gt;"));
  assert.ok(xml.includes("&lt;/w:t&gt;&lt;w:t&gt;inyectado"));
  assert.ok(!xml.includes("\u0001"));
  assert.ok(xml.includes("EXPERIENCIA") && xml.includes("HABILIDADES") && xml.includes("Empresa Sintética S.A.S."));
});

test("DOCX: a valid stored zip with the Word parts, CRCs that match, deterministic", () => {
  const a = buildResumeDocx(sampleFacts(), "moderna");
  const b = buildResumeDocx(sampleFacts(), "moderna");
  assert.ok(a.equals(b));
  assert.equal(a.readUInt32LE(0), 0x04034b50);
  const endOffset = a.length - 22;
  assert.equal(a.readUInt32LE(endOffset), 0x06054b50);
  const count = a.readUInt16LE(endOffset + 10);
  let cursor = a.readUInt32LE(endOffset + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(a.readUInt32LE(cursor), 0x02014b50);
    const crc = a.readUInt32LE(cursor + 16);
    const size = a.readUInt32LE(cursor + 20);
    const nameLength = a.readUInt16LE(cursor + 28);
    const localOffset = a.readUInt32LE(cursor + 42);
    const name = a.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    names.push(name);
    const localNameLength = a.readUInt16LE(localOffset + 26);
    const data = a.subarray(localOffset + 30 + localNameLength, localOffset + 30 + localNameLength + size);
    assert.equal(crc32(data), crc, name);
    cursor += 46 + nameLength;
  }
  assert.deepEqual(names.sort(), ["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml"].sort());
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});
