import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AD_ELIGIBLE_META,
  MIN_LISTING_JOBS_FOR_ADS,
  isAdEligibleJobPage,
  isAdEligibleListing,
  isMarkedAdEligible,
  markAdEligible
} from "../src/lib/ad-eligibility.js";
import { serverSectionsFor, withServerText } from "../src/lib/route-server-text.js";
import { ROUTE_META } from "../src/lib/page-meta.js";
import { LEGAL_CONTENT } from "../src/lib/legal-content.js";
import { buildFaqItems } from "../src/lib/faq-content.js";
import { PROCESS_STEPS } from "../src/lib/process-steps.js";
import { PUBLIC_PAGES, injectRouteMeta, renderContentHtml } from "../src/lib/agent-readiness.js";

// openspec/changes/adsense-readiness — offline checks for F1 (ads only on
// publisher content, full text in the raw HTML, one privacy story).
const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.join(here, "..", "index.html"), "utf-8");
const words = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").split(/\s+/).filter(Boolean).length;
const appHtml = (html: string) => /<div id="app">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? "";

test("ADS-010 the shell loads AdSense only behind the server marker", () => {
  const loader = indexHtml.slice(indexHtml.indexOf("function loadThirdParties"));
  const adsCall = loader.indexOf("adsbygoogle.js");
  const guard = loader.indexOf('meta[name="bt-ads"][content="on"]');
  assert.ok(adsCall > 0, "loader still knows the AdSense URL");
  assert.ok(guard > 0 && guard < adsCall, "the marker check runs before the AdSense injection");
  assert.equal(isMarkedAdEligible(indexHtml), false, "the shell itself is never eligible");
  assert.match(indexHtml, /googletagmanager\.com\/gtag\/js/, "analytics loading is unchanged");
  assert.match(indexHtml, /name="google-adsense-account"/, "site verification meta stays on every page");
});

test("ADS-010 marker is added once and only to <head>", () => {
  const marked = markAdEligible(indexHtml);
  assert.equal(isMarkedAdEligible(marked), true);
  assert.equal(markAdEligible(marked), marked);
  assert.ok(marked.indexOf(AD_ELIGIBLE_META) < marked.indexOf("</head>"));
});

test("ADS-010 job pages: only the employer's own, Google-ready vacancy", () => {
  assert.equal(isAdEligibleJobPage({ source: "Portal oficial" }, true), true);
  assert.equal(isAdEligibleJobPage({ source: "Portal oficial" }, false), false);
  for (const source of ["LinkedIn", "Computrabajo", "Elempleo", "Magneto", "Workana", null]) {
    assert.equal(isAdEligibleJobPage({ source }, true), false, String(source));
  }
});

test("ADS-010 listings: indexable and at least the inventory guard", () => {
  assert.equal(isAdEligibleListing(MIN_LISTING_JOBS_FOR_ADS, null), true);
  assert.equal(isAdEligibleListing(MIN_LISTING_JOBS_FOR_ADS - 1, null), false);
  assert.equal(isAdEligibleListing(0, null), false);
  assert.equal(isAdEligibleListing(500, "noindex,follow"), false);
  assert.equal(isAdEligibleListing(500, "noindex"), false);
  assert.equal(isAdEligibleListing(null, null), false);
  assert.equal(isAdEligibleListing(Number.NaN, null), false);
});

test("ADS-010 utility and policy pages are never marked", () => {
  for (const [pathname, meta] of Object.entries(ROUTE_META)) {
    const html = injectRouteMeta(indexHtml, pathname, withServerText(pathname, meta));
    assert.equal(isMarkedAdEligible(html), false, pathname);
  }
});

test("ADS-015 legal pages carry every section in the raw HTML", () => {
  for (const [type, page] of Object.entries(LEGAL_CONTENT)) {
    const pathname = `/legal/${type}`;
    const html = injectRouteMeta(indexHtml, pathname, withServerText(pathname, ROUTE_META[pathname]!));
    const app = appHtml(html);
    assert.match(app, new RegExp(`Última actualización: ${page.updated}`), pathname);
    for (const section of page.sections) {
      assert.ok(app.includes(`<h2>${section.title}</h2>`), `${pathname}: ${section.title}`);
      for (const paragraph of section.paragraphs) {
        const sample = paragraph.slice(0, 40).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        assert.ok(app.includes(sample), `${pathname}: «${paragraph.slice(0, 40)}»`);
      }
    }
    assert.ok(words(app) >= 80, `${pathname} has ${words(app)} words`);
  }
});

test("ADS-015 /preguntas carries every question and answer", () => {
  const html = injectRouteMeta(indexHtml, "/preguntas", withServerText("/preguntas", ROUTE_META["/preguntas"]!));
  const app = appHtml(html);
  const items = buildFaqItems("CO");
  assert.ok(items.length >= 6);
  for (const item of items) {
    assert.ok(app.includes(item.question), item.question);
    assert.ok(app.includes(item.answer.slice(0, 50)), item.id);
  }
  assert.ok(words(app) >= 150, `/preguntas has ${words(app)} words`);
});

test("ADS-015 /como-funciona carries every step", () => {
  const html = injectRouteMeta(indexHtml, "/como-funciona", withServerText("/como-funciona", ROUTE_META["/como-funciona"]!));
  const app = appHtml(html);
  for (const step of PROCESS_STEPS) {
    assert.ok(app.includes(step.title), step.title);
    assert.ok(app.includes(step.description.slice(0, 40)), step.number);
  }
});

test("ADS-015 routes without extra text keep their previous HTML", () => {
  for (const pathname of ["/login", "/cuenta", "/opiniones", "/fuentes", "/legal/otra"]) {
    assert.equal(serverSectionsFor(pathname), null, pathname);
  }
  const meta = ROUTE_META["/login"]!;
  assert.equal(injectRouteMeta(indexHtml, "/login", withServerText("/login", meta)), injectRouteMeta(indexHtml, "/login", meta));
});

test("ADS-018 the privacy summary and the policy tell the same payment story", () => {
  const summary = renderContentHtml(PUBLIC_PAGES["/privacy"]!);
  const policy = LEGAL_CONTENT.privacidad.sections.flatMap((s) => s.paragraphs).join(" ");
  assert.match(policy, /no procesamos pagos/);
  assert.match(summary, /no procesa pagos/);
  assert.doesNotMatch(summary, /conserva el estado de suscripción, el historial de transacciones procesadas con Wompi/);
  assert.match(policy, /Google AdSense/);
  assert.match(policy, /adssettings\.google\.com/);
});
