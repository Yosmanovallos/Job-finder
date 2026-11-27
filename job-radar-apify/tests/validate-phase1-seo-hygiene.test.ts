import "../src/server/react-global.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { AuthProvider } from "../src/auth/auth-provider.js";
import { SOURCES_BY_COUNTRY } from "../src/countries/index.js";
import { coDepartmentFor, isCoDepartment } from "../src/lib/co-departments.js";
import type { HomeData } from "../src/lib/home-stats.js";
import Header, { getCountryTargetHref } from "../src/sections/Header.js";
import { renderHomeAppHtml } from "../src/server/home-ssr.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function sampleHomeData(country: "CO" | "VE"): HomeData {
  return {
    totalJobs: 420,
    last7Days: 140,
    last24Hours: 24,
    onSite: 300,
    remote: 120,
    totalCompanies: 65,
    cityCounts: country === "VE" ? { Caracas: 180, Valencia: 60 } : { Bogotá: 210, Medellín: 95 },
    latestJobs: [],
    companies: [],
    market: null
  };
}

test("Phase 1: index.html and golden fixtures share idle-scheduled third-party loader with 600ms AdSense stagger", () => {
  const readLoader = (relPath: string) => {
    const html = fs.readFileSync(path.join(root, relPath), "utf-8");
    const marker = "function inject(src, crossOrigin)";
    const start = html.lastIndexOf("<script>", html.indexOf(marker));
    const end = html.indexOf("</script>", html.indexOf(marker)) + "</script>".length;
    assert.ok(start >= 0 && end > start, `${relPath} missing third-party loader block`);
    return html.slice(start, end);
  };

  const indexLoader = readLoader("index.html");
  assert.match(indexLoader, /requestIdleCallback/);
  assert.match(indexLoader, /function scheduleLoad\(\)/);
  assert.match(indexLoader, /setTimeout\(function \(\) \{\s*inject\("https:\/\/pagead2\.googlesyndication\.com[\s\S]*?\}, 600\)/);
  assert.ok(
    indexLoader.indexOf('meta[name="bt-ads"][content="on"]') < indexLoader.indexOf("adsbygoogle.js"),
    "bt-ads meta check must precede adsbygoogle.js injection"
  );

  for (const fixture of [
    "tests/fixtures/job-page-golden/official.html",
    "tests/fixtures/job-page-golden/third-party.html"
  ]) {
    assert.equal(readLoader(fixture), indexLoader, `${fixture} loader must match index.html byte-for-byte`);
  }
});

test("Phase 1: category hubs are isolated from dashboard 64-entry jobsPageCache", () => {
  const repo = fs.readFileSync(path.join(root, "src/db/job-repository.ts"), "utf-8");
  const server = fs.readFileSync(path.join(root, "src/server.ts"), "utf-8");
  assert.match(repo, /const CATEGORY_HUB_CACHE_ENTRIES = 120;/);
  assert.match(repo, /export async function getCategoryHubPage\(/);
  assert.match(repo, /export function peekCategoryHubPage\(/);
  assert.match(server, /getCategoryHubPage\(\{/);
  assert.match(server, /peekCategoryHubPage\(\{/);
  assert.doesNotMatch(server, /\bpeekJobsPage\(/);
});

test("Phase 1: stale sitemap fallback is time-bounded and category 404/410 + /informes SSR use private, no-store", () => {
  const server = fs.readFileSync(path.join(root, "src/server.ts"), "utf-8");
  assert.match(server, /lastGoodJobsSitemapAt/);
  assert.match(server, /MAX_STALE_SITEMAP_AGE_MS\s*=\s*60\s*\*\s*60_000/);
  assert.match(server, /sendLastGoodSitemap[\s\S]*?Date\.now\(\)\s*-\s*lastGoodJobsSitemapAt\s*>\s*MAX_STALE_SITEMAP_AGE_MS/);
  assert.match(server, /RETIRED_ROLE_SLUGS\.has[\s\S]{0,200}"Cache-Control": "private, no-store"/);
  assert.match(server, /isGuardedCity && !empleosCoverageEnabled\(\)[\s\S]{0,200}"Cache-Control": "private, no-store"/);
  assert.match(server, /sendBody\(req, res, 404, \{ "Content-Type": "text\/html; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Accept" \}, NOT_FOUND_HTML\)/);
  assert.match(server, /sendBody\(req, res, 200, \{ "Content-Type": "text\/html; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Accept" \}, html\)/);
});

test("Phase 1: Remotive removed from SOURCES_BY_COUNTRY for CO and VE", () => {
  assert.equal(SOURCES_BY_COUNTRY.CO.includes("Remotive"), false);
  assert.equal(SOURCES_BY_COUNTRY.VE.includes("Remotive"), false);
});

test("Phase 1: Header country switcher preserves /empleos and /empleos/remoto across CO and VE", () => {
  assert.equal(getCountryTargetHref("/empleos", "VE"), "/ve/empleos");
  assert.equal(getCountryTargetHref("/empleos/remoto", "VE"), "/ve/empleos/remoto");
  assert.equal(getCountryTargetHref("/ve/empleos", "CO"), "/empleos");
  assert.equal(getCountryTargetHref("/ve/empleos/remoto", "CO"), "/empleos/remoto");
  assert.equal(getCountryTargetHref("/empleos/bogota", "VE"), "/ve/dashboard");

  const renderHeaderAt = (pathname: string) =>
    renderToString(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(StaticRouter, { location: pathname }, React.createElement(Header))
      )
    );

  assert.match(renderHeaderAt("/empleos"), /href="\/empresas"/);
  assert.match(renderHeaderAt("/ve/empleos"), /href="\/ve\/empresas"/);
});

test("Phase 1: Home SSR renders CO intent links, fixes VE remote card, scopes Footer, and hides Remotive", () => {
  const stripComments = (html: string) => html.replace(/<!--\s*-->/g, "");
  const extractFooter = (html: string) => {
    const start = html.indexOf('<footer id="footer"');
    const end = html.indexOf("</footer>", start);
    assert.ok(start >= 0 && end > start, "missing rendered <footer>");
    return stripComments(html.slice(start, end + "</footer>".length));
  };

  const coHtml = stripComments(
    renderHomeAppHtml("/", {
      country: "CO",
      data: sampleHomeData("CO"),
      desktop: true,
      now: "2026-11-26T12:00:00Z"
    })
  );
  const coFooter = extractFooter(coHtml);
  assert.match(coHtml, /aria-label="Búsquedas por intención"/);
  assert.match(coHtml, /href="\/empleos\/sin-experiencia"/);
  assert.match(coHtml, /href="\/empleos\/medio-tiempo"/);
  assert.match(coHtml, /href="\/empleos\/fines-de-semana"/);
  assert.match(coHtml, /href="\/empleos\/temporada"/);
  assert.match(coFooter, /href="\/empleos"/);
  assert.match(coFooter, /href="\/empresas"/);
  assert.match(coFooter, /Todas las ofertas de empleo de Colombia en un solo lugar\. Gratis\./);
  assert.doesNotMatch(coHtml, /Remotive/);

  const veHtml = stripComments(
    renderHomeAppHtml("/ve", {
      country: "VE",
      data: sampleHomeData("VE"),
      desktop: true,
      now: "2026-11-26T12:00:00Z"
    })
  );
  const veFooter = extractFooter(veHtml);
  assert.match(veHtml, /href="\/ve\/empleos\/remoto"[\s\S]{0,300}\/ve\/empleos\/remoto/);
  assert.doesNotMatch(veHtml, /aria-label="Búsquedas por intención"/);
  assert.match(veFooter, /href="\/ve\/empleos"/);
  assert.match(veFooter, /href="\/ve\/empresas"/);
  assert.match(veFooter, /Todas las ofertas de empleo de Venezuela en un solo lugar\. Gratis\./);
  assert.doesNotMatch(veFooter, /href="\/guias"/);
  assert.doesNotMatch(veHtml, /Remotive/);
});

test("Phase 1: Bosconia maps to Cesar and isCoDepartment distinguishes departments from metro areas", () => {
  assert.equal(coDepartmentFor("Bosconia"), "Cesar");
  assert.equal(isCoDepartment("Cesar"), true);
  assert.equal(isCoDepartment("Antioquia"), true);
  assert.equal(isCoDepartment("Bogotá, D.C."), true);
  assert.equal(isCoDepartment("Capital District"), true);
  assert.equal(isCoDepartment("Bogotá"), false);
  assert.equal(isCoDepartment("Valle de Aburrá"), false);
});
