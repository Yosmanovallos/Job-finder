import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import { fileURLToPath } from "node:url";
import { isMarkedAdEligible } from "../src/lib/ad-eligibility.js";
import { buildLlmsTxt } from "../src/lib/agent-readiness.js";
import { LABOR_SOURCES } from "../src/lib/labor-values.js";
import {
  LIQUIDATION_TOOL,
  NET_SALARY_TOOL,
  SEO_TITLE_MAX,
  TOOLS_INDEX,
  TOOL_PAGES,
  toolJsonLd,
  toolLinksForGuide
} from "../src/lib/tools-content.js";
import { handleToolsRoute, isToolsRoute, renderToolPageHtml, renderToolsIndexHtml } from "../src/server/routes/tools.js";
import { renderGuidePageHtml } from "../src/server/routes/guides.js";
import { loadGuidesFrom, GUIDES_CONTENT_DIR } from "../src/server/guides-store.js";
import type { Guide } from "../src/lib/guides.js";

// openspec/changes/adsense-readiness F5 (ADS-060, AV-4): /herramientas
// pages as the server sends them. Offline: no database, no network.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf-8");
const appHtml = (html: string) => /<div id="app">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? "";
const visibleWords = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").split(/\s+/).filter(Boolean).length;
const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]!) as Record<string, unknown>);
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf-8");

async function call(pathname: string, accept = "text/html", method = "GET") {
  let sent: { status: number; headers: http.OutgoingHttpHeaders; body: string } | null = null;
  const handled = await handleToolsRoute({ headers: { accept } } as http.IncomingMessage, {} as http.ServerResponse, {
    pathname,
    method,
    guides: [],
    loadIndexHtml: async () => indexHtml,
    sendBody: async (_req, _res, status, headers, body) => {
      sent = { status, headers, body: String(body) };
    }
  });
  return { handled, sent: sent as unknown as { status: number; headers: http.OutgoingHttpHeaders; body: string } };
}

test("ADS-060 titles, descriptions and paths", () => {
  for (const page of [...TOOL_PAGES, TOOLS_INDEX]) {
    assert.ok(page.title.length <= SEO_TITLE_MAX, `${page.title} (${page.title.length}) ≤ 60`);
    assert.ok(page.description.length >= 70 && page.description.length <= 170, `${page.path} description length ${page.description.length}`);
  }
  assert.equal(LIQUIDATION_TOOL.path, "/herramientas/calculadora-de-liquidacion");
  assert.equal(NET_SALARY_TOOL.path, "/herramientas/calculadora-salario-neto");
  assert.equal(isToolsRoute("/herramientas"), true);
  assert.equal(isToolsRoute("/herramientasx"), false);
});

test("ADS-060 each calculator page: full explanation, canonical, JSON-LD and ad marker", () => {
  for (const tool of TOOL_PAGES) {
    const html = renderToolPageHtml(indexHtml, tool, []);
    assert.match(html, new RegExp(`<title>${tool.title.replace(/[|()]/g, "\\$&")}</title>`));
    assert.match(html, new RegExp(`<link rel="canonical" href="https://buscotrabajo.co${tool.path}" />`));
    assert.match(html, /<meta name="description" content="[^"]{70,}"/);
    const body = appHtml(html);
    assert.ok(visibleWords(body) >= 800, `${tool.path}: ${visibleWords(body)} words in the raw HTML`);
    assert.match(body, new RegExp(`<h1>${tool.heading}</h1>`));
    assert.match(body, /no se envía a BuscoTrabajo/, "privacy note in the raw HTML");
    assert.match(body, /no una asesoría legal/, "disclaimer in the raw HTML");
    assert.match(body, /data-tool-noscript/);
    for (const key of tool.sources) assert.ok(body.includes(LABOR_SOURCES[key].url.replace(/&/g, "&amp;")), `${tool.path} links ${key}`);
    const blocks = jsonLd(html);
    const app = blocks.find((block) => block["@type"] === "WebApplication");
    assert.ok(app, "WebApplication JSON-LD");
    assert.equal(app.url, `https://buscotrabajo.co${tool.path}`);
    assert.equal((app.offers as Record<string, unknown>).price, "0");
    assert.ok(!("aggregateRating" in app) && !("review" in app), "no invented ratings");
    const crumbs = blocks.find((block) => block["@type"] === "BreadcrumbList");
    assert.equal((crumbs?.itemListElement as unknown[]).length, 3);
    assert.equal(isMarkedAdEligible(html), true, "original tool page carries the ad marker");
  }
});

