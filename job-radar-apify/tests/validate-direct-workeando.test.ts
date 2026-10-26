import assert from "node:assert/strict";
import test from "node:test";
import { isValidRef, listBoard, portalUrl } from "../src/direct/connectors.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import type { HttpGet, HttpResponse } from "../src/direct/types.js";

const origin = "https://workeando.com";
const ref = { atsType: "workeando" as const, atsRef: "nexa-bpo" };
const url = (type: "ofertas" | "ciudad", page: number) => `${origin}/wp-json/wp/v2/${type}?per_page=100&page=${page}`;
const offer = (id: number, date = "2026-10-20T21:56:30") => ({
  id, date_gmt: date, modified_gmt: "2026-10-25T21:56:30", status: "publish", type: "ofertas",
  link: `${origin}/ofertas/puesto-${id}/`, title: { rendered: `Puesto ${id}` },
  content: { rendered: "<p>Trabaja con NEXA.</p>" }, ciudad: [12]
});
const city = { id: 12, name: "MEDELLÍN" };

function response(rows: unknown[], total = rows.length, pages = Math.max(1, Math.ceil(total / 100))): HttpResponse {
  return { status: 200, body: JSON.stringify(rows), headers: { "x-wp-total": String(total), "x-wp-totalpages": String(pages) } };
}
function fakeHttp(entries: Record<string, HttpResponse | string>): HttpGet {
  return async (requested) => {
    const entry = entries[requested];
    return typeof entry === "string" ? { status: 200, body: entry } : entry ?? { status: 404, body: "" };
  };
}
const robots = { [`${origin}/robots.txt`]: "User-agent: *\nDisallow: /wp-admin/" };
const valid = (rows: unknown[] = [offer(1)]) => fakeHttp({
  ...robots, [url("ofertas", 1)]: response(rows), [url("ciudad", 1)]: response([city])
});

test("Workeando: reference, full listing, source date and Colombia freshness", async () => {
  assert.equal(isValidRef(ref), true);
  assert.equal(isValidRef({ ...ref, atsRef: "../other" }), false);
  assert.equal(portalUrl(ref), `${origin}/ofertas/`);
  const listing = await listBoard(ref, valid([offer(1), offer(2, "2026-08-01T00:00:00")]));
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.equal(listing.boardTotal, 2);
  assert.equal(listing.postings[0].publishedAt, "2026-10-20T21:56:30.000Z");
  assert.deepEqual(listing.postings[0].locationTexts, ["MEDELLÍN"]);
  assert.deepEqual(listing.postings[0].countryCodes, []);
  assert.equal(selectColombianPostings(listing.postings, new Date("2026-10-25T00:00:00Z")).postings.length, 1);
});

test("Workeando: complete pagination and stable WordPress totals", async () => {
  const first = Array.from({ length: 100 }, (_, index) => offer(index + 1));
  const listing = await listBoard(ref, fakeHttp({
    ...robots,
    [url("ofertas", 1)]: response(first, 101, 2),
    [url("ofertas", 2)]: response([offer(101)], 101, 2),
    [url("ciudad", 1)]: response([city])
  }));
  assert.equal(listing.kind, "complete");
  if (listing.kind === "complete") assert.equal(listing.postings.length, 101);
  for (const second of [response([offer(101)], 102, 2), { status: 404, body: "" }]) {
    const broken = await listBoard(ref, fakeHttp({ ...robots,
      [url("ofertas", 1)]: response(first, 101, 2), [url("ofertas", 2)]: second
    }));
    assert.equal(broken.kind, "error");
  }
});

test("Workeando: unsafe or incomplete source data never authorizes closures", async () => {
  const cases = [
    [{ ...offer(1), link: "https://other.example/ofertas/puesto-1/" }],
    [{ ...offer(1), ciudad: [999] }],
    [offer(1, "2026-02-30T00:00:00")],
    [{ ...offer(1), status: "draft" }],
    [offer(1), offer(1)]
  ];
  for (const rows of cases) assert.equal((await listBoard(ref, valid(rows))).kind, "error");
  assert.equal((await listBoard(ref, fakeHttp({
    [`${origin}/robots.txt`]: "User-agent: *\nDisallow: /wp-json/"
  }))).kind, "error");
  assert.equal((await listBoard(ref, fakeHttp({ ...robots,
    [url("ofertas", 1)]: { status: 200, body: JSON.stringify([offer(1)]) }
  }))).kind, "error");
});

test("Workeando: an unbranded offer is not attributed to NEXA", async () => {
  const unrelated = { ...offer(2), link: `${origin}/ofertas/__trashed/`, content: { rendered: "<p>Otro empleador.</p>" } };
  const listing = await listBoard(ref, valid([offer(1), unrelated]));
  assert.equal(listing.kind, "complete");
  if (listing.kind === "complete") {
    assert.equal(listing.boardTotal, 2);
    assert.deepEqual(listing.postings.map((row) => row.externalId), ["1"]);
  }
  const changed = await listBoard(ref, valid([unrelated]), { knownIds: new Set(["2"]) });
  assert.equal(changed.kind, "error");
});
