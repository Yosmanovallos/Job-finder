import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARKET_MIN_SALARY_JOBS,
  MARKET_REPORT_PATH,
  buildHubComparison,
  buildHomeCityContext,
  buildMarketReportContent,
  buildMarketSnapshot,
  compareMarketSnapshots,
  isMarketSnapshot,
  knownStaticHubTotal,
  marketReportsEnabled,
  parseMarketReportPath,
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
  // Cities: every CO city hub, counted with the hub's own filter.
  assert.deepEqual(
    snapshot.cities.map((city) => city.label).sort(),
    [...CITY_OPTIONS].sort()
  );
  for (const city of snapshot.cities) {
    const expected = applyJobFilters(jobs, { cities: [city.label], country: "CO" }).length;
    assert.equal(city.count, expected, city.label);
    assert.equal(city.path, buildCategoryPath({ kind: "ciudad", label: city.label, country: "CO" }));
  }
  // Roles: the same matcher as the role hubs and the role filter.
  for (const role of snapshot.roles) {
    assert.ok(DEFAULT_ROLES_200.includes(role.label), role.label);
    assert.equal(role.count, jobs.filter((job) => jobMatchesRole(role.label, job)).length, role.label);
  }
  assert.ok(snapshot.roles.length > 0);
  // Sorted, biggest first.
  for (let i = 1; i < snapshot.cities.length; i++) assert.ok(snapshot.cities[i - 1]!.count >= snapshot.cities[i]!.count);
  // Official share: the employer's own careers site, primary or merged source.
  assert.equal(snapshot.official, rows.filter((row) => row.source === "Portal oficial" || row.sources.includes("Portal oficial")).length);
  // Modalities add up to the total.
  assert.equal(Object.values(snapshot.modalities).reduce((sum, value) => sum + value, 0), snapshot.total);
  // Placeholder employers are never a company of the ranking.
  assert.ok(!snapshot.companies.some((company) => /confidencial/i.test(company.label)));
  assert.ok(snapshot.companies.length <= 10);
  assert.equal(snapshot.last7Days, rows.filter((row) => CUTOFF.getTime() - Date.parse(row.publishedAt) <= 7 * DAY).length);
  assert.equal(isMarketSnapshot(JSON.parse(JSON.stringify(snapshot))), true);
  assert.equal(isMarketSnapshot({ ...snapshot, total: "9" }), false);
});

test("ADS-051 a figure without enough coverage is «sin datos suficientes», never a guess", async () => {
  const thin = await snapshotOf(syntheticRows(400, 1, MARKET_MIN_SALARY_JOBS - 1));
  assert.equal(thin.salary, null);
  assert.equal(thin.salaryJobs, MARKET_MIN_SALARY_JOBS - 1);
  const thinText = renderContentMarkdown(buildMarketReportContent(thin, null, { pathname: MARKET_REPORT_PATH, frozen: false }));
  assert.match(thinText, /sin datos suficientes/i);

  const covered = await snapshotOf(syntheticRows(400, 1, 120));
  assert.ok(covered.salary);
  assert.equal(covered.salary!.currency, "COP");
  assert.equal(covered.salary!.jobs, 120);
  assert.ok(covered.salary!.p25 <= covered.salary!.median && covered.salary!.median <= covered.salary!.p75);
});

test("ADS-052 month-over-month variation needs a previous snapshot", async () => {
  const current = await snapshotOf(syntheticRows(900));
  assert.equal(compareMarketSnapshots(current, null), null);
  const noPrevious = renderContentMarkdown(buildMarketReportContent(current, null, { pathname: MARKET_REPORT_PATH, frozen: false }));
  assert.match(noPrevious, /Variación[\s\S]*sin datos suficientes/i);

  const previous = await snapshotOf(syntheticRows(600, 3), new Date("2026-10-31T23:00:00.000Z"));
  const comparison = compareMarketSnapshots(current, previous);
  assert.ok(comparison);
  assert.equal(comparison!.totalDelta, current.total - previous.total);
  assert.equal(comparison!.previousPeriod, "2026-10");
  // Same period or a later "previous" is not a comparison.
  assert.equal(compareMarketSnapshots(current, current), null);
  assert.equal(compareMarketSnapshots(previous, current), null);
  const withPrevious = renderContentMarkdown(buildMarketReportContent(current, previous, { pathname: MARKET_REPORT_PATH, frozen: false }));
  assert.match(withPrevious, /octubre de 2026/);
  assert.match(withPrevious, new RegExp(`\\+${(current.total - previous.total).toLocaleString("es-CO")}`));
});

