import assert from "node:assert/strict";
import test from "node:test";
import { isValidRef, listBoard, portalUrl } from "../src/direct/connectors.js";
import { atsLinkFromUrl } from "../src/direct/discovery/ats-links.js";
import { selectColombianPostings } from "../src/direct/ingest.js";
import type { HttpGet } from "../src/direct/types.js";

const origin = "https://www.tp.com";
const row = (nodeId: number) => ({
  date: "2026-10-21T00:00:00", country: "Colombia", location: "Bogota",
  category: "Customer Service", title: "Customer Expert", workFromHome: "0",
  description: "<p>Atiende clientes.</p>", url: `/es-co/job-opportunities/colombia/customer-expert-${nodeId}/`,
  externalId: 100201464, source: "Umbraco", opportunityType: "Full Time", nodeId
});
const page = (number: number, total: number, rows: unknown[]) => ({
  paginaAtual: number, registrosPorPagina: 50, totalRegistros: total, resultado: rows
});
const url = (number: number) =>
  `${origin}/Umbraco/Api/Careers/GetCareersBase?node=1780&country=Colombia&culture=en-US&pageSize=50&page=${number}`;

function fakeHttp(pages: Record<string, unknown>): HttpGet {
  return async (requested) => ({ status: requested in pages ? 200 : 404, body: typeof pages[requested] === "string" ? pages[requested] as string : JSON.stringify(pages[requested] ?? "") });
}

test("TP: full Colombia pagination preserves distinct Umbraco node ids and source dates", async () => {
  assert.equal(isValidRef({ atsType: "tp", atsRef: "colombia" }), true);
  assert.equal(isValidRef({ atsType: "tp", atsRef: "../../other" }), false);
  assert.equal(portalUrl({ atsType: "tp", atsRef: "colombia" }), `${origin}/es-co/ubicaciones/colombia/carreras/`);
  assert.equal(atsLinkFromUrl(`${origin}/es-co/ubicaciones/colombia/carreras/`)?.atsRef, "colombia");
  const first = Array.from({ length: 50 }, (_, index) => row(index + 1));
  const second = [{ ...row(51), date: "2026-10-20T12:00:00", workFromHome: "Yes" }];
  const listing = await listBoard({ atsType: "tp", atsRef: "colombia" }, fakeHttp({
    [`${origin}/robots.txt`]: "Sitemap: https://www.tp.com/sitemap.xml",
    [url(0)]: page(0, 51, first),
    [url(1)]: page(1, 51, second)
  }));
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.equal(listing.boardTotal, 51);
  assert.equal(new Set(listing.postings.map((posting) => posting.externalId)).size, 51);
  assert.equal(listing.postings[50].publishedAt, "2026-10-20T00:00:00.000Z");
  assert.equal(listing.postings[50].workplace, "remote");
  assert.equal(selectColombianPostings(listing.postings, new Date("2026-10-25T00:00:00Z")).postings.length, 51);
});

test("TP: changed totals, invalid URLs and missing pages never authorize closures", async () => {
  const ref = { atsType: "tp" as const, atsRef: "colombia" };
  const robots = { [`${origin}/robots.txt`]: "Sitemap: https://www.tp.com/sitemap.xml" };
  const first = Array.from({ length: 50 }, (_, index) => row(index + 1));
  for (const badPage of [page(1, 52, [row(51)]), page(1, 51, [{ ...row(51), url: "https://evil.test/job" }])]) {
    const listing = await listBoard(ref, fakeHttp({ ...robots, [url(0)]: page(0, 51, first), [url(1)]: badPage }));
    assert.equal(listing.kind, "error");
  }
  const missing = await listBoard(ref, fakeHttp({ ...robots, [url(0)]: page(0, 51, first) }));
  assert.equal(missing.kind, "error");
});
