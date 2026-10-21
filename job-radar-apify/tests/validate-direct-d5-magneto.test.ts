import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { flightStream, objectAfter, parseCompanyPage } from "../src/direct/ats/magneto.js";
import { isValidRef, listBoard, portalUrl } from "../src/direct/connectors.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import type { HttpGet } from "../src/direct/types.js";

/**
 * Magneto as a company's official portal (owner decision 2026-10-20,
 * docs/source-catalog/magneto-official.md) — offline contract tests over
 * REAL company pages captured on 2026-10-20 (tests/fixtures/direct/magneto/).
 * The researcher's trimmed Claro page dropped the facet counters; the test
 * puts back the company_show_slug facet exactly as the live page showed it
 * the same day (`{"field":"company_show_slug","counts":[{"id":"claro-colombia","total":9}]}`).
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "direct", "magneto");
const raw = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");
const NOW = new Date("2026-10-20T18:00:00Z");
const ORIGIN = "https://www.magneto365.com";
const CLARO_FACET = '\\"counters\\":[{\\"field\\":\\"company_show_slug\\",\\"counts\\":[{\\"id\\":\\"claro-colombia\\",\\"total\\":9}]}]';
const claroPage = () => raw("listing-claro-colombia-complete.html").replace('\\"counters\\":[]', CLARO_FACET);

function fakeHttp(routes: Record<string, { status: number; body: string }>): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const http = (async (url: string) => {
    calls.push(url);
    return routes[url] ?? { status: 404, body: "" };
  }) as HttpGet & { calls: string[] };
  http.calls = calls;
  return http;
}

test("Magneto: refs are a company slug; the portal is the company's job page", () => {
  assert.ok(isValidRef({ atsType: "magneto", atsRef: "claro-colombia" }));
  assert.equal(isValidRef({ atsType: "magneto", atsRef: "../x" }), false);
  assert.equal(isValidRef({ atsType: "magneto", atsRef: "Claro" }), false);
  assert.equal(portalUrl({ atsType: "magneto", atsRef: "vanti" }), `${ORIGIN}/co/empresas/vanti/empleos`);
});

test("Magneto: the flight data is read with strings respected", () => {
  const stream = flightStream(claroPage());
  const search = objectAfter(stream, "searchResponse") as { totalRows: number; rows: unknown[] };
  assert.equal(search.totalRows, 9);
  assert.equal(search.rows.length, 9);
  assert.deepEqual(objectAfter('{"a":{"b":"}{\\"]","c":[1,{"d":2}]}}', "a"), { b: '}{"]', c: [1, { d: 2 }] });
});

test("Magneto: complete only when rows, totalRows, totalHits, the company facet and the ItemList all agree", () => {
  const claro = parseCompanyPage(claroPage(), "claro-colombia");
  assert.ok(!("error" in claro) && claro.total === 9);
  assert.match((parseCompanyPage(raw("listing-claro-colombia-complete.html"), "claro-colombia") as { error: string }).error, /faceta —/, "no facet, no proof");
  assert.match((parseCompanyPage(raw("listing-vanti-incomplete.html"), "vanti") as { error: string }).error, /^listado incompleto/);
  assert.match((parseCompanyPage(raw("listing-grupo-exito-incomplete.html"), "grupo-exito") as { error: string }).error, /^listado incompleto/);
  assert.deepEqual(parseCompanyPage(claroPage(), "vanti"), { error: "la página no está filtrada por esta empresa" });
  assert.deepEqual(parseCompanyPage("<html></html>", "claro-colombia"), { error: "no se halló searchResponse en la página" });
});

test("Magneto: postings carry the declared dates, cities and country id; robots forbids query URLs", async () => {
  const robots = raw("robots.magneto365.com.txt");
  const http = fakeHttp({
    [`${ORIGIN}/robots.txt`]: { status: 200, body: robots },
    [`${ORIGIN}/co/empresas/claro-colombia/empleos`]: { status: 200, body: claroPage() }
  });
  const listing = await listBoard({ atsType: "magneto", atsRef: "claro-colombia" }, http, { detailBudget: 0 });
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.equal(listing.deferred, 9, "no budget: all new postings wait");
  const known = await listBoard({ atsType: "magneto", atsRef: "claro-colombia" }, http, {
    knownIds: new Set(["1106351", "1096080", "1092514", "1091983", "1091841", "1089731", "1089502", "1088647", "1065946"])
  });
  assert.ok(known.kind === "complete");
  if (known.kind !== "complete") return;
  const first = known.postings.find((posting) => posting.externalId === "1106351")!;
  assert.equal(first.publishedAt, "2026-10-20T15:09:56.749Z");
  assert.equal(first.validThrough, "2026-10-31T05:00:00.000Z");
  assert.deepEqual(first.countryCodes, ["CO"]);
  assert.equal(first.workplace, null, "isRemote:false is not on-site");
  assert.equal(first.applyUrl, `${ORIGIN}/co/empresas/claro-colombia/empleos/consultor-a-comercial-contenido-1106351`);
  const { postings } = selectColombianPostings(known.postings, NOW);
  assert.equal(postings.find((posting) => posting.externalId === "1106351")?.city, "Bogotá");
  const vanti = await listBoard(
    { atsType: "magneto", atsRef: "vanti" },
    fakeHttp({ [`${ORIGIN}/robots.txt`]: { status: 200, body: robots }, [`${ORIGIN}/co/empresas/vanti/empleos`]: { status: 200, body: raw("listing-vanti-incomplete.html") } }),
    {}
  );
  assert.equal(vanti.kind, "error", "Vanti lists 20 of 25: nothing stored, nothing closed");
  const missing = await listBoard({ atsType: "magneto", atsRef: "no-existe" }, fakeHttp({ [`${ORIGIN}/robots.txt`]: { status: 200, body: robots }, [`${ORIGIN}/co/empresas/no-existe/empleos`]: { status: 500, body: "" } }), {});
  assert.deepEqual(missing, { kind: "error", detail: "HTTP 500" }, "a 500 is never 'not found'");
});
