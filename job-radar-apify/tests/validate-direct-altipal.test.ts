import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { altipalDescription, parseAltipalPage } from "../src/direct/ats/altipal.js";
import { isValidRef, listBoard, portalUrl } from "../src/direct/connectors.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import type { HttpGet } from "../src/direct/types.js";

const origin = "https://creeser.hr-suite.app";
const ref = { atsType: "altipal" as const, atsRef: "creeser" };
const listingHtml = await readFile(new URL("./fixtures/direct/altipal/listing.html", import.meta.url), "utf8");
const newListingHtml = await readFile(new URL("./fixtures/direct/altipal/listing-2026-11.html", import.meta.url), "utf8");
const detailHtml =await readFile(new URL("./fixtures/direct/altipal/detail.html", import.meta.url), "utf8");

function http(robots = "User-agent: *\nDisallow: /admin/\n", detailStatus = 200): HttpGet {
  return async (url) => url === `${origin}/robots.txt`
    ? { status: 200, body: robots }
    : url === `${origin}/vacantes.php`
      ? { status: 200, body: listingHtml }
      : url === `${origin}/vacante/log.php?v=5098`
        ? { status: detailStatus, body: detailHtml }
        : { status: 404, body: "" };
}

test("Altipal: complete public listing, stable ids and Colombia-local dates", async () => {
  assert.equal(isValidRef(ref), true);
  assert.equal(isValidRef({ atsType: "altipal", atsRef: "other" }), false);
  assert.equal(portalUrl(ref), `${origin}/vacantes.php`);
  const listing = parseAltipalPage(listingHtml);
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.deepEqual(listing.postings.map((posting) => posting.externalId), ["5098", "5097"]);
  assert.equal(listing.postings[0].publishedAt, "2026-10-27T14:27:27.000Z");
  assert.equal(listing.postings[1].validThrough, "2026-10-28T04:59:59.999Z");
  assert.equal(selectColombianPostings(listing.postings, new Date("2026-10-27T20:00:00Z")).postings.length, 2);
  assert.equal(selectColombianPostings(listing.postings, new Date("2026-10-28T05:00:00Z")).postings.length, 1);
});

test("Altipal: reads bounded new details and defers the rest", async () => {
  const result = await listBoard(ref, http(), { detailBudget: 1 });
  assert.equal(result.kind, "complete");
  if (result.kind !== "complete") return;
  assert.equal(result.boardTotal, 2);
  assert.equal(result.deferred, 1);
  assert.equal(result.postings.length, 1);
  assert.equal(result.postings[0].descriptionText, "Descripción del Cargo\nAtender clientes & gestionar pedidos.");
  assert.equal(result.postings[0].partial, false);
  assert.equal(altipalDescription(detailHtml.replace("Asesor Comercial", "Otro cargo"), result.postings[0]), null);
  const known = await listBoard(ref, http(), { detailBudget: 0, knownIds: new Set(["5098", "5097"]) });
  assert.equal(known.kind, "complete");
  if (known.kind === "complete") assert.equal(known.postings.length, 2);
});

test("Altipal: malformed pages, duplicate ids, unexpected dates and pagination fail closed", () => {
  assert.equal(parseAltipalPage("<html>login</html>").kind, "error");
  assert.equal(parseAltipalPage(listingHtml.replace("v=5097", "v=5098")).kind, "error");
  assert.equal(parseAltipalPage(listingHtml.replace("2026-10-27 09:27:27", "2026-02-30 09:27:27")).kind, "error");
  assert.equal(parseAltipalPage(listingHtml.replace("2026-11-20", "2026-02-30")).kind, "error");
  assert.equal(parseAltipalPage(listingHtml.replace("</body>", '<a href="?page=2">2</a></body>')).kind, "error");
  assert.equal(parseAltipalPage(listingHtml.replace("v=5097", "v=5097&next=1")).kind, "error");
});

test("Altipal: 2026-11 layout with cities outside the original list", () => {
  // Sanitized from the live listing (CRLF, image, "Fecha de Apertura", nested
  // apply block); titles and ids are synthetic.
  const listing = parseAltipalPage(newListingHtml);
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.deepEqual(listing.postings.map((posting) => posting.externalId), ["9103", "9102", "9101"]);
  assert.deepEqual(listing.postings.map((posting) => posting.structuredCity), ["BOGOTÁ D.C.", "ACACÍAS", null]);
  assert.deepEqual(listing.postings[2].locationTexts, ["PUERTO GAITÁN"]);
  assert.equal(listing.postings[0].publishedAt, "2026-10-30T17:56:36.000Z");
  assert.equal(listing.postings[0].validThrough, "2026-12-01T04:59:59.999Z");
  assert.equal(listing.postings[1].department, "Ventas");
  const selected = selectColombianPostings(listing.postings, new Date("2026-11-02T12:00:00Z"));
  assert.equal(selected.stats.notColombia, 0);
  assert.equal(selected.postings.length, 3);
  assert.equal(parseAltipalPage(newListingHtml.replace("ACACÍAS", "TUMACO")).kind, "complete");
});

test("Altipal: missing fields become null, unexpected values still fail the board", () => {
  const noCity = parseAltipalPage(newListingHtml.replace("Ciudad: <b>ACACÍAS</b><br>", ""));
  assert.equal(noCity.kind, "complete");
  if (noCity.kind === "complete") {
    assert.equal(noCity.postings[1].structuredCity, null);
    assert.deepEqual(noCity.postings[1].locationTexts, []);
  }
  const noDates = parseAltipalPage(newListingHtml
    .replace("Publicado en: <b>2026-10-29 08:05:00</b><br>", "")
    .replace("Fecha Fin de Postulación: <b>2026-11-15</b><br>", ""));
  assert.equal(noDates.kind, "complete");
  if (noDates.kind === "complete") {
    assert.equal(noDates.postings[1].publishedAt, null);
    assert.equal(noDates.postings[1].validThrough, null);
  }
  for (const city of ["ACACÍAS 2", "ACACÍAS<br>VILLAVICENCIO", "BOGOTÁ; MEDELLÍN", "A".repeat(61)]) {
    assert.equal(parseAltipalPage(newListingHtml.replace("ACACÍAS", city)).kind, "error", city);
  }
  assert.equal(parseAltipalPage(newListingHtml.replace(/Ciudad:/g, "Ubicación:")).kind, "error");
  assert.equal(parseAltipalPage(newListingHtml.replace(/Publicado en:/g, "Creada:")).kind, "error");
  assert.equal(parseAltipalPage(newListingHtml.replace(/Fecha Fin de Postulación:/g, "Cierre:")).kind, "error");
  assert.equal(parseAltipalPage(newListingHtml.replace("2026-10-29 08:05:00", "29/10/2026")).kind, "error");
  assert.equal(parseAltipalPage(newListingHtml.replace("v=9102", "v=9103")).kind, "error");
});

test("Altipal: robots denial and unavailable new detail do not produce listings", async () => {
  assert.equal((await listBoard(ref, http("User-agent: *\nDisallow: /vacantes.php\n"))).kind, "error");
  assert.equal((await listBoard(ref, http("User-agent: *\nDisallow: /vacante/\n"))).kind, "error");
  assert.equal((await listBoard(ref, http(undefined, 404), { detailBudget: 1 })).kind, "error");
  assert.equal((await listBoard(ref, http(undefined, 403), { detailBudget: 1 })).kind, "error");
});
