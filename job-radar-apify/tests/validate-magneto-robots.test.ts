import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isAllowed, parseRobots } from "../src/lib/robots-txt.js";
import { magnetoRows, magnetoRowToJob, magnetoTopicPaths, rotateTopics } from "../src/sources/magneto-catalog.js";

/**
 * Magneto as a job board within its robots.txt (owner decision 2026-10-20).
 * Real robots.txt and a real company listing page captured 2026-10-20
 * (tests/fixtures/direct/magneto/).
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "direct", "magneto");
const raw = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

test("Magneto robots.txt: keyword search forbidden, search page, its paginator and topic pages allowed", () => {
  const robots = parseRobots(raw("robots.magneto365.com.txt"));
  assert.equal(isAllowed(robots, "/co/empleos?q=analista"), false, "the old scraper's URL");
  assert.equal(isAllowed(robots, "/co/trabajos/buscar?q=analista"), false);
  assert.equal(isAllowed(robots, "/co/trabajos/buscar"), true);
  assert.equal(isAllowed(robots, "/co/trabajos/buscar?paginator[page]=2"), true, "longest match: Allow /*paginator[page]");
  assert.equal(isAllowed(robots, "/co/trabajos/ofertas-empleo-en-bogota"), true);
  assert.equal(isAllowed(robots, "/co/empleos/analista-contable-1106351"), true);
});

test("Magneto topic pages: own /co/trabajos/{slug} links only, never a query or another country", () => {
  const html = `<a href="/co/trabajos/ofertas-empleo-en-bogota">x</a> <a href="https://www.magneto365.com/co/trabajos/vacantes-servicio-al-cliente">y</a>
    <a href="/co/trabajos/buscar">z</a> <a href="/co/trabajos/buscar?paginator[page]=2">p</a> <a href="/hn/trabajos/ofertas-empleo-en-tegucigalpa">h</a>`;
  assert.deepEqual(magnetoTopicPaths(html), ["/co/trabajos/ofertas-empleo-en-bogota", "/co/trabajos/vacantes-servicio-al-cliente"]);
});

test("Magneto rows: the date is Magneto's publishDate — a row without it is skipped, never dated today", () => {
  const rows = magnetoRows(raw("listing-claro-colombia-complete.html"));
  assert.equal(rows.length, 9);
  const job = magnetoRowToJob(rows[0]);
  assert.equal(job?.publishedAt, "2026-10-20T15:09:56.749Z");
  assert.equal(job?.validThrough, "2026-10-31T05:00:00.000Z");
  assert.equal(job?.url, "https://www.magneto365.com/co/empleos/consultor-a-comercial-contenido-1106351");
  assert.equal(job?.source, "Magneto");
  assert.equal(magnetoRowToJob({ ...rows[0], publishDate: undefined }), null);
  assert.equal(magnetoRowToJob({ ...rows[0], confidential: true })?.company, "Confidencial");
  assert.equal(magnetoRowToJob({ ...rows[0], jobSlug: "../x?q=1" }), null);
});

test("Magneto topic pages rotate every 3-hour window so the 3-minute catalog budget still covers all of them", () => {
  const paths = Array.from({ length: 26 }, (_, index) => `/co/trabajos/t${index}`);
  const window = 3 * 60 * 60 * 1000;
  const first = rotateTopics(paths, 0);
  const second = rotateTopics(paths, window);
  assert.equal(first.length, 15);
  assert.deepEqual(first.slice(0, 2), ["/co/trabajos/t0", "/co/trabajos/t1"]);
  assert.equal(second[0], "/co/trabajos/t15", "the next window starts where this one ended");
  assert.equal(new Set([...first, ...second]).size, 26, "two windows cover every page");
  assert.deepEqual(rotateTopics(paths.slice(0, 5), 0), paths.slice(0, 5));
});
