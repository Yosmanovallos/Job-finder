import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARKET_MIN_CELL,
  MARKET_MIN_SALARY_JOBS,
  MARKET_REPORT_INDEX_PATH,
  MARKET_REPORT_PATH,
  buildHomeMarketFigures,
  buildHubComparison,
  buildHomeCityContext,
  buildMarketReportContent,
  buildMarketSnapshot,
  compareMarketSnapshots,
  isMarketSnapshot,
  knownStaticHubTotal,
  marketEditionPath,
  marketReportSitemapEntries,
  marketReportsEnabled,
  parseMarketReportPath,
  previousEdition,
  staticHubRobots,
  type MarketRow,
  type MarketSnapshot
} from "../src/lib/market-report.js";
import { applyJobFilters, CITY_OPTIONS, jobMatchesRole } from "../src/lib/job-filters.js";
import { buildCategoriesSitemapXml, buildCategoryPath, type ResolvedCategory } from "../src/lib/job-seo.js";
import { DEFAULT_ROLES_200 } from "../src/queue/scheduler.js";
import { renderContentHtml, renderContentMarkdown } from "../src/lib/agent-readiness.js";
import { MIN_LISTING_JOBS_FOR_ADS } from "../src/lib/ad-eligibility.js";
import type { Job } from "../src/sources/types.js";

// openspec/changes/adsense-readiness F4 — own data (CX-2, CX-6, SP-2, SP-6,
// AV-1, AV-2). Offline: synthetic rows only, no database, no network.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf-8");
const CUTOFF = new Date("2026-11-14T15:00:00.000Z");
const DAY = 86_400_000;

const CITY_LOCATIONS = ["Bogotá, D.C.", "Medellín, Antioquia", "Cali", "Barranquilla", "Cartagena", "Bucaramanga", "Pereira", "Manizales"];
const TITLES = [
  "Asesor comercial",
  "Auxiliar administrativo",
  "Auxiliar de enfermería",
  "Ejecutivo de ventas",
  "Contador público",
  "Desarrollador full stack",
  "Analista de logística",
  "Diseñador gráfico",
  "Ingeniero industrial",
  "Ingeniero civil"
];
const COMPANIES = ["Acme SAS", "Globex", "Initech", "Umbrella", "Confidencial", "Hooli", "Stark"];
const SOURCES = ["LinkedIn", "Computrabajo", "Elempleo", "Portal oficial", "Magneto"];

// Deterministic spread: every city, title, company, source and modality
// gets a different weight, so the figures differ between hubs.
function syntheticRows(count: number, seed = 1, withSalary = 0): MarketRow[] {
  const rows: MarketRow[] = [];
  for (let i = 0; i < count; i++) {
    const k = i * 7 + seed;
    const cityIndex = (k * k) % (CITY_LOCATIONS.length + 2);
    const location = cityIndex >= CITY_LOCATIONS.length ? (cityIndex % 2 ? "Remoto" : "Colombia") : CITY_LOCATIONS[cityIndex]!;
    rows.push({
      title: TITLES[(k * 3) % TITLES.length]!,
      company: COMPANIES[(k * 5) % COMPANIES.length]!,
      location,
      source: SOURCES[(k * 11) % SOURCES.length]!,
      sources: [SOURCES[(k * 11) % SOURCES.length]!],
      remoteType: k % 9 === 0 ? "remote" : k % 13 === 0 ? "hybrid" : null,
      publishedAt: new Date(CUTOFF.getTime() - ((k % 29) + 0.5) * DAY).toISOString(),
      country: location === "Remoto" ? null : "CO",
      salaryMin: i < withSalary ? 1_500_000 + (i % 10) * 250_000 : null,
      salaryMax: i < withSalary ? 2_000_000 + (i % 10) * 250_000 : null,
      salaryCurrency: i < withSalary ? "COP" : null
    });
  }
  return rows;
}

