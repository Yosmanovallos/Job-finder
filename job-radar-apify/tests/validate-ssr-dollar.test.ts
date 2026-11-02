/**
 * Source text with "$" patterns reaches the SSR pages verbatim — pure,
 * offline, on the real index.html. A string replacement would expand
 * "$&", "$`", "$'" and "$$"; the injectors use function replacers.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { injectPublicContent } from "../src/lib/agent-readiness.js";
import { buildJobBreadcrumbList } from "../src/lib/job-internal-links.js";
import {
  buildJobMeta,
  buildJobPageBody,
  buildJobPagePayload,
  buildJobPosting,
  escapeJsonForScriptTag,
  injectJobHeadMeta,
  injectJobPageContent
} from "../src/lib/job-seo.js";
import { fullJob } from "./fixtures/job-meta.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = fs.readFileSync(path.join(here, "..", "index.html"), "utf-8");
const DOLLARS = "$& $` $' $$";

const dollarJob = {
  ...fullJob,
  jobId: "d0d0d0d0-1111-4111-8111-000000000001",
  title: `Cajero ${DOLLARS}`,
  description: `Atiende la caja ${DOLLARS} con cuidado. Salario $$1.300.000 más comisiones.\nOtra línea.`
};

const scriptBodies = (html: string, opener: string) =>
  html.split(opener).slice(1).map((rest) => rest.slice(0, rest.indexOf("</script>")));

test("SSR-001 job page body, payload and JSON-LD keep '$' patterns verbatim", () => {
  const appHtml = buildJobPageBody(dollarJob);
  const links = { jobId: dollarJob.jobId, related: [] };
  const breadcrumb = buildJobBreadcrumbList(dollarJob, null);
  const payload = buildJobPagePayload(dollarJob);
  const jobPosting = buildJobPosting(dollarJob);
  assert.ok(jobPosting, "the fixture must emit JobPosting");
  assert.ok(appHtml.includes("$`"), "the fixture must reach the body with a live pattern");

  const html = injectJobHeadMeta(
    injectJobPageContent(shell, { appHtml, links, breadcrumb, payload, noindex: false, jobPosting }),
    buildJobMeta(dollarJob)
  );

  const app = /<div id="app">([\s\S]*)<\/div>\s*<script type="module"/.exec(html)?.[1];
  assert.equal(app, appHtml);
  const [jobPayload] = scriptBodies(html, "<script>window.__SSR_JOB__=");
  assert.deepEqual(JSON.parse(jobPayload!.replace(/;$/, "")), JSON.parse(JSON.stringify(payload)));
  const [linksPayload] = scriptBodies(html, "<script>window.__SSR_JOB_LINKS__=");
  assert.deepEqual(JSON.parse(linksPayload!.replace(/;$/, "")), links);
  const ldOpener = '<script type="application/ld+json">';
  const ldJson = scriptBodies(html, ldOpener).map((body) => JSON.parse(body));
  // The shell already carries Organization and WebSite; ours come after.
  assert.deepEqual(ldJson.slice(0, -2), scriptBodies(shell, ldOpener).map((body) => JSON.parse(body)));
  assert.deepEqual(ldJson.slice(-2),JSON.parse(JSON.stringify([breadcrumb, jobPosting])));
  for (const tag of ["<title>", "</head>", '<div id="app">', "<body"]) {
    assert.equal(html.split(tag).length - 1, 1, tag);
  }
  assert.doesNotMatch(html, /noindex/);
});

test("SSR-002 the fixture really triggers the bug a string replacement had", () => {
  const pieces = [
    ['<div id="app"></div>', `<div id="app">${buildJobPageBody(dollarJob)}</div>`],
    ["</head>", `<script>window.__SSR_JOB__=${escapeJsonForScriptTag(buildJobPagePayload(dollarJob))};</script></head>`],
    ["</head>", `<script>${escapeJsonForScriptTag(buildJobPosting(dollarJob))}</script></head>`],
    ["</head>", `<script>${escapeJsonForScriptTag(buildJobBreadcrumbList(dollarJob, null))}</script></head>`]
  ] as const;
  for (const [search, replacement] of pieces) {
    assert.notEqual(shell.replace(search, replacement), shell.replace(search, () => replacement), replacement.slice(0, 40));
  }
});

test("SSR-003 public content pages keep '$' patterns verbatim", () => {
  const html = injectPublicContent(shell, {
    pathname: "/prueba",
    title: `Guía ${DOLLARS}`,
    description: `Resumen ${DOLLARS}`,
    heading: `Guía ${DOLLARS}`,
    introduction: [`Intro ${DOLLARS}`],
    sections: []
  });
  const escaped = "$&amp; $` $&#39; $$";
  assert.ok(html.includes(`<p>Intro ${escaped}</p>`));
  assert.ok(html.includes(`<title>Guía ${escaped}</title>`));
  assert.ok(html.includes(`<meta name="description" content="Resumen ${escaped}" />`));
  assert.equal(html.split("<title>").length - 1, 1);
  assert.equal(html.split("</head>").length - 1, 1);
});
