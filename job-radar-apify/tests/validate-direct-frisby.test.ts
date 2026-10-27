import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isValidRef, listBoard, portalUrl } from "../src/direct/connectors.js";
import { parseFrisbyPage } from "../src/direct/ats/frisby.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import type { HttpGet } from "../src/direct/types.js";

const origin = "https://frisby.info";
const ref = { atsType: "frisby" as const, atsRef: "colombia" };
const fixture = await readFile(new URL("./fixtures/direct/frisby/listing.html", import.meta.url), "utf8");

function http(html: string, robots = "User-agent: *\nDisallow: /wp-admin/\n"): HttpGet {
  return async (url) => url === `${origin}/robots.txt`
    ? { status: 200, body: robots }
    : url === `${origin}/gente-frisby/`
      ? { status: 200, body: html }
      : { status: 404, body: "" };
}

test("Frisby: complete corporate listing, Colombian cities, no invented dates", async () => {
  assert.equal(isValidRef(ref), true);
  assert.equal(isValidRef({ atsType: "frisby", atsRef: "other" }), false);
  assert.equal(portalUrl(ref), `${origin}/gente-frisby/`);
  const listing = await listBoard(ref, http(fixture));
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.equal(listing.boardTotal, 2);
  assert.equal(new Set(listing.postings.map((posting) => posting.externalId)).size, 2);
  assert.deepEqual(listing.postings.map((posting) => posting.publishedAt), [null, null]);
  assert.equal(listing.postings[0].descriptionText, "Descripción\nAtender en restaurante.");
  assert.equal(selectColombianPostings(listing.postings, new Date("2026-10-26T00:00:00Z")).postings.length, 2);
});

test("Frisby: changed shape, duplicate links, pagination and robots block fail closed", async () => {
  assert.equal(parseFrisbyPage(fixture.replace("gfid=147", "gfid=146").replace("Medellín", "Yumbo").replace("Antioquia", "Valle del Cauca")).kind, "error");
  assert.equal(parseFrisbyPage(fixture.replace("<h2>Auxiliar de Preparación</h2>", "")).kind, "error");
  assert.equal(parseFrisbyPage(fixture.replace("</body>", '<a href="/gente-frisby/page/2/">2</a></body>')).kind, "error");
  assert.equal(parseFrisbyPage("<html>login</html>").kind, "error");
  assert.equal((await listBoard(ref, http(fixture, "User-agent: *\nDisallow: /gente-frisby/\n"))).kind, "error");
  assert.equal((await listBoard(ref, http(fixture, "User-agent: *\nDisallow: /aplicar-frisby/\n"))).kind, "error");
});