const asJobs = (rows: MarketRow[]): Job[] =>
  rows.map((row, index) => ({
    jobId: String(index),
    title: row.title,
    company: row.company ?? "Confidencial",
    location: row.location ?? "",
    url: `https://example.com/${index}`,
    dateText: "",
    source: row.source,
    sources: row.sources,
    country: row.country,
    remoteType: row.remoteType ?? undefined,
    publishedAt: row.publishedAt
  })) as Job[];

async function snapshotOf(rows: MarketRow[], cutoff = CUTOFF): Promise<MarketSnapshot> {
  return buildMarketSnapshot(rows, { country: "CO", cutoff });
}

test("ADS-050 snapshot figures are computed from the rows with the dashboard's own filters", async () => {
  const rows = syntheticRows(900);
  const snapshot = await snapshotOf(rows);
  const jobs = asJobs(rows);
  assert.equal(snapshot.total, rows.length);
  assert.equal(snapshot.cutoff, CUTOFF.toISOString());
  assert.equal(snapshot.period, "2026-11");
  assert.equal(snapshot.cityHubs, CITY_OPTIONS.length);
  // Cities: every CO city hub, counted with the hub's own filter; groups
  // under the minimum cell are absent (suppressed), never rounded.
  for (const label of CITY_OPTIONS) {
    const expected = applyJobFilters(jobs, { cities: [label], country: "CO" }).length;
    const entry = snapshot.cities.find((city) => city.label === label);
    if (expected >= MARKET_MIN_CELL) assert.equal(entry?.count, expected, label);
    else assert.equal(entry, undefined, `${label} (${expected}) is suppressed`);
  }
  // Roles: the same matcher as the role hubs and the role filter.
  assert.ok(snapshot.roles.length > 0);
  for (const label of DEFAULT_ROLES_200) {
    const expected = jobs.filter((job) => jobMatchesRole(label, job)).length;
    const entry = snapshot.roles.find((role) => role.label === label);
    if (expected >= MARKET_MIN_CELL) assert.equal(entry?.count, expected, label);
    else assert.equal(entry, undefined, label);
  }
  for (let i = 1; i < snapshot.cities.length; i++) assert.ok(snapshot.cities[i - 1]!.count >= snapshot.cities[i]!.count);
  const official = rows.filter((row) => row.source === "Portal oficial" || row.sources.includes("Portal oficial")).length;
  assert.equal(snapshot.official, official >= MARKET_MIN_CELL ? official : null);
  const modalitySum = Object.values(snapshot.modalities).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  assert.ok(modalitySum <= snapshot.total);
  assert.ok(!snapshot.companies.some((company) => /confidencial/i.test(company.label)));
  assert.ok(snapshot.companies.length <= 10);
  assert.equal(snapshot.last7Days, rows.filter((row) => CUTOFF.getTime() - Date.parse(row.publishedAt) <= 7 * DAY).length);
  assert.equal(isMarketSnapshot(JSON.parse(JSON.stringify(snapshot))), true);
  assert.equal(isMarketSnapshot({ ...snapshot, total: "9" }), false);
});

test("ADS-051 aggregates only: small groups suppressed, no URLs, ids or personal data", async () => {
  // 25 rows: every city, role and company group is under the minimum cell.
  const tiny = await snapshotOf(syntheticRows(25).map((row) => ({ ...row, company: "Persona Natural Pérez" })));
  assert.deepEqual(tiny.cities, []);
  assert.deepEqual(tiny.roles, []);
  assert.ok(tiny.companies.every((company) => company.count >= MARKET_MIN_CELL));
  for (const value of [tiny.official, tiny.withoutCity, tiny.salaryJobs, ...Object.values(tiny.modalities)]) {
    assert.ok(value === null || value >= MARKET_MIN_CELL);
  }
  const serialized = JSON.stringify(await snapshotOf(syntheticRows(900, 1, 120)));
  assert.doesNotMatch(serialized, /https?:|@|example\.com|"jobId"|"url"|"id"/);
  assert.ok(Array.isArray(tiny.methodology) && tiny.methodology.length >= 3, "methodology travels with the data");
  // A hand-edited file with a group under the minimum cell is rejected.
  const big = await snapshotOf(syntheticRows(900));
  assert.equal(isMarketSnapshot({ ...big, cities: [{ label: "Bogotá", count: 3 }] }), false);
  assert.equal(isMarketSnapshot({ ...big, official: 4 }), false);
});

