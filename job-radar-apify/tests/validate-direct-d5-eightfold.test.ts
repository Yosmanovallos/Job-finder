import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setEightfoldPauseForTests } from "../src/direct/ats/eightfold.js";
import { isValidRef, listBoard, portalUrl } from "../src/direct/connectors.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import type { HttpGet } from "../src/direct/types.js";

/**
 * Eightfold connector (docs/source-catalog/eightfold.md) — offline contract
 * tests over REAL responses captured on 2026-10-20 (tests/fixtures/direct/
 * eightfold/). The researcher flattened the PCSX detail; the live endpoint
 * wraps it in `{status, error, data, metadata}` (checked 2026-10-20), so the
 * test serves it wrapped. The Bayer v2 listing was trimmed to 3 of 7: its
 * count is set to 3 where a complete listing is needed.
 */

setEightfoldPauseForTests(0);
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "direct", "eightfold");
const json = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
const robots = readFileSync(path.join(FIXTURES, "robots_bayer.eightfold.ai.txt"), "utf8");
const NOW = new Date("2026-10-20T12:00:00Z");

function fakeHttp(routes: Record<string, { status: number; body: unknown }>): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const http = (async (url: string) => {
    calls.push(url);
    const route = routes[url];
    if (!route) return { status: 404, body: "" };
    return { status: route.status, body: typeof route.body === "string" ? route.body : JSON.stringify(route.body) };
  }) as HttpGet & { calls: string[] };
  http.calls = calls;
  return http;
}

const HP = "https://hp.eightfold.ai";
const BAYER = "https://bayer.eightfold.ai";
const forbidden = { status: 403, body: { message: "PCSX is not enabled for this user." } };

test("Eightfold: refs are host@domain; robots.txt allows only the search APIs", async () => {
  assert.ok(isValidRef({ atsType: "eightfold", atsRef: "bayer.eightfold.ai@bayer.com" }));
  assert.ok(isValidRef({ atsType: "eightfold", atsRef: "apply.careers.microsoft.com@microsoft.com" }));
  assert.equal(isValidRef({ atsType: "eightfold", atsRef: "bayer.eightfold.ai" }), false);
  assert.equal(isValidRef({ atsType: "eightfold", atsRef: "10.0.0.1@bayer.com" }), false);
  assert.equal(portalUrl({ atsType: "eightfold", atsRef: "hp.eightfold.ai@hp.com" }), `${HP}/careers`);
  const banned = await listBoard({ atsType: "eightfold", atsRef: "hp.eightfold.ai@hp.com" }, fakeHttp({ [`${HP}/robots.txt`]: { status: 200, body: "User-agent: *\nDisallow: /\n" } }), {});
  assert.deepEqual(banned, { kind: "error", detail: "robots.txt no permite la API de búsqueda" });
});

test("Eightfold PCSX: alpha-2 from standardized locations, postedTs, description from the wrapped detail", async () => {
  const detail = json("hp_pcsx_position_details.json");
  const http = fakeHttp({
    [`${HP}/robots.txt`]: { status: 200, body: robots },
    [`${HP}/api/pcsx/search?domain=hp.com&location=Colombia&start=0`]: { status: 200, body: json("hp_pcsx_search_location_Colombia.json") },
    [`${HP}/api/pcsx/position_details?position_id=44947450&domain=hp.com&hl=en`]: { status: 200, body: { status: 200, error: null, data: detail, metadata: null } }
  });
  const listing = await listBoard({ atsType: "eightfold", atsRef: "hp.eightfold.ai@hp.com" }, http, { knownIds: new Set(["43709338"]), detailBudget: 5 });
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.equal(listing.boardTotal, 2);
  const fresh = listing.postings.find((posting) => posting.externalId === "44947450")!;
  assert.deepEqual(fresh.countryCodes, ["CO"]);
  assert.equal(fresh.publishedAt, "2026-10-15T00:00:00.000Z");
  assert.equal(fresh.workplace, "onsite");
  assert.equal(fresh.applyUrl, `${HP}/careers/job/44947450`);
  assert.match(fresh.descriptionText ?? "", /^Customer Operations Specialist/);
  assert.equal(fresh.partial, false);
  assert.equal(http.calls.filter((url) => url.includes("position_details")).length, 1, "the known posting needs no detail");
  const { postings } = selectColombianPostings(listing.postings, NOW);
  assert.equal(postings.length, 2);
  assert.ok(postings.every((posting) => posting.city === "Bogotá"));
});

test("Eightfold v2: a 403 on PCSX falls back to v2; the company's canonical URL is the apply link", async () => {
  const page = json("bayer_v2_jobs_location_Colombia.json");
  page.count = page.positions.length;
  const http = fakeHttp({
    [`${BAYER}/robots.txt`]: { status: 200, body: robots },
    [`${BAYER}/api/pcsx/search?domain=bayer.com&location=Colombia&start=0`]: forbidden,
    [`${BAYER}/api/apply/v2/jobs?domain=bayer.com&location=Colombia&start=0`]: { status: 200, body: page }
  });
  const listing = await listBoard({ atsType: "eightfold", atsRef: "bayer.eightfold.ai@bayer.com" }, http, { detailBudget: 0 });
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  const first = listing.postings.find((posting) => posting.externalId === "562949978748368")!;
  assert.equal(first.applyUrl, "https://talent.bayer.com/careers/job/562949978748368");
  assert.equal(first.publishedAt, "2026-10-15T00:00:00.000Z", "t_create, epoch seconds");
  assert.ok(first.descriptionText, "the v2 list sometimes carries the description");
  const { postings } = selectColombianPostings(listing.postings, NOW);
  assert.ok(postings.every((posting) => posting.locationRaw.includes("Colombia")));
});

test("Eightfold: a short read, a 429 or 403 on both modes is never complete", async () => {
  const short = await listBoard(
    { atsType: "eightfold", atsRef: "bayer.eightfold.ai@bayer.com" },
    fakeHttp({
      [`${BAYER}/robots.txt`]: { status: 200, body: robots },
      [`${BAYER}/api/pcsx/search?domain=bayer.com&location=Colombia&start=0`]: forbidden,
      [`${BAYER}/api/apply/v2/jobs?domain=bayer.com&location=Colombia&start=0`]: { status: 200, body: json("bayer_v2_jobs_location_Colombia.json") }
    }),
    {}
  );
  assert.equal(short.kind, "error", "count 7, 3 positions, next page missing");
  const throttled = await listBoard(
    { atsType: "eightfold", atsRef: "hp.eightfold.ai@hp.com" },
    fakeHttp({ [`${HP}/robots.txt`]: { status: 200, body: robots }, [`${HP}/api/pcsx/search?domain=hp.com&location=Colombia&start=0`]: { status: 429, body: "Please try again later" } }),
    {}
  );
  assert.deepEqual(throttled, { kind: "error", detail: "HTTP 429 en la página 1" });
  const both = await listBoard(
    { atsType: "eightfold", atsRef: "hp.eightfold.ai@hp.com" },
    fakeHttp({
      [`${HP}/robots.txt`]: { status: 200, body: robots },
      [`${HP}/api/pcsx/search?domain=hp.com&location=Colombia&start=0`]: forbidden,
      [`${HP}/api/apply/v2/jobs?domain=hp.com&location=Colombia&start=0`]: forbidden
    }),
    {}
  );
  assert.deepEqual(both, { kind: "error", detail: "Eightfold respondió 403 en ambos modos" });
});
