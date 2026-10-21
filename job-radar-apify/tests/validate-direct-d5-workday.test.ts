import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { colombiaFacet, postedOver30Days, workdayExternalId } from "../src/direct/ats/workday.js";
import { smartRecruitersIdFromUrl, workdayRefFromUrl } from "../src/direct/discovery/cc-refs.js";
import { isValidRef, listBoard, portalUrl } from "../src/direct/connectors.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import type { HttpGet, HttpRequestInit } from "../src/direct/types.js";

/**
 * Workday connector (docs/source-catalog/workday.md) — offline contract
 * tests over REAL responses captured by source-researcher on 2026-10-20
 * (tests/fixtures/direct/workday/). The unfiltered Galderma page was trimmed
 * to 5 rows by the researcher; its declared total (341) is kept, which is
 * what sends the connector to the Colombia facet.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "direct", "workday");
const wdText = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");
const wdJson = (name: string) => JSON.parse(wdText(name));
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

const WD = "workday";
const GAL = "https://galderma.wd3.myworkdayjobs.com";
const GAL_CXS = `${GAL}/wday/cxs/galderma/External`;
const GAL_ROBOTS = "User-agent: *\nAllow: /External/\nAllow: /broadbean_external/\nDisallow: /refreshFacet/\n";
const GERENTE = "Gerente-de-Demanda-Retail-para-Medicamentos-de-Prescripcin_JR021078";

test("Workday: refs, portal and the facet discovery across tenant spellings", () => {
  assert.ok(isValidRef({ atsType: WD, atsRef: "galderma/wd3/External" }));
  assert.ok(isValidRef({ atsType: WD, atsRef: "rappi/wd12/Rappi_jobs" }));
  assert.equal(isValidRef({ atsType: WD, atsRef: "galderma/External" }), false);
  assert.equal(isValidRef({ atsType: WD, atsRef: "evil.com/wd3/x" }), false);
  assert.equal(portalUrl({ atsType: WD, atsRef: "galderma/wd3/External" }), `${GAL}/External`);
  assert.deepEqual(colombiaFacet(wdJson("galderma-list-page0-unfiltered.json").facets), {
    name: "alocationCountry",
    colombiaId: "e8106cd6a3534f2dba6fdee2d41db89d",
    count: 7
  });
  assert.equal(colombiaFacet(wdJson("rappi-wd12-list-page1-postings-without-location.json").facets), null, "Rappi has no country facet");
  assert.equal(workdayExternalId("/job/Bogot/Key-Account-Manager-Medellin_JR015272-1"), "Key-Account-Manager-Medellin_JR015272-1");
  assert.ok(postedOver30Days("Posted 30+ Days Ago"));
  assert.equal(postedOver30Days("Posted 5 Days Ago"), false);
});

function galdermaHttp(robots = GAL_ROBOTS, detailStatus = 200) {
  const unfiltered = wdJson("galderma-list-page0-unfiltered.json");
  const filtered = wdJson("galderma-list-colombia-filtered.json");
  return fakeHttp({
    [`${GAL}/robots.txt`]: { status: 200, body: robots },
    [`${GAL_CXS}/jobs`]: (init) => {
      const json = init?.json as { appliedFacets: Record<string, string[]>; offset: number };
      if (json.offset !== 0) return { status: 200, body: JSON.stringify({ total: 0, jobPostings: [] }) };
      return { status: 200, body: JSON.stringify(Object.keys(json.appliedFacets).length ? filtered : unfiltered) };
    },
    [`${GAL_CXS}/job/Bogot/${GERENTE}`]: { status: detailStatus, body: wdText("galderma-detail-colombia.json") }
  });
}

test("Workday: a big board is read through its Colombia facet; date and country from the detail; 30+ never fetched", async () => {
  const http = galdermaHttp();
  const listing = await listBoard({ atsType: WD, atsRef: "galderma/wd3/External" }, http, { detailBudget: 25 });
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.equal(listing.boardTotal, 7, "the facet's total");
  assert.ok(http.calls.some((call) => call.includes('"alocationCountry":["e8106cd6a3534f2dba6fdee2d41db89d"]')), "facet name as the tenant spells it");
  assert.equal(listing.postings.length, 1, "the six '30+' postings are skipped");
  const [posting] = listing.postings;
  assert.equal(posting.externalId, GERENTE);
  assert.equal(posting.publishedAt, "2026-10-15T00:00:00.000Z");
  assert.equal(posting.validThrough, "2026-10-23T00:00:00.000Z");
  assert.deepEqual(posting.countryCodes, ["CO"]);
  assert.equal(posting.companyName, "Galderma Colombia SA");
  assert.equal(posting.applyUrl, `${GAL}/External/job/Bogot/${GERENTE}`);
  assert.ok(posting.descriptionText && !posting.descriptionText.includes("<span>"));
  assert.equal(http.calls.filter((call) => call.includes("/job/")).length, 1);
  const { postings } = selectColombianPostings(listing.postings, NOW);
  assert.equal(postings[0].city, "Bogotá");
});

test("Workday: known postings go out partial without a detail request", async () => {
  const http = galdermaHttp();
  const listing = await listBoard({ atsType: WD, atsRef: "galderma/wd3/External" }, http, {
    knownIds: new Set([GERENTE, "Key-Account-Manager-Medellin_JR015272-1"]),
    detailBudget: 25
  });
  assert.equal(listing.kind === "complete" && listing.postings.length, 2, "a known 30+ posting still counts as listed");
  assert.ok(listing.kind === "complete" && listing.postings.every((posting) => posting.partial && posting.publishedAt === null));
  assert.equal(http.calls.some((call) => call.includes("/job/")), false);
});

test("Workday: robots, budget and failures never invent or close", async () => {
  const ref = { atsType: WD, atsRef: "galderma/wd3/External" } as const;
  assert.deepEqual(await listBoard(ref, galdermaHttp("User-agent: *\nDisallow: /External/\n"), {}), { kind: "error", detail: "robots.txt no permite este site" });
  assert.deepEqual(await listBoard(ref, galdermaHttp("User-agent: *\nAllow: /Other/\n"), {}), {
    kind: "error",
    detail: "robots.txt solo abre otros sites de este tenant"
  });
  const noBudget = await listBoard(ref, galdermaHttp(), { detailBudget: 0 });
  assert.ok(noBudget.kind === "complete" && noBudget.postings.length === 0 && noBudget.deferred === 1);
  const detailDown = await listBoard(ref, galdermaHttp(GAL_ROBOTS, 500), { detailBudget: 5 });
  assert.ok(detailDown.kind === "complete" && detailDown.postings.length === 0 && detailDown.deferred === 1, "a failed detail defers, never stores undated");
  const throttled = await listBoard(ref, fakeHttp({ [`${GAL}/robots.txt`]: { status: 200, body: GAL_ROBOTS }, [`${GAL_CXS}/jobs`]: { status: 429, body: "{}" } }), {});
  assert.deepEqual(throttled, { kind: "error", detail: "HTTP 429 en la página 1" });
});

test("Workday: a big board without a country facet is reported, not guessed", async () => {
  const noCountryFacet = { ...wdJson("rappi-wd12-list-page1-postings-without-location.json"), total: 1122 };
  const MC = "https://mastercard.wd1.myworkdayjobs.com";
  const listing = await listBoard(
    { atsType: WD, atsRef: "mastercard/wd1/CorporateCareers" },
    fakeHttp({
      [`${MC}/robots.txt`]: { status: 404, body: "" },
      [`${MC}/wday/cxs/mastercard/CorporateCareers/jobs`]: { status: 200, body: JSON.stringify(noCountryFacet) }
    }),
    {}
  );
  assert.deepEqual(listing, { kind: "error", detail: "tablero de 1122 vacantes sin faceta de país ni ubicaciones colombianas: no se puede leer completo" });
});

test("Workday: small board read whole; foreign ISO-3 prefixes need no detail; a short read is incomplete", async () => {
  const page = wdJson("rappi-wd12-list-page1-postings-without-location.json");
  const RAPPI = "https://rappi.wd12.myworkdayjobs.com";
  const base = `${RAPPI}/wday/cxs/rappi/Rappi_jobs`;
  const routes = (total: number) =>
    fakeHttp({
      [`${RAPPI}/robots.txt`]: { status: 200, body: "Sitemap: https://rappi.wd12.myworkdayjobs.com/Rappi_jobs/siteMap.xml\n" },
      [`${base}/jobs`]: (init) =>
        (init?.json as { offset: number }).offset === 0
          ? { status: 200, body: JSON.stringify({ ...page, total }) }
          : { status: 200, body: JSON.stringify({ total, jobPostings: [] }) }
    });
  const whole = await listBoard({ atsType: WD, atsRef: "rappi/wd12/Rappi_jobs" }, routes(page.jobPostings.length), { detailBudget: 5 });
  assert.equal(whole.kind, "complete");
  const short = await listBoard({ atsType: WD, atsRef: "rappi/wd12/Rappi_jobs" }, routes(24), {});
  assert.deepEqual(short, { kind: "error", detail: "se leyeron 4 de 24 vacantes: listado incompleto" });
});

test("Workday: the country facet is found however the tenant spells it, never a look-alike", () => {
  const facet = (facetParameter: string) => [{ facetParameter, values: [{ descriptor: "Colombia", id: "co-id", count: 3 }] }];
  for (const name of ["locationCountry", "alocationCountry", "Location_Country", "Country", "country"]) {
    assert.deepEqual(colombiaFacet(facet(name)), { name, colombiaId: "co-id", count: 3 }, name);
  }
  for (const name of ["locations", "Location_Country_Region", "jobFamilyGroup", "workerSubType"]) {
    assert.equal(colombiaFacet(facet(name)), null, name);
  }
});

test("Common Crawl refs: Workday site with or without locale, SmartRecruiters company id, nothing else", () => {
  assert.equal(workdayRefFromUrl("https://rappi.wd12.myworkdayjobs.com/es/Rappi_jobs/job/COL-Bogot/x_JR1"), "rappi/wd12/Rappi_jobs");
  assert.equal(workdayRefFromUrl("https://galderma.wd3.myworkdayjobs.com/External"), "galderma/wd3/External");
  assert.equal(workdayRefFromUrl("https://accenture.wd103.myworkdayjobs.com/en-US/AccentureCareers/details/y"), "accenture/wd103/AccentureCareers");
  assert.equal(workdayRefFromUrl("https://galderma.wd3.myworkdayjobs.com/wday/cxs/galderma/External/jobs"), null);
  assert.equal(workdayRefFromUrl("https://evil.com/galderma/wd3/External"), null);
  assert.equal(smartRecruitersIdFromUrl("https://jobs.smartrecruiters.com/BoschGroup/744000012345-analista"), "BoschGroup");
  assert.equal(smartRecruitersIdFromUrl("https://jobs.smartrecruiters.com/oneclick-ui/company/x"), null);
  assert.equal(smartRecruitersIdFromUrl("https://careers.smartrecruiters.com/BoschGroup"), null);
});

test("Workday: a page answered with 429, 5xx or an unexpected body is asked once more, never twice", async () => {
  const page = wdJson("rappi-wd12-list-page1-postings-without-location.json");
  const RAPPI = "https://rappi.wd12.myworkdayjobs.com";
  const base = `${RAPPI}/wday/cxs/rappi/Rappi_jobs`;
  const ref = { atsType: WD, atsRef: "rappi/wd12/Rappi_jobs" } as const;
  const good = { status: 200, body: JSON.stringify({ ...page, total: page.jobPostings.length }) };
  const run = async (answers: { status: number; body: string }[]) => {
    let call = 0;
    const http = fakeHttp({
      [`${RAPPI}/robots.txt`]: { status: 404, body: "" },
      [`${base}/jobs`]: () => answers[Math.min(call++, answers.length - 1)]
    });
    return { listing: await listBoard(ref, http, {}), listCalls: http.calls.filter((c) => c.startsWith("POST")).length };
  };
  for (const glitch of [{ status: 200, body: "<html>busy</html>" }, { status: 429, body: "{}" }, { status: 503, body: "" }]) {
    const { listing, listCalls } = await run([glitch, good]);
    assert.equal(listing.kind, "complete", `recovers after ${glitch.status}`);
    assert.equal(listCalls, 2);
  }
  const twice = await run([{ status: 200, body: "{}" }]);
  assert.deepEqual(twice.listing, { kind: "error", detail: "forma inesperada en la página 1" });
  assert.equal(twice.listCalls, 2);
  const notFound = await run([{ status: 404, body: "" }]);
  assert.equal(notFound.listCalls, 1, "a 404 is not retried");
});