test("ADS-052 a figure without enough coverage is «sin datos suficientes», never a guess", async () => {
  const thin = await snapshotOf(syntheticRows(400, 1, MARKET_MIN_SALARY_JOBS - 1));
  assert.equal(thin.salary, null);
  assert.match(renderContentMarkdown(buildMarketReportContent(thin, null)), /Sin datos suficientes para dar un salario típico/);
  const covered = await snapshotOf(syntheticRows(400, 1, 120));
  assert.ok(covered.salary);
  assert.equal(covered.salary!.currency, "COP");
  assert.equal(covered.salary!.jobs, 120);
  assert.ok(covered.salary!.p25 <= covered.salary!.median && covered.salary!.median <= covered.salary!.p75);
});

test("ADS-053 month-over-month variation needs an earlier edition", async () => {
  const current = await snapshotOf(syntheticRows(900));
  assert.equal(compareMarketSnapshots(current, null), null);
  const first = renderContentMarkdown(buildMarketReportContent(current, null));
  assert.match(first, /## Variación respecto al mes anterior\n\nSin datos suficientes/);
  const previous = await snapshotOf(syntheticRows(600, 3), new Date("2026-10-31T23:00:00.000Z"));
  const comparison = compareMarketSnapshots(current, previous);
  assert.ok(comparison);
  assert.equal(comparison!.totalDelta, current.total - previous.total);
  assert.equal(comparison!.previousPeriod, "2026-10");
  assert.equal(compareMarketSnapshots(current, current), null);
  assert.equal(compareMarketSnapshots(previous, current), null);
  const second = renderContentMarkdown(buildMarketReportContent(current, previous, ["2026-11", "2026-10"]));
  assert.match(second, /octubre de 2026/);
  assert.ok(second.includes(`+${(current.total - previous.total).toLocaleString("es-CO")}`));
  assert.ok(second.includes(marketEditionPath("2026-10")));
  assert.equal(previousEdition([current, previous], "2026-11"), previous);
  assert.equal(previousEdition([current, previous], "2026-10"), null);
});

test("ADS-054 the report states cutoff, methodology and limits, and every figure follows the data", async () => {
  const a = await snapshotOf(syntheticRows(900));
  const b = await snapshotOf(syntheticRows(700, 5));
  const contentA = buildMarketReportContent(a, null);
  assert.equal(contentA.pathname, "/informes/empleo-colombia-2026-11");
  const html = renderContentHtml(contentA);
  const markdown = renderContentMarkdown(contentA);
  for (const text of [/Fecha de corte/, /## Metodología/, /## Límites/, /14 de noviembre de 2026/, /\/metodologia/]) assert.match(markdown, text);
  for (const paragraph of a.methodology) assert.ok(markdown.includes(paragraph), "methodology comes from the snapshot");
  assert.ok(markdown.includes(a.total.toLocaleString("es-CO")));
  const words = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 400, `report words: ${words}`);
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
  assert.equal(levels.filter((level) => level === 1).length, 1);
  assert.notEqual(markdown, renderContentMarkdown(buildMarketReportContent(b, null)));
  // A count in the copy is always interpolated, never a literal.
  assert.doesNotMatch(read("src/lib/market-report.ts"), /[^{}(]\b\d+\s+(vacantes|empresas|ofertas)\b/);
});

const HUB_CATEGORIES: ResolvedCategory[] = [
  ...CITY_OPTIONS.map((label) => ({ kind: "ciudad" as const, label, country: "CO" })),
  ...DEFAULT_ROLES_200.map((label) => ({ kind: "rol" as const, label, country: "CO" }))
];

test("ADS-055 every indexable hub gets its own computed comparison, never a repeated one", async () => {
  const rows = syntheticRows(3000);
  const national = await snapshotOf(rows);
  const jobs = asJobs(rows);
  const paragraphs = new Map<string, string>();
  for (const category of HUB_CATEGORIES) {
    const filters = category.kind === "ciudad" ? { cities: [category.label], country: "CO" } : { roles: [category.label], country: "CO" };
    const matched = applyJobFilters(jobs, filters);
    if (matched.length < MIN_LISTING_JOBS_FOR_ADS) continue;
    const text = buildHubComparison({ category, total: matched.length, jobs: matched.slice(0, 60), national });
    assert.ok(text, `${category.kind}:${category.label}`);
    assert.ok(text!.includes(category.label), `${category.label} names itself`);
    assert.match(text!, /%/);
    assert.ok(!paragraphs.has(text!), `duplicate paragraph for ${category.label}`);
    paragraphs.set(text!, category.label);
  }
  assert.ok(paragraphs.size >= 10, `indexable hubs compared: ${paragraphs.size}`);
  assert.equal(buildHubComparison({ category: HUB_CATEGORIES[0]!, total: 50, jobs: [], national: undefined }), null);
  assert.equal(buildHubComparison({ category: { kind: "ciudad", label: "Caracas", country: "VE" }, total: 50, jobs: [], national }), null);
});

test("ADS-056 small hubs stay noindex, out of the sitemap and without ads", async () => {
  assert.equal(staticHubRobots(0), "noindex,follow");
  assert.equal(staticHubRobots(MIN_LISTING_JOBS_FOR_ADS - 1), "noindex,follow");
  assert.equal(staticHubRobots(MIN_LISTING_JOBS_FOR_ADS), null);
  const snapshot = await snapshotOf(syntheticRows(900));
  const big = snapshot.roles[0]!;
  const small = DEFAULT_ROLES_200.find((role) => !snapshot.roles.some((entry) => entry.label === role))!;
  const known = (category: ResolvedCategory) => knownStaticHubTotal(category.country === "CO" ? snapshot : undefined, category);
  assert.equal(known({ kind: "rol", label: small, country: "CO" }), 0);
  assert.equal(known({ kind: "rol", label: big.label, country: "VE" }), undefined);
  const xml = buildCategoriesSitemapXml({ knownTotal: known });
  const loc = (category: ResolvedCategory) => `<loc>https://buscotrabajo.co${buildCategoryPath(category)}</loc>`;
  assert.ok(xml.includes(loc({ kind: "rol", label: big.label, country: "CO" })));
  assert.ok(!xml.includes(loc({ kind: "rol", label: small, country: "CO" })), small);
  assert.ok(xml.includes(loc({ kind: "rol", label: small, country: "VE" })), "unknown stays listed");
  assert.equal(buildCategoriesSitemapXml({ knownTotal: () => undefined }), buildCategoriesSitemapXml());
  const server = read("src/server.ts");
  assert.match(server, /staticHubRobots\(total\)/, "plain hubs use the inventory guard");
  assert.match(server, /knownTotal: knownHubTotalFromEditions/, "the sitemap uses the editions");
});

test("ADS-057 the home's city and role blocks carry a figure and context", async () => {
  const context = buildHomeCityContext({ "Bogotá": 400, "Medellín": 150, "Cali": null }, 1000, "Colombia");
  assert.ok(context);
  assert.match(context!, /Bogotá/);
  assert.match(context!, /40 %/);
  assert.equal(buildHomeCityContext({}, null, "Colombia"), null);
  const snapshot = await snapshotOf(syntheticRows(900));
  const figures = buildHomeMarketFigures(snapshot, ["Asesor comercial", "Rol inexistente"]);
  assert.equal(figures?.roleCounts["Asesor comercial"], snapshot.roles.find((role) => role.label.toLowerCase() === "asesor comercial")?.count);
  assert.equal(typeof figures?.roleCounts["Asesor comercial"], "number", "home labels match the taxonomy without case");
  assert.equal(figures?.roleCounts["Rol inexistente"], undefined);
  assert.equal(buildHomeMarketFigures(undefined, ["Asesor comercial"]), null);
  const landing = read("src/sections/HomeLanding.tsx");
  assert.match(landing, /buildHomeCityContext/, "city section explains its figures");
  assert.match(landing, /roleCounts/, "role links show their counts");
  assert.match(landing, /MARKET_REPORT_INDEX_PATH/, "the home links the reports");
  assert.match(landing, /roles\.map\(\(role, i\) => \(\s*<Link/, "no role link removed");
});

test("ADS-058 report routes, switch, sitemap and no ad marker", () => {
  assert.deepEqual(parseMarketReportPath(MARKET_REPORT_INDEX_PATH), { kind: "index" });
  assert.deepEqual(parseMarketReportPath(MARKET_REPORT_PATH), { kind: "latest" });
  assert.deepEqual(parseMarketReportPath("/informes/empleo-colombia-2026-10"), { kind: "edition", period: "2026-10" });
  for (const bad of ["/informes/empleo-colombia-2026-13", "/informes/empleo-venezuela", "/informes/x", "/informes/empleo-colombia-26-10"]) {
    assert.equal(parseMarketReportPath(bad), null, bad);
  }
  assert.equal(marketReportsEnabled({}), true);
  assert.equal(marketReportsEnabled({ REPORTS_ENABLED: "false" }), false);
  assert.equal(marketReportsEnabled({ REPORTS_ENABLED: "0" }), false);
  assert.deepEqual(marketReportSitemapEntries(true, []), [], "no thin empty index in the sitemap");
  assert.deepEqual(marketReportSitemapEntries(false, ["2026-11"]), []);
  assert.deepEqual(marketReportSitemapEntries(true, ["2026-11"]), [MARKET_REPORT_INDEX_PATH, "/informes/empleo-colombia-2026-11"]);
  const server = read("src/server.ts");
  assert.match(server, /marketReportSitemapEntries\(/);
  assert.match(read("src/sections/Footer.tsx"), /\/informes/);
  assert.match(read("src/App.tsx"), /path="\/informes/);
  const start = server.indexOf("// F4 market report routes");
  const end = server.indexOf("// end F4 market report routes");
  assert.ok(start > 0 && end > start, "report routes are delimited");
  assert.doesNotMatch(server.slice(start, end), /markAdEligible/);
});

test("ADS-059 nothing on the request path queries the database for the report", async () => {
  const server = read("src/server.ts");
  const start = server.indexOf("// F4 market report routes");
  const end = server.indexOf("// end F4 market report routes");
  assert.doesNotMatch(server.slice(start, end), /pool\.|getJobsPage|getIntentPage|queryMarketRows/);
  assert.doesNotMatch(server, /queryMarketRows/, "only the script reads the rows");
  assert.match(server, /buildHubComparison\(\{[^}]*national:\s*latestMarketSnapshot\(/);
  assert.doesNotMatch(read("src/server/market-reports.ts"), /from "\.\.\/db\//);
  const script = read("scripts/build-market-report.ts");
  assert.match(script, /BEGIN READ ONLY/);
  assert.match(script, /statement_timeout/);
  assert.match(script, /--dry-run/);
  assert.doesNotMatch(script, /\b(INSERT|UPDATE|DELETE)\b/);
  const repo = read("src/db/job-repository.ts");
  const query = repo.slice(repo.indexOf("export async function queryMarketRows"), repo.indexOf("export interface CompanyGroup"));
  assert.ok(query.length > 100);
  assert.doesNotMatch(query, /\b(INSERT|UPDATE|DELETE)\b|\burl\b|description/);
  // 40k rows aggregate without blocking the event loop for long stretches.
  const rows = syntheticRows(40_000);
  let longest = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 1);
  const snapshot = await buildMarketSnapshot(rows, { country: "CO", cutoff: CUTOFF });
  clearInterval(timer);
  assert.equal(snapshot.total, 40_000);
  assert.ok(longest < 400, `longest event-loop block: ${Math.round(longest)} ms`);
});

