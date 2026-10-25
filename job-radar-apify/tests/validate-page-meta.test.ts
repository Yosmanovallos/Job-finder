import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTE_META, companiesDirectoryMeta, dashboardDescription } from "../src/lib/page-meta.js";
import { getHomeContent, injectPublicContent, injectRouteMeta } from "../src/lib/agent-readiness.js";
import { buildCompanyMeta } from "../src/lib/job-seo.js";

// Offline guard for the per-page head the server injects into the SPA
// shell (SEO fase B, 2026-10-25). Runs against the real index.html source,
// no server or database.
const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.join(here, "..", "index.html"), "utf-8");

const title = (html: string) => /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "";
const description = (html: string) => /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "";
const canonical = (html: string) => /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? "";
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function rendered(): Array<{ pathname: string; html: string; expectH1: boolean; noindex: boolean }> {
  const routes = Object.entries(ROUTE_META).map(([pathname, meta]) => ({
    pathname,
    html: injectRouteMeta(indexHtml, pathname, meta),
    expectH1: Boolean(meta.heading),
    noindex: Boolean(meta.noindex)
  }));
  const homes = (["CO", "VE"] as const).map((country) => {
    const content = getHomeContent(country);
    return { pathname: content.pathname, html: injectPublicContent(indexHtml, content), expectH1: true, noindex: false };
  });
  return [...homes, ...routes];
}

test("every injected page has its own title, description and self canonical", () => {
  const pages = rendered();
  const titles = pages.map((page) => decode(title(page.html)));
  assert.equal(new Set(titles).size, titles.length, `duplicate titles: ${titles.join(" / ")}`);
  for (const page of pages) {
    const t = decode(title(page.html));
    const d = decode(description(page.html));
    assert.ok(t.length > 0 && t.length <= 60, `${page.pathname} title ${t.length}: ${t}`);
    assert.ok(t.endsWith("| BuscoTrabajo"), `${page.pathname} title lacks brand suffix: ${t}`);
    assert.ok(d.length >= 40 || page.noindex, `${page.pathname} description too short: ${d}`);
    assert.ok(d.length <= 155, `${page.pathname} description ${d.length}: ${d}`);
    assert.equal(canonical(page.html), `https://buscotrabajo.co${page.pathname}`, page.pathname);
  }
});

test("headings and robots match each route's intent", () => {
  for (const page of rendered()) {
    const h1s = page.html.match(/<h1>/g) ?? [];
    assert.equal(h1s.length, page.expectH1 ? 1 : 0, `${page.pathname} h1 count`);
    assert.equal(page.html.includes('content="noindex,follow"'), page.noindex, `${page.pathname} robots`);
  }
});

test("copy never advertises the retired paywall or a Pro plan", () => {
  const texts = [
    ...rendered().map((page) => `${title(page.html)} ${description(page.html)}`),
    dashboardDescription("CO", "Colombia"),
    dashboardDescription("VE", "Venezuela")
  ];
  for (const text of texts) {
    assert.doesNotMatch(text, /\bPro\b|48 ?h/, text);
  }
});

test("shared builders stay within the length limits", () => {
  for (const [country, name] of [["CO", "Colombia"], ["VE", "Venezuela"]] as const) {
    assert.ok(dashboardDescription(country, name).length <= 155);
    const directory = companiesDirectoryMeta(name);
    assert.ok(directory.title.length <= 60, directory.title);
    assert.ok(directory.title.startsWith(directory.heading));
  }
  const company = buildCompanyMeta("Bancolombia", 97, "CO");
  assert.equal(company.title, "Empleos en Bancolombia | BuscoTrabajo");
  assert.match(company.description, /97 vacantes activas en Colombia/);
});

test("Organization schema lists every official social profile", () => {
  for (const profile of [
    "https://x.com/Buscotrabajoco",
    "https://www.tiktok.com/@busco.trabajo09",
    "https://www.instagram.com/buscotrabajocolombia.co/",
    "https://www.youtube.com/@buscotrabajo-d5n"
  ]) {
    assert.ok(indexHtml.includes(`"${profile}"`), profile);
  }
  assert.ok(indexHtml.includes('<meta property="og:site_name" content="BuscoTrabajo" />'));
});
