import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseGoogleResults } from "../src/direct/ats/google.js";
import { colombiaFacet, colombianLocationFacet } from "../src/direct/ats/workday.js";
import { isValidRef, listBoard } from "../src/direct/connectors.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import type { HttpGet } from "../src/direct/types.js";

/**
 * Google Careers connector (docs/source-catalog/google.md) over the REAL
 * results page of 2026-10-20, cut to its ds:1 callback
 * (tests/fixtures/direct/google/), and Workday's custom-named country facet.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "direct", "google");
const page = readFileSync(path.join(FIXTURES, "results-colombia-ds1.html"), "utf8");
const NOW = new Date("2026-10-20T12:00:00Z");
const RESULTS = "https://www.google.com/about/careers/applications/jobs/results?location=Colombia";
const ROBOTS = "User-agent: *\nDisallow: /about/careers/applications/jobs/results?page=\nDisallow: /about/careers/applications/jobs/results?*&page=\n";

function fakeHttp(body: string, robots = ROBOTS): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const http = (async (url: string) => {
    calls.push(url);
    if (url === "https://www.google.com/robots.txt") return { status: 200, body: robots };
    if (url === RESULTS) return { status: 200, body };
    return { status: 404, body: "" };
  }) as HttpGet & { calls: string[] };
  http.calls = calls;
  return http;
}

test("Google: the positional block parses into postings, multi-country evaluated per segment, no invented date", async () => {
  const parsed = parseGoogleResults(page);
  assert.deepEqual([parsed?.total, parsed?.pageSize, parsed?.postings.length], [4, 20, 4]);
  const listing = await listBoard({ atsType: "google", atsRef: "google" }, fakeHttp(page), {});
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  const first = listing.postings[0];
  assert.equal(first.applyUrl, `https://www.google.com/about/careers/applications/jobs/results/${first.externalId}`, "never the sign-in link");
  assert.equal(first.publishedAt, null, "three unlabeled timestamps: none is declared as the posting date");
  assert.equal(first.companyName, "Google");
  const { postings } = selectColombianPostings(listing.postings, NOW);
  assert.equal(postings.length, 4);
  assert.ok(postings.every((posting) => posting.city === "Bogotá" && posting.descriptionText));
  assert.equal(isValidRef({ atsType: "google", atsRef: "other" }), false);
});

test("Google: more than page 1 is never complete (robots.txt forbids ?page=); a reshaped page is an error", async () => {
  const bigger = page.replace(/,\s*4\s*,\s*20\s*\]\s*,\s*sideChannel/, ",25,20]\n, sideChannel");
  assert.equal(parseGoogleResults(bigger)?.total, 25);
  const tooMany = await listBoard({ atsType: "google", atsRef: "google" }, fakeHttp(bigger), {});
  assert.deepEqual(tooMany, { kind: "error", detail: "25 vacantes y solo se puede leer la página 1 (4): listado incompleto" });
  const reshaped = await listBoard({ atsType: "google", atsRef: "google" }, fakeHttp("<html>nuevo diseño</html>"), {});
  assert.deepEqual(reshaped, { kind: "error", detail: "forma inesperada en la página de resultados" });
  const banned = await listBoard({ atsType: "google", atsRef: "google" }, fakeHttp(page, "User-agent: *\nDisallow: /about/careers/\n"), {});
  assert.deepEqual(banned, { kind: "error", detail: "robots.txt no permite la búsqueda de empleos" });
});

test("Workday without a country facet: only the location values the Colombia filter accepts", () => {
  const facets = [
    {
      facetParameter: "locationMainGroup",
      values: [
        {
          facetParameter: "locations",
          descriptor: "Locations",
          values: [
            { descriptor: "Bogota, Colombia", id: "bog", count: 7 },
            { descriptor: "COL-Medellín", id: "med", count: 2 },
            { descriptor: "Colorado Springs, CO, United States", id: "colorado", count: 40 },
            { descriptor: "San Francisco, California", id: "sf", count: 30 },
            { descriptor: "LATAM Remote", id: "latam", count: 9 }
          ]
        }
      ]
    }
  ];
  assert.deepEqual(colombianLocationFacet(facets), { name: "locations", ids: ["bog", "med"], count: 9 });
  assert.equal(colombianLocationFacet([{ facetParameter: "locations", values: [{ descriptor: "Lima, Peru", id: "lim" }] }]), null);
});

test("Workday: a custom-named country facet is found by its descriptor (Salesforce)", () => {
  const facets = [
    { facetParameter: "jobFamilyGroup", descriptor: "Job Category", values: [{ descriptor: "Sales", id: "x", count: 9 }] },
    {
      facetParameter: "CF_-_REC_-_LRV_-_Job_Posting_Anchor_-_Country_from_Job_Posting_Location_Extended",
      descriptor: "Country",
      values: [{ descriptor: "Colombia", id: "e8106cd6a3534f2dba6fdee2d41db89d", count: 8 }]
    }
  ];
  assert.deepEqual(colombiaFacet(facets), {
    name: "CF_-_REC_-_LRV_-_Job_Posting_Anchor_-_Country_from_Job_Posting_Location_Extended",
    colombiaId: "e8106cd6a3534f2dba6fdee2d41db89d",
    count: 8
  });
});
