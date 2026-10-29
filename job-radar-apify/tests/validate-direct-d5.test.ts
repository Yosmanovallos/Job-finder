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

test("SuccessFactors: tile listing counts jobs and rejects an unknown tile format", () => {
  const tile = `<span id="tile-search-results-label">Showing 1 to 1 of 1 Jobs</span>
    <ul id="job-tile-list"><li class="job-tile job-id-1375290357" data-url="/Holcim_abs/job/Medellin-Analista/1375290357/">
    <a class="jobTitle-link fontcolor" href="/Holcim_abs/job/Medellin-Analista/1375290357/">ANALISTA DE COBRO</a>
    <div id="job-1375290357-desktop-section-department-value">Finanzas</div>
    <div id="job-1375290357-desktop-section-multilocation-value">Medellín, Antioquía, CO, 050010</div></li></ul>`;
  const parsed = parseSearchPage(tile);
  assert.deepEqual([parsed?.from, parsed?.to, parsed?.total], [1, 1, 1]);
  assert.deepEqual(parsed?.rows[0], {
    id: "1375290357", href: "/Holcim_abs/job/Medellin-Analista/1375290357/", title: "ANALISTA DE COBRO",
    location: "Medellín, Antioquía, CO, 050010", date: null, department: "Finanzas"
  });
  assert.equal(parseSearchPage(tile.replace("jobTitle-link", "unknown-link")), null);
  assert.equal(parseSearchPage(tile.replace('href="/Holcim_abs/job/Medellin-Analista/1375290357/"', 'href="/Holcim_abs/job/Other/1375290357/"')), null);
  assert.equal(parseSearchPage(tile.replace("Showing 1 to 1 of 1 Jobs", "unrecognized total")), null);
  assert.equal(parseSearchPage('<a class="jobTitle-link" href="/job/foo/1234/">Foo</a>'), null, "a new layout cannot close a board");
  assert.deepEqual(parseSearchPage('<span id="tile-search-results-label">Showing 0 to 0 of 0 Jobs</span><ul id="job-tile-list"></ul>'), { from: 0, to: 0, total: 0, rows: [] });
});

/** Tile page whose label prints the row count where the last row belongs, as careers.mota-engil.com does (2026-10-29). */
function countLabelTiles(from: number, ids: string[], total: number, label = `Showing ${from} to ${ids.length} of ${total} Jobs`): string {
  const tiles = ids
    .map((id) => `<li class="job-tile job-id-${id}" data-url="/job/Cartagena-Obra/${id}/">
      <a class="jobTitle-link fontcolor" href="/job/Cartagena-Obra/${id}/">Ingeniero ${id}</a>
      <div id="job-${id}-desktop-section-location-value">Cartagena, CO</div></li>`)
    .join("");
  return `<span id="tile-search-results-label">${label}</span><ul id="job-tile-list">${tiles}</ul>`;
}

test("SuccessFactors: a tile label with the page's row count instead of the last row", async () => {
  const page2 = parseSearchPage(countLabelTiles(3, ["1449122633", "1449131133"], 5));
  assert.deepEqual([page2?.from, page2?.to, page2?.total], [3, 4, 5], "'Showing 3 to 2 of 5' = rows 3–4");
  assert.deepEqual([parseSearchPage(countLabelTiles(1, ["11111", "22222"], 5))?.to], [2], "page 1 reads the same either way");
  assert.equal(parseSearchPage(countLabelTiles(3, ["1449122633"], 5, "Showing 3 to 2 of 5 Jobs")), null, "neither reading matches 1 tile");
  assert.equal(parseSearchPage(countLabelTiles(5, ["11111", "22222"], 5, "Showing 5 to 2 of 5 Jobs")), null, "rows past the total");

  const MOTA = "https://careers.mota-engil.com";
  const search = (start: number) => `${MOTA}/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=${start}`;
  const http = fakeHttp({
    [`${MOTA}/robots.txt`]: { status: 404, body: "" },
    [search(0)]: { status: 200, body: countLabelTiles(1, ["10001", "10002"], 5) },
    [search(2)]: { status: 200, body: countLabelTiles(3, ["10003", "10004"], 5) },
    [search(4)]: { status: 200, body: countLabelTiles(5, ["10005"], 5) }
  });
  const listing = await listBoard({ atsType: SF, atsRef: "careers.mota-engil.com" }, http, {});
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.equal(listing.boardTotal, 5);
  assert.equal(listing.deferred, 5, "every row read; no detail budget");
  assert.deepEqual(http.calls.filter((url) => url.includes("/search/")), [search(0), search(2), search(4)], "next page starts after the last row");
});