test("ADS-053 the report states cutoff, methodology and limits, and every figure follows the data", async () => {
  const a = await snapshotOf(syntheticRows(900));
  const b = await snapshotOf(syntheticRows(700, 5));
  const contentA = buildMarketReportContent(a, null, { pathname: MARKET_REPORT_PATH, frozen: false });
  const contentB = buildMarketReportContent(b, null, { pathname: MARKET_REPORT_PATH, frozen: false });
  const html = renderContentHtml(contentA);
  const markdown = renderContentMarkdown(contentA);
  for (const text of [/Fecha de corte/i, /Metodología/i, /Límites/i, /14 de noviembre de 2026/]) assert.match(markdown, text);
  assert.match(markdown, new RegExp(a.total.toLocaleString("es-CO")));
  assert.match(markdown, /\/metodologia/);
  // Substantial text in the raw HTML, one h1, sequential headings.
  const words = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 400, `report words: ${words}`);
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
  assert.equal(levels.filter((level) => level === 1).length, 1);
  // No figure is written by hand: other data, other numbers.
  assert.notEqual(renderContentMarkdown(contentA), renderContentMarkdown(contentB));
  const source = read("src/lib/market-report.ts");
  // A count in the copy is always interpolated (`${integer(n)} vacantes`), never a literal.
  assert.doesNotMatch(source, /[^{}(]\b\d+\s+(vacantes|empresas|ofertas)\b/, "no literal counts in the copy");
});

const HUB_CATEGORIES: ResolvedCategory[] = [
  ...CITY_OPTIONS.map((label) => ({ kind: "ciudad" as const, label, country: "CO" })),
  ...DEFAULT_ROLES_200.map((label) => ({ kind: "rol" as const, label, country: "CO" }))
];

test("ADS-054 every indexable hub gets its own computed comparison, never a repeated one", async () => {
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
  // Without national figures there is no comparison (never a guess).
  assert.equal(buildHubComparison({ category: HUB_CATEGORIES[0]!, total: 50, jobs: [], national: undefined }), null);
  // VE hub against a CO snapshot: no comparison.
  assert.equal(buildHubComparison({ category: { kind: "ciudad", label: "Caracas", country: "VE" }, total: 50, jobs: [], national }), null);
});

test("ADS-055 small hubs stay noindex, out of the sitemap and without ads", async () => {
  assert.equal(staticHubRobots(0), "noindex,follow");
  assert.equal(staticHubRobots(MIN_LISTING_JOBS_FOR_ADS - 1), "noindex,follow");
  assert.equal(staticHubRobots(MIN_LISTING_JOBS_FOR_ADS), null);
  const snapshot = await snapshotOf(syntheticRows(900));
  const small = snapshot.roles.find((role) => role.count > 0 && role.count < MIN_LISTING_JOBS_FOR_ADS);
  const big = snapshot.roles.find((role) => role.count >= MIN_LISTING_JOBS_FOR_ADS)!;
  const known = (category: ResolvedCategory) => knownStaticHubTotal(category.country === "CO" ? snapshot : undefined, category);
  const xml = buildCategoriesSitemapXml({ knownTotal: known });
  const loc = (category: ResolvedCategory) => `<loc>https://buscotrabajo.co${buildCategoryPath(category)}</loc>`;
  assert.ok(xml.includes(loc({ kind: "rol", label: big.label, country: "CO" })));
  if (small) assert.ok(!xml.includes(loc({ kind: "rol", label: small.label, country: "CO" })), small.label);
  // A role with no row in the snapshot is a known zero; unknown (VE, no snapshot) stays listed.
  const zero = DEFAULT_ROLES_200.find((role) => !snapshot.roles.some((entry) => entry.label === role));
  if (zero) assert.ok(!xml.includes(loc({ kind: "rol", label: zero, country: "CO" })), zero);
  assert.ok(xml.includes(loc({ kind: "rol", label: big.label, country: "VE" })));
  // Without a snapshot the sitemap is exactly today's.
  assert.equal(buildCategoriesSitemapXml({ knownTotal: () => undefined }), buildCategoriesSitemapXml());
});

