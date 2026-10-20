import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  countryFromLocation,
  parseJavaDate,
  parseListingDate,
  parsePostingPage,
  parseSearchPage
} from "../src/direct/ats/successfactors.js";
import { SITE_REF } from "../src/direct/ats/site.js";
import { isValidRef, listBoard, portalUrl } from "../src/direct/connectors.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import type { HttpGet, HttpRequestInit } from "../src/direct/types.js";

/**
 * Phase D5 connectors (docs/adr/0006-direct-employers.md §5) — offline
 * contract tests over REAL responses captured by source-researcher on
 * 2026-10-20 and trimmed (tests/fixtures/direct/<ats>/). Where a fixture was
 * trimmed to a few rows, the pagination label is rewritten in the test to the
 * trimmed count so the listing is self-consistent; the untouched label is
 * used to prove that a short read is never "complete".
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "direct");
const fixture = (ats: string, name: string) => readFileSync(path.join(FIXTURES, ats, name), "utf8");
const NOW = new Date("2026-10-20T12:00:00Z");

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

// ---------- SuccessFactors ----------

const SF = "successfactors";
const BCO = "https://empleo.grupobancolombia.com";
const bcoSearch = (start: number) => `${BCO}/bancolombia/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=${start}`;
const relabel = (html: string, from: number, to: number, total: number) =>
  html.replace(/Resultados <b>[^<]*<\/b> de <b>\d+<\/b>/, `Resultados <b>${from} – ${to}</b> de <b>${total}</b>`);

test("SuccessFactors: refs are a public host plus at most one site segment", () => {
  assert.ok(SITE_REF.test("empleo.grupobancolombia.com/bancolombia"));
  assert.ok(SITE_REF.test("jobs.avianca.com"));
  assert.equal(SITE_REF.test("10.0.0.1"), false, "IP literal");
  assert.equal(SITE_REF.test("localhost"), false, "no dot");
  assert.equal(SITE_REF.test("host.com:8080"), false, "port");
  assert.equal(SITE_REF.test("host.com/a/b"), false, "two segments");
  assert.equal(SITE_REF.test("host.com/../x"), false);
  assert.ok(isValidRef({ atsType: "successfactors", atsRef: "careers.ey.com/ey" }));
  assert.equal(portalUrl({ atsType: "successfactors", atsRef: "jobs.avianca.com" }), "https://jobs.avianca.com/");
});

test("SuccessFactors: dates as the site writes them (Spanish months, Java toString)", () => {
  assert.equal(parseListingDate("20 oct 2026 "), "2026-10-20T00:00:00.000Z");
  assert.equal(parseListingDate("24 sept 2026"), "2026-09-24T00:00:00.000Z");
  assert.equal(parseListingDate("Oct 3, 2026"), "2026-10-03T00:00:00.000Z");
  assert.equal(parseListingDate("31 feb 2026"), null);
  assert.equal(parseListingDate("ayer"), null);
  assert.equal(parseJavaDate("Fri Oct 16 00:00:00 UTC 2026"), "2026-10-16T00:00:00.000Z");
  assert.equal(parseJavaDate("Wed Sep 30 02:01:00 UTC 2026"), "2026-09-30T02:01:00.000Z");
  assert.equal(parseJavaDate("2026-10-16"), null);
});

test("SuccessFactors: country is the last two-letter token, never assumed", () => {
  assert.equal(countryFromLocation("COL, CO"), "CO");
  assert.equal(countryFromLocation("Bogotá D.C., Bogotá D.C., CO, 110111"), "CO");
  assert.equal(countryFromLocation("Fort Lauderdale, US"), "US");
  assert.equal(countryFromLocation("Etipani"), null);
});

test("SuccessFactors: search page rows and label from the real listing", () => {
  const page = parseSearchPage(fixture(SF, "bancolombia-search-page1.trimmed.html"));
  assert.ok(page);
  assert.deepEqual([page.from, page.to, page.total], [1, 25, 43]);
  assert.equal(page.rows.length, 4);
  assert.deepEqual(page.rows[0], {
    id: "1441844000",
    href: "/bancolombia/job/Etipani-Analiticoa-%28Nivel-2-Semi-Senior%29-L%C3%ADnea-De-Conocimiento-Anal%C3%ADtica-De-Negocio-Personas-COL/1441844000/",
    title: "Analitico/a (Nivel 2-Semi Senior) Línea De Conocimiento Analítica De Negocio Personas",
    location: "COL, CO",
    date: "20 oct 2026",
    department: "Administrativa"
  });
  const ey = parseSearchPage(fixture(SF, "ey-search-colombia.trimmed.html"));
  assert.equal(ey?.total, 70, "English label");
  assert.equal(ey?.rows[2].location, "Cali, VAC, CO", "the '+3 more' marker is dropped");
  assert.equal(ey?.rows[0].date, null, "EY lists no date");
  assert.equal(parseSearchPage('<tr class="data-row"><td>no link</td></tr>'), null, "a row without its link is a format change");
});

test("SuccessFactors: posting microdata — classic and new templates", () => {
  const classic = parsePostingPage(fixture(SF, "bancolombia-job-1438237700.trimmed.html"));
  assert.equal(classic?.publishedAt, "2026-10-08T00:00:00.000Z");
  assert.equal(classic?.validThrough, "2026-10-31T05:00:00.000Z");
  assert.equal(classic?.country, "CO");
  const avianca = parsePostingPage(fixture(SF, "avianca-job-1432740833.trimmed.html"));
  assert.equal(avianca?.country, "CO", "streetAddress 'Pasto, CO' when addressCountry is absent");
  assert.equal(avianca?.publishedAt, "2026-09-30T02:01:00.000Z");
  const guatemala = parsePostingPage(fixture(SF, "bam-job-1438439000-GT.trimmed.html"));
  assert.equal(guatemala?.country, "GT");
  const old = parsePostingPage(fixture(SF, "bancolombia-job-1346872500-old-id.trimmed.html"));
  assert.equal(old?.validThrough, null, "absent, not invented");
  assert.equal(parsePostingPage("<html>login</html>"), null);
});

function bancolombiaHttp(options: { trimmedLabel?: boolean; robots?: { status: number; body: string } } = {}) {
  const page1 = fixture(SF, "bancolombia-search-page1.trimmed.html");
  const page2 = fixture(SF, "bancolombia-search-page2.trimmed.html");
  const rows1 = parseSearchPage(page1)!.rows.length;
  const rows2 = parseSearchPage(page2)!.rows.length;
  const total = rows1 + rows2;
  const detail = fixture(SF, "bancolombia-job-1438237700.full.html");
  const routes: Record<string, Route> = {
    [`${BCO}/robots.txt`]: options.robots ?? { status: 200, body: fixture(SF, "robots.bancolombia.txt") },
    [bcoSearch(0)]: { status: 200, body: options.trimmedLabel ? page1 : relabel(page1, 1, rows1, total) },
    [bcoSearch(rows1)]: { status: 200, body: relabel(page2, rows1 + 1, total, total) }
  };
  for (const row of [...parseSearchPage(page1)!.rows, ...parseSearchPage(page2)!.rows]) {
    routes[`${BCO}${row.href}`] = { status: 200, body: detail };
  }
  return { http: fakeHttp(routes), total };
}

test("SuccessFactors: complete listing; details only for new postings, within budget", async () => {
  const { http, total } = bancolombiaHttp();
  const listing = await listBoard({ atsType: SF, atsRef: "empleo.grupobancolombia.com/bancolombia" }, http, {
    knownIds: new Set(["1441844000"]),
    detailBudget: 2
  });
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.equal(listing.boardTotal, total);
  assert.equal(listing.postings.length, 3, "1 known + 2 within budget");
  assert.equal(listing.deferred, total - 3);
  const known = listing.postings.find((posting) => posting.externalId === "1441844000")!;
  assert.equal(known.partial, true);
  assert.equal(known.descriptionText, null);
  assert.equal(known.publishedAt, "2026-10-20T00:00:00.000Z", "listing date");
  const fetched = listing.postings.filter((posting) => !posting.partial);
  assert.equal(fetched.length, 2);
  assert.ok(fetched.every((posting) => posting.descriptionText?.length && posting.applyUrl.startsWith(`${BCO}/bancolombia/job/`)));
  assert.equal(http.calls.filter((url) => url.includes("/job/")).length, 2, "never more pages than the budget");
  const { postings, stats } = selectColombianPostings(listing.postings, NOW);
  assert.equal(stats.colombia, 3);
  assert.equal(postings.length, 3);
});

test("SuccessFactors: a short read, a robots ban or an unreachable robots.txt is never complete", async () => {
  const short = await listBoard({ atsType: SF, atsRef: "empleo.grupobancolombia.com/bancolombia" }, bancolombiaHttp({ trimmedLabel: true }).http, {});
  assert.equal(short.kind, "error", "label says 43 but fewer rows were read");
  const banned = await listBoard(
    { atsType: SF, atsRef: "empleo.grupobancolombia.com/bancolombia" },
    bancolombiaHttp({ robots: { status: 200, body: "User-agent: *\nDisallow: /bancolombia/search/" } }).http,
    {}
  );
  assert.deepEqual(banned, { kind: "error", detail: "robots.txt no permite /search/" });
  const down = await listBoard({ atsType: SF, atsRef: "empleo.grupobancolombia.com/bancolombia" }, bancolombiaHttp({ robots: { status: 503, body: "" } }).http, {});
  assert.equal(down.kind, "error", "5xx robots.txt = nothing allowed (RFC 9309)");
  const redirect = await listBoard(
    { atsType: SF, atsRef: "empleo.grupobancolombia.com/bancolombia" },
    fakeHttp({ [`${BCO}/robots.txt`]: { status: 404, body: "" }, [bcoSearch(0)]: { status: 302, body: "" } }),
    {}
  );
  assert.deepEqual(redirect, { kind: "error", detail: "HTTP 302 en la página 1" });
});

test("SuccessFactors: foreign rows get no page request and are filtered out", async () => {
  const AV = "https://jobs.avianca.com";
  const page = fixture(SF, "avianca-search-page2.trimmed.html");
  const rows = parseSearchPage(page)!.rows;
  const http = fakeHttp({
    [`${AV}/robots.txt`]: { status: 200, body: fixture(SF, "robots.bancolombia.txt") },
    [`${AV}/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=0`]: { status: 200, body: relabel(page, 1, rows.length, rows.length) }
  });
  const listing = await listBoard({ atsType: SF, atsRef: "jobs.avianca.com" }, http, { knownIds: new Set(rows.map((row) => row.id)) });
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  const { postings, stats } = selectColombianPostings(listing.postings, NOW);
  assert.equal(stats.notColombia, 1, "Fort Lauderdale, US");
  assert.deepEqual(postings.map((posting) => posting.city).sort(), ["Armenia", "Pereira", "San Andrés"]);
  assert.equal(http.calls.some((url) => url.includes("/job/")), false);
});

test("SuccessFactors: the real posting block yields the description as text", () => {
  const detail = parsePostingPage(fixture(SF, "bancolombia-job-1438237700.full.html"));
  assert.match(detail?.descriptionText ?? "", /^📍 Convocatoria abierta para Cali\.\n\nEn Bancolombia promovemos/);
  assert.equal(detail?.descriptionText?.includes("\r"), false);
  assert.ok((detail?.descriptionText?.length ?? 0) > 1000);
});