test("ADS-060 liquidation page shows the formulas, the norms and a computed example", () => {
  const body = appHtml(renderToolPageHtml(indexHtml, LIQUIDATION_TOOL, []));
  for (const text of ["art. 306", "art. 249", "2.2.1.3.4", "Ley 995 de 2005", "art. 64", "art. 132", "Ley 2466 de 2025", "$1.750.905", "$249.095", "Concepto 328041 de 2021"]) {
    assert.ok(body.includes(text), `mentions ${text}`);
  }
  assert.ok(body.includes("$2.497.726"), "worked example total, computed by the calculator");
});

test("ADS-060 net salary page explains the brackets and says retención is not computed", () => {
  const body = appHtml(renderToolPageHtml(indexHtml, NET_SALARY_TOOL, []));
  for (const text of ["Ley 1122 de 2007", "Decreto 4982 de 2007", "Ley 797 de 2003", "art. 204", "0,2 %", "superiores a 20", "retención en la fuente", "$1.859.928", "$7.280.000"]) {
    assert.ok(body.includes(text), `mentions ${text}`);
  }
  assert.match(body, /no hemos verificado el procedimiento completo/);
});

test("ADS-060 /herramientas index: navigation, no ad marker", () => {
  const html = renderToolsIndexHtml(indexHtml);
  assert.equal(isMarkedAdEligible(html), false, "a list of links is a navigation screen (PP-3)");
  for (const tool of TOOL_PAGES) assert.ok(appHtml(html).includes(`href="${tool.path}"`));
  const types = jsonLd(html).map((block) => block["@type"]);
  assert.ok(types.includes("ItemList") && types.includes("BreadcrumbList"));
  assert.match(html, /<link rel="canonical" href="https:\/\/buscotrabajo.co\/herramientas" \/>/);
});

test("ADS-060 route: HTML, Markdown, real 404 and no POST", async () => {
  const page = await call(LIQUIDATION_TOOL.path);
  assert.equal(page.sent.status, 200);
  assert.match(String(page.sent.headers.Vary), /Accept/);
  const markdown = await call(NET_SALARY_TOOL.path, "text/markdown");
  assert.equal(markdown.sent.status, 200);
  assert.match(String(markdown.sent.headers["Content-Type"]), /text\/markdown/);
  assert.match(markdown.sent.body, /^# Calculadora de salario neto/);
  assert.equal((await call("/herramientas")).sent.status, 200);
  assert.equal((await call("/herramientas/no-existe")).sent.status, 404);
  assert.equal((await call(LIQUIDATION_TOOL.path, "text/html", "POST")).sent.status, 404);
  assert.equal((await call("/dashboard")).handled, false);
});

test("ADS-060 discovery: sitemap, llms.txt, menu and footer", () => {
  const sitemap = read("static/sitemap.xml");
  for (const url of ["/herramientas", LIQUIDATION_TOOL.path, NET_SALARY_TOOL.path]) assert.ok(sitemap.includes(`<loc>https://buscotrabajo.co${url}</loc>`), url);
  assert.match(buildLlmsTxt(false), /\[Herramientas\]\(https:\/\/buscotrabajo\.co\/herramientas\)/);
  assert.match(read("src/sections/Header.tsx"), /label: "Herramientas", to: "\/herramientas"/);
  assert.match(read("src/sections/Footer.tsx"), /label: "Herramientas", href: "\/herramientas"/);
  assert.match(read("src/App.tsx"), /path="\/herramientas\/calculadora-de-liquidacion"/);
});

test("ADS-060 cross-links: guides point to the tools, tools to published guides only", () => {
  const guides = loadGuidesFrom(GUIDES_CONTENT_DIR).filter((guide: Guide) => guide.meta.slug === "liquidacion-del-contrato" || guide.meta.slug === "prestaciones-sociales");
  assert.equal(guides.length, 2);
  for (const guide of guides) {
    assert.equal(toolLinksForGuide(guide.meta.slug).length, 2);
    const html = renderGuidePageHtml(indexHtml, guide);
    assert.ok(html.includes(`href="${LIQUIDATION_TOOL.path}"`) && html.includes(`href="${NET_SALARY_TOOL.path}"`), guide.meta.slug);
  }
  assert.deepEqual(toolLinksForGuide("entrevista-de-trabajo"), []);
  const none = appHtml(renderToolPageHtml(indexHtml, LIQUIDATION_TOOL, []));
  assert.ok(!none.includes("data-related-guides"), "no published guide: no block, never a link to a 404");
  const withGuides = renderToolPageHtml(indexHtml, LIQUIDATION_TOOL, guides);
  assert.match(appHtml(withGuides), /href="\/guias\/liquidacion-del-contrato"/);
  assert.match(withGuides, /window\.__SSR_GUIDE_LINKS__=/);
  assert.deepEqual(toolJsonLd(LIQUIDATION_TOOL, "https://buscotrabajo.co").citation, LIQUIDATION_TOOL.sources.map((key) => LABOR_SOURCES[key].url));
});