test("ADS-056 the home's city and role blocks carry a figure and context", async () => {
  const context = buildHomeCityContext({ "Bogotá": 400, "Medellín": 150, "Cali": null }, 1000, "Colombia");
  assert.ok(context);
  assert.match(context!, /Bogotá/);
  assert.match(context!, /40 %/);
  assert.equal(buildHomeCityContext({}, null, "Colombia"), null);

  const landing = read("src/sections/HomeLanding.tsx");
  assert.match(landing, /buildHomeCityContext/, "city section explains its figures");
  assert.match(landing, /roleCounts/, "role links show their counts");
  assert.match(landing, /MARKET_REPORT_PATH/, "the home links the report");
  // No link removed: every POPULAR_ROLES entry is still a link.
  assert.match(landing, /roles\.map\(\(role, i\) => \(\s*<Link/);
});

test("ADS-057 report routes, switch and sitemap", () => {
  assert.deepEqual(parseMarketReportPath("/informes"), { kind: "index" });
  assert.deepEqual(parseMarketReportPath(MARKET_REPORT_PATH), { kind: "live" });
  assert.deepEqual(parseMarketReportPath("/informes/empleo-colombia-2026-10"), { kind: "edition", period: "2026-10" });
  for (const bad of ["/informes/empleo-colombia-2026-13", "/informes/empleo-venezuela", "/informes/x", "/informes/empleo-colombia-26-10"]) {
    assert.equal(parseMarketReportPath(bad), null, bad);
  }
  assert.equal(marketReportsEnabled({}), true);
  assert.equal(marketReportsEnabled({ REPORTS_ENABLED: "false" }), false);
  assert.equal(marketReportsEnabled({ REPORTS_ENABLED: "0" }), false);
  const server = read("src/server.ts");
  assert.match(server, /marketReportSitemapEntries\(/, "sitemap-pages lists the reports");
  assert.match(read("src/sections/Footer.tsx"), /\/informes/);
  assert.match(read("src/App.tsx"), /path="\/informes/);
});

test("ADS-058 reports never carry the ad marker until the design says so", () => {
  const server = read("src/server.ts");
  const start = server.indexOf("// F4 market report routes");
  const end = server.indexOf("// end F4 market report routes");
  assert.ok(start > 0 && end > start, "report routes are delimited");
  assert.doesNotMatch(server.slice(start, end), /markAdEligible/);
});

test("ADS-059 hubs and the home only peek the report cache; the query is bounded", async () => {
  const server = read("src/server.ts");
  assert.doesNotMatch(server, /await\s+getMarketSnapshot\([^)]*\)[^\n]*\n[^\n]*buildHubComparison/);
  assert.match(server, /buildHubComparison\(\{[^}]*national:\s*peekMarketSnapshot\(/);
  const repo = read("src/db/job-repository.ts");
  const query = repo.slice(repo.indexOf("async function queryMarketRows"));
  assert.ok(query.length > 0);
  assert.doesNotMatch(query.slice(0, 2500), /\b(INSERT|UPDATE|DELETE)\b/);
  assert.match(repo, /marketSnapshotCache = new StaleWhileRevalidateCache/);
  assert.match(repo, /freshForMs: MARKET_SNAPSHOT_FRESH_MS/);
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
