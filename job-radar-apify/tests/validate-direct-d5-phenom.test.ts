import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { phenomDate, phenomDescription, phenomSiteParams } from "../src/direct/ats/phenom.js";
import { isValidRef, listBoard, portalUrl } from "../src/direct/connectors.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import type { HttpGet, HttpRequestInit } from "../src/direct/types.js";

/**
 * Phenom connector (docs/source-catalog/phenom.md) — offline contract tests
 * over REAL responses captured on 2026-10-20 (tests/fixtures/direct/phenom/).
 * The widget responses were trimmed to 3 jobs by the researcher; the test
 * sets totalHits to the trimmed count where a complete listing is needed and
 * keeps the real 106 to prove a short read is never complete.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "direct", "phenom");
const raw = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");
const NOW = new Date("2026-10-20T12:00:00Z");
const DHL = "https://careers.dhl.com";

type Route = { status: number; body: string } | ((init?: HttpRequestInit) => { status: number; body: string });
function fakeHttp(routes: Record<string, Route>): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const http = (async (url: string, init?: HttpRequestInit) => {
    calls.push(init?.json !== undefined ? `POST ${url} ${JSON.stringify(init.json)}` : url);
    const route = routes[url];
    if (!route) return { status: 404, body: "" };
    return typeof route === "function" ? route(init) : route;
  }) as HttpGet & { calls: string[] };
  http.calls = calls;
  return http;
}

function dhlHttp(options: { totalHits?: number; robots?: string } = {}) {
  const widgets = JSON.parse(raw("dhl_widgets_refineSearch_colombia.json"));
  widgets.refineSearch.totalHits = options.totalHits ?? widgets.refineSearch.data.jobs.length;
  const jsonLd = `<html><script type="application/ld+json">${raw("dhl_job_jsonld.json")}</script></html>`;
  const routes: Record<string, Route> = {
    [`${DHL}/robots.txt`]: { status: 200, body: options.robots ?? raw("robots_careers.dhl.com.txt") },
    [`${DHL}/amer/es/search-results`]: { status: 200, body: raw("dhl_search_results_params.html") },
    [`${DHL}/widgets`]: (init) =>
      (init?.json as { from: number }).from === 0
        ? { status: 200, body: JSON.stringify(widgets) }
        : { status: 200, body: JSON.stringify({ refineSearch: { ...widgets.refineSearch, data: { jobs: [] } } }) }
  };
  for (const job of widgets.refineSearch.data.jobs) routes[`${DHL}/amer/es/job/${job.jobSeqNo}/x`] = { status: 200, body: jsonLd };
  return fakeHttp(new Proxy(routes, { get: (target, key: string) => target[key] ?? (key.includes("/job/") ? { status: 200, body: jsonLd } : undefined) }));
}

test("Phenom: refs carry the locale path; site parameters come from the page, never another origin", () => {
  assert.ok(isValidRef({ atsType: "phenom", atsRef: "careers.dhl.com/amer/es" }));
  assert.ok(isValidRef({ atsType: "phenom", atsRef: "www.pgcareers.com/latam/en" }));
  assert.equal(isValidRef({ atsType: "phenom", atsRef: "careers.dhl.com" }), false, "the locale path is required");
  assert.equal(isValidRef({ atsType: "phenom", atsRef: "10.0.0.1/amer/es" }), false);
  assert.equal(portalUrl({ atsType: "phenom", atsRef: "careers.dhl.com/amer/es" }), `${DHL}/amer/es/search-results`);
  assert.deepEqual(phenomSiteParams(raw("dhl_search_results_params.html"), DHL), {
    endpoint: `${DHL}/widgets`,
    country: "amer",
    locale: "es_amer",
    pageId: "page17-ds"
  });
  assert.equal(phenomSiteParams(raw("dhl_search_results_params.html"), "https://other.example"), null, "endpoint on another origin");
  assert.equal(phenomDate("2026-06-25T16:06:48.533+0000"), "2026-06-25T16:06:48.533Z");
  assert.match(phenomDescription(`<script type="application/ld+json">${raw("dhl_job_jsonld.json")}</script>`) ?? "", /\S/);
});

test("Phenom: complete listing through the site's Colombia facet; a foreign primary country with a Colombian location counts", async () => {
  const http = dhlHttp();
  const listing = await listBoard({ atsType: "phenom", atsRef: "careers.dhl.com/amer/es" }, http, { detailBudget: 5 });
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.ok(http.calls.some((call) => call.includes('"selected_fields":{"country":["Colombia"]}') && call.includes('"lang":"es_amer"') && call.includes('"pageId":"page17-ds"')));
  const { postings, stats } = selectColombianPostings(listing.postings, NOW);
  assert.equal(stats.colombia, 3, "the Chile-primary posting lists Bogotá");
  assert.equal(stats.stale, 2, "postedDate 2026-06-25 and 2026-09-10 are past 30 days");
  assert.equal(postings.length, 1);
  assert.ok(postings.every((posting) => posting.applyUrl.startsWith(`${DHL}/amer/es/job/`)));
  assert.ok(postings.every((posting) => posting.descriptionText), "description from the posting's JSON-LD");
  const inSeptember = selectColombianPostings(listing.postings, new Date("2026-09-20T00:00:00Z")).postings;
  const chile = inSeptember.find((posting) => posting.externalId === "DPDHGLOBALAV365967ENGLOBALEXTERNAL");
  assert.equal(chile?.city, "Bogotá", "city from the Colombian segment, not the primary (Santiago)");
});

test("Phenom: a short read, a robots ban or a page without parameters is never complete", async () => {
  const short = await listBoard({ atsType: "phenom", atsRef: "careers.dhl.com/amer/es" }, dhlHttp({ totalHits: 106 }), {});
  assert.deepEqual(short, { kind: "error", detail: "se leyeron 3 de 106 vacantes: listado incompleto" });
  const banned = await listBoard({ atsType: "phenom", atsRef: "careers.dhl.com/amer/es" }, dhlHttp({ robots: "User-agent: *\nDisallow: /widgets\n" }), {});
  assert.deepEqual(banned, { kind: "error", detail: "robots.txt no permite /widgets" });
  const noParams = await listBoard(
    { atsType: "phenom", atsRef: "careers.dhl.com/amer/es" },
    fakeHttp({ [`${DHL}/robots.txt`]: { status: 404, body: "" }, [`${DHL}/amer/es/search-results`]: { status: 200, body: "<html>redesign</html>" } }),
    {}
  );
  assert.deepEqual(noParams, { kind: "error", detail: "no se hallaron los parámetros del sitio Phenom" });
});

test("Phenom: known postings need no page; the budget defers the rest", async () => {
  const http = dhlHttp();
  const listing = await listBoard({ atsType: "phenom", atsRef: "careers.dhl.com/amer/es" }, http, {
    knownIds: new Set(["DPDHGLOBALAV360676ENGLOBALEXTERNAL"]),
    detailBudget: 1
  });
  assert.ok(listing.kind === "complete" && listing.postings.length === 2 && listing.deferred === 1);
  assert.equal(http.calls.filter((call) => call.includes("/job/")).length, 1);
});