test("SuccessFactors: tiles without any location are read through the site's Colombia search", async () => {
  const MOTA = "https://careers.mota-engil.com";
  const search = (start: number, colombia = false) =>
    `${MOTA}/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=${start}${colombia ? "&locationsearch=Colombia" : ""}`;
  const noLocation = (html: string) => html.replace(/<div id="job-\d+-desktop-section-location-value">[^<]*<\/div>/g, "");
  const http = fakeHttp({
    [`${MOTA}/robots.txt`]: { status: 404, body: "" },
    [search(0)]: { status: 200, body: noLocation(countLabelTiles(1, ["10001", "10002"], 351)) },
    [search(0, true)]: { status: 200, body: noLocation(countLabelTiles(1, ["1449122633", "1449131133"], 3)) },
    [search(2, true)]: { status: 200, body: noLocation(countLabelTiles(3, ["1435875733"], 3)) }
  });
  const listing = await listBoard({ atsType: SF, atsRef: "careers.mota-engil.com" }, http, {});
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.equal(listing.boardTotal, 3, "the Colombia search, not the 351 worldwide");
  assert.deepEqual(http.calls.filter((url) => url.includes("/search/")), [search(0), search(0, true), search(2, true)]);
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

// ---------- Teamtailor ----------

const TT = "teamtailor";
const ttUrl = (ref: string, page: number) => `https://${ref}.teamtailor.com/jobs.rss?per_page=100&offset=${page * 100}`;

test("Teamtailor: refs are a subdomain with an optional region", () => {
  assert.ok(isValidRef({ atsType: TT, atsRef: "qualacompany" }));
  assert.ok(isValidRef({ atsType: TT, atsRef: "connectassistance.na" }));
  assert.equal(isValidRef({ atsType: TT, atsRef: "evil.com/x" }), false);
  assert.equal(isValidRef({ atsType: TT, atsRef: "a.b.c" }), false);
  assert.equal(portalUrl({ atsType: TT, atsRef: "qualacompany" }), "https://qualacompany.teamtailor.com/jobs");
});

test("Teamtailor: real feed — country by name, multi-country posting per segment, office city never used", async () => {
  const listing = await listBoard(
    { atsType: TT, atsRef: "empleosknaufsouthamerica" },
    fakeHttp({ [ttUrl("empleosknaufsouthamerica", 0)]: { status: 200, body: fixture(TT, "jobs-knauf-all9.rss.xml") } }),
    {}
  );
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.equal(listing.boardTotal, 9);
  const first = listing.postings[0];
  assert.equal(first.externalId, "8527643");
  assert.equal(first.publishedAt, "2026-10-09T19:34:31.000Z", "RFC 822 with offset");
  assert.equal(first.workplace, "onsite");
  assert.equal(first.companyName, "Knauf South America");
  assert.ok(first.descriptionText && !first.descriptionText.includes("<h4>"));
  const { postings, stats } = selectColombianPostings(listing.postings, NOW);
  assert.equal(stats.colombia, 3);
  assert.ok(postings.every((posting) => posting.city === null), "tt:city is the office, not the posting's city");
  assert.ok(postings.every((posting) => posting.locationRaw.includes("Colombia")));
});

test("Teamtailor: regional ref and the 30-day window by pubDate", async () => {
  const listing = await listBoard(
    { atsType: TT, atsRef: "connectassistance.na" },
    fakeHttp({ [ttUrl("connectassistance.na", 0)]: { status: 200, body: fixture(TT, "jobs-connect-all7.rss.xml") } }),
    {}
  );
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  const { stats } = selectColombianPostings(listing.postings, NOW);
  assert.equal(stats.colombia, 5);
  assert.equal(stats.notColombia, 2, "Puerto Rico");
  assert.ok(stats.stale > 0, "postings older than 30 days by pubDate are not stored");
});

function ttItem(id: number): string {
  return `<item><title>Vacante ${id}</title><pubDate>Mon, 19 Oct 2026 10:00:00 -0500</pubDate><link>https://acme.teamtailor.com/jobs/${id}-vacante</link><remoteStatus>none</remoteStatus><tt:locations><tt:location><tt:city>Bogotá</tt:city><tt:country>Colombia</tt:country></tt:location></tt:locations></item>`;
}
const ttFeed = (ids: number[]) => `<?xml version='1.0'?><rss version="2.0"><channel><title>Acme</title>${ids.map(ttItem).join("")}</channel></rss>`;
const range = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index);

test("Teamtailor: pages until a short page; an overlap or a failed page is never complete", async () => {
  const full = await listBoard(
    { atsType: TT, atsRef: "acme" },
    fakeHttp({
      [ttUrl("acme", 0)]: { status: 200, body: ttFeed(range(1, 100)) },
      [ttUrl("acme", 1)]: { status: 200, body: ttFeed(range(101, 100)) },
      [ttUrl("acme", 2)]: { status: 200, body: fixture(TT, "jobs-quala-offset300-empty.rss.xml") }
    }),
    {}
  );
  assert.equal(full.kind === "complete" && full.boardTotal, 200, "an exact multiple of 100 ends on the empty page");
  assert.equal(full.kind === "complete" && full.postings[0].workplace, null, "remoteStatus none = not stated");
  const shifted = await listBoard(
    { atsType: TT, atsRef: "acme" },
    fakeHttp({ [ttUrl("acme", 0)]: { status: 200, body: ttFeed(range(1, 100)) }, [ttUrl("acme", 1)]: { status: 200, body: ttFeed(range(100, 5)) } }),
    {}
  );
  assert.equal(shifted.kind, "error");
  const broken = await listBoard(
    { atsType: TT, atsRef: "acme" },
    fakeHttp({ [ttUrl("acme", 0)]: { status: 200, body: ttFeed(range(1, 100)) }, [ttUrl("acme", 1)]: { status: 502, body: "" } }),
    {}
  );
  assert.deepEqual(broken, { kind: "error", detail: "HTTP 502 en la página 2" });
  const html = await listBoard({ atsType: TT, atsRef: "acme" }, fakeHttp({ [ttUrl("acme", 0)]: { status: 200, body: "<html>login</html>" } }), {});
  assert.equal(html.kind, "error");
});
