import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAdEligibleJobPage, isMarkedAdEligible, jobProvenance } from "../src/lib/ad-eligibility.js";
import {
  THIRD_PARTY_JOB_EXCERPT_MAX,
  applyThirdPartyExcerpt,
  buildJobExcerpt,
  isExcludedFromGoogleIndex,
  thirdPartyExcerptEnabled
} from "../src/lib/third-party-excerpt.js";
import { renderJobPageHtml } from "../src/lib/job-page-render.js";
import { liveListingJobs, pickRelatedJobs, RELATED_JOBS_LIMIT } from "../src/lib/job-internal-links.js";
import { MAX_JOB_AGE_DAYS } from "../src/lib/job-freshness.js";
import { buildCompanyJobsBlock } from "../src/lib/job-company-links.js";
import type { SeoJob } from "../src/lib/job-seo.js";
import { goldenCases } from "./fixtures/job-page-golden/cases.js";

// openspec/changes/adsense-readiness — F2, the copied surface
// (CX-4, CX-5, CX-9, SP-11, SP-12, PP-4). Offline.
const here = path.dirname(fileURLToPath(import.meta.url));
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const shell = lf(fs.readFileSync(path.join(here, "..", "index.html"), "utf-8"));
const golden = (name: string) => lf(fs.readFileSync(path.join(here, "fixtures", "job-page-golden", `${name}.html`), "utf-8"));
const caseNamed = (name: string) => goldenCases.find((item) => item.name === name)!;
const appHtml = (html: string) => /<div id="app">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? "";
const ssrJob = (html: string) =>
  JSON.parse(/window\.__SSR_JOB__=(\{[\s\S]*?\});<\/script>/.exec(html)![1].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&")) as { job: SeoJob };
const OFF = {};
const ON = { THIRD_PARTY_JOB_EXCERPT_ENABLED: "true" };

function render(name: string, env: Record<string, string | undefined>, extra: Partial<Parameters<typeof renderJobPageHtml>[1]> = {}) {
  const item = caseNamed(name);
  return lf(renderJobPageHtml(shell, { job: item.job, publicJob: item.job, related: item.related, companyJobs: null, ...extra }, env));
}

test("ADS-030 provenance: only the employer's own portal is official", () => {
  assert.equal(jobProvenance({ source: "Portal oficial" }), "official");
  for (const source of ["LinkedIn", "Computrabajo", "Elempleo", "Magneto", "Workana", "", null, undefined]) {
    assert.equal(jobProvenance({ source }), "third_party", String(source));
  }
  // The ad rule reads the same classification.
  assert.equal(isAdEligibleJobPage({ source: "Portal oficial" }, true), jobProvenance({ source: "Portal oficial" }) === "official");
  assert.equal(isAdEligibleJobPage({ source: "LinkedIn" }, true), false);
});

test("ADS-031 flag off: the job page is byte-identical to the pre-F2 golden HTML", () => {
  for (const name of ["third-party", "official"]) {
    assert.equal(render(name, OFF), golden(name), `${name}, flag unset`);
    for (const value of ["", "false", "0", "off", "no", "yes please"]) {
      assert.equal(render(name, { THIRD_PARTY_JOB_EXCERPT_ENABLED: value }), golden(name), `${name}, flag=${value}`);
    }
  }
});

test("ADS-031 the flag is off unless explicitly turned on", () => {
  assert.equal(thirdPartyExcerptEnabled({}), false);
  for (const value of ["", "false", "0", "off", "nope"]) assert.equal(thirdPartyExcerptEnabled({ THIRD_PARTY_JOB_EXCERPT_ENABLED: value }), false, value);
  for (const value of ["true", "1", "on", " TRUE "]) assert.equal(thirdPartyExcerptEnabled({ THIRD_PARTY_JOB_EXCERPT_ENABLED: value }), true, value);
  const job = caseNamed("third-party").job;
  assert.equal(applyThirdPartyExcerpt(job, false), job, "off: the very same object, untouched");
  assert.equal(isExcludedFromGoogleIndex(job, false), false);
});

test("ADS-032 third party, option (a): full text, own blocks in the raw HTML, source named, no ads", () => {
  const item = caseNamed("third-party");
  const reputation = [{ source: "glassdoor", score: 4.1, scoreScale: "5", reviewCount: 120, sourceUrl: "https://example.invalid/rep" }];
  const job = { ...item.job, reputation } as SeoJob;
  const companyJobs = buildCompanyJobsBlock(job, {
    total: 3,
    jobs: [
      { ...item.job, jobId: "eeeeeeee-5555-4555-8555-555555555555", title: "Analista de Cobranza" },
      { ...item.job, jobId: "ffffffff-6666-4666-8666-666666666666", title: "Coordinador de Cartera" }
    ]
  });
  assert.ok(companyJobs, "fixture employer has a company block");
  const html = lf(renderJobPageHtml(shell, { job: item.job, publicJob: job, related: item.related, companyJobs }, OFF));
  const app = appHtml(html);
  for (const marker of ["data-job-breadcrumb", "data-job-description", "data-company-reputation", "data-related-jobs", "Más empleos en Bogotá"]) {
    assert.ok(app.includes(marker), marker);
  }
  assert.ok(app.includes("Analista de Cobranza"), "company jobs block");
  assert.ok(app.includes("Fuente: LinkedIn"), "names the source");
  assert.ok(app.includes('data-apply-link href="https://example.invalid/oferta/123"'), "links the original");
  assert.ok(app.includes("Dos años con SQL &amp; Power BI."), "D1(a) keeps the full text");
  assert.match(html, /"@type":"JobPosting"/);
  assert.equal(isMarkedAdEligible(html), false, "a copy from another job board never loads ads (PP-4)");
  assert.equal(isMarkedAdEligible(render("official", OFF)), true, "the employer's own vacancy may");
});

test("ADS-033 no invention: a block without data is not rendered", () => {
  const item = caseNamed("third-party");
  const html = lf(renderJobPageHtml(shell, { job: { ...item.job, location: "Remoto", country: "CO" }, publicJob: null, related: [], companyJobs: null }, OFF));
  const app = appHtml(html);
  for (const marker of ["data-company-reputation", "data-related-jobs", "data-company-jobs", "Salario:"]) {
    assert.ok(!app.includes(marker), marker);
  }
  assert.ok(!html.includes("window.__SSR_JOB__"), "no public payload without a public snapshot");
});

test("ADS-034 third party, option (b): excerpt, no JobPosting, noindex, same text after hydration", () => {
  const html = render("third-party", ON);
  const app = appHtml(html);
  const description = /<section data-job-description>([\s\S]*?)<\/section>/.exec(app)?.[1] ?? "";
  const visibleText = description.replace(/<h2>[\s\S]*?<\/h2>/, "").replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/g, "x");
  assert.ok(visibleText.length > 0 && Array.from(visibleText).length <= THIRD_PARTY_JOB_EXCERPT_MAX, `excerpt length ${visibleText.length}`);
  assert.ok(!app.includes("Dos años con SQL"), "requirements are not copied");
  assert.doesNotMatch(html, /"@type":"JobPosting"/, "no JobPosting: the contract requires the full description");
  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.equal(isMarkedAdEligible(html), false);
  for (const marker of ["data-job-breadcrumb", "data-related-jobs", "Fuente: LinkedIn", 'data-apply-link href="https://example.invalid/oferta/123"']) {
    assert.ok(app.includes(marker), marker);
  }
  // SP-1 parity: the hydrated page reads the same excerpt from the payload.
  const payload = ssrJob(html).job;
  assert.ok(Array.from(payload.description || "").length <= THIRD_PARTY_JOB_EXCERPT_MAX);
  assert.deepEqual(payload.requirements, []);
  // The employer's own vacancy is untouched by the flag.
  assert.equal(render("official", ON), golden("official"));
  assert.equal(isExcludedFromGoogleIndex(caseNamed("third-party").job, true), true, "out of both sitemaps and URL_UPDATED");
  assert.equal(isExcludedFromGoogleIndex(caseNamed("official").job, true), false);
});

test("ADS-035 excerpt: bounded, cut at a word, never invented", () => {
  const long = Array.from({ length: 120 }, (_, i) => `palabra${i}`).join(" ");
  const excerpt = buildJobExcerpt({ description: long });
  assert.ok(Array.from(excerpt).length <= THIRD_PARTY_JOB_EXCERPT_MAX);
  assert.ok(excerpt.endsWith("…"));
  assert.ok(long.startsWith(excerpt.slice(0, -1)), "a prefix of the source text, nothing added");
  assert.equal(buildJobExcerpt({ description: "Corta.\nSegunda línea." }), "Corta.\nSegunda línea.");
  assert.equal(buildJobExcerpt({ description: null }), "");
  assert.equal(buildJobExcerpt({ description: "   " }), "");
});

test("ADS-036 CX-9: listings never link a job past the freshness rule", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const jobs = [
    { jobId: "a", publishedAt: new Date(now.getTime() - 2 * day).toISOString() },
    { jobId: "b", publishedAt: new Date(now.getTime() - (MAX_JOB_AGE_DAYS + 1) * day).toISOString() },
    { jobId: "c", publishedAt: new Date(now.getTime() - day).toISOString(), validThrough: new Date(now.getTime() - 1000).toISOString() },
    { jobId: "d", publishedAt: new Date(now.getTime() - day).toISOString(), validThrough: null }
  ];
  assert.deepEqual(liveListingJobs(jobs, now).map((job) => job.jobId), ["a", "d"]);
  const fresh = liveListingJobs(jobs.slice(0, 1), now);
  assert.equal(fresh.length, 1);
  assert.notEqual(liveListingJobs(jobs, now), jobs, "a new array: the cached page is never mutated");
  assert.equal(jobs.length, 4);
});

const candidate = (n: number, title: string) => ({
  jobId: `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`,
  title,
  company: `Empresa ${n}`,
  location: "Bogotá, D.C.",
  url: `https://example.invalid/${n}`
});
const pool = [
  candidate(1, "Auxiliar de Bodega"),
  candidate(2, "Analista de Datos Senior"),
  candidate(3, "Mesero"),
  candidate(4, "Analista de Cartera"),
  candidate(5, "Conductor de Camión"),
  candidate(6, "Desarrollador Frontend React"),
  candidate(7, "Auxiliar Contable"),
  candidate(8, "Desarrollador Backend Node"),
  candidate(9, "Cajero"),
  candidate(10, "Auxiliar de Cocina")
];

test("ADS-037 CX-5: «Más empleos en <ciudad>» is ordered by role proximity", () => {
  const dev = pickRelatedJobs("99999999-0000-4000-8000-000000000001", pool, RELATED_JOBS_LIMIT, "Desarrollador Full Stack");
  assert.ok(dev.slice(0, 2).every((link) => link.title.startsWith("Desarrollador")), dev.map((l) => l.title).join(" | "));
  const analyst = pickRelatedJobs("99999999-0000-4000-8000-000000000002", pool, RELATED_JOBS_LIMIT, "Analista de Datos");
  assert.equal(analyst[0].title, "Analista de Datos Senior");
  assert.ok(analyst[1].title.startsWith("Analista"));
  assert.notEqual(dev[0].path, analyst[0].path, "siblings in one hub no longer share the same list");
});

test("ADS-037 CX-5: the number of linked jobs is unchanged", () => {
  for (const size of [0, 1, 3, RELATED_JOBS_LIMIT, pool.length]) {
    const slice = pool.slice(0, size);
    const withTitle = pickRelatedJobs("99999999-0000-4000-8000-000000000003", slice, RELATED_JOBS_LIMIT, "Auxiliar");
    const without = pickRelatedJobs("99999999-0000-4000-8000-000000000003", slice);
    assert.equal(withTitle.length, without.length, `pool ${size}`);
    assert.equal(withTitle.length, Math.min(RELATED_JOBS_LIMIT, size));
    assert.deepEqual(new Set(withTitle.map((l) => l.path)).size, withTitle.length, "no duplicates");
  }
  // Same title, different ids: the tie-break still spreads the links.
  for (let i = 0; i < 8; i++) {
    const [first] = pickRelatedJobs(`88888888-0000-4000-8000-00000000000${i}`, pool, 1, "Mesero de Eventos");
    assert.equal(first.title, "Mesero", "the closest role leads whatever the id");
  }
  const spread = new Set(
    Array.from({ length: 8 }, (_, i) => pickRelatedJobs(`77777777-0000-4000-8000-00000000000${i}`, pool, 3, "Gerente General").map((l) => l.path).join())
  );
  assert.ok(spread.size > 1, "no shared token: hash tie-break, not one list for all");
});

test("ADS-037 CX-5: proximity does not make sibling lists more alike", () => {
  const groups: Array<[string, number]> = [["Auxiliar de bodega", 5], ["Asesor comercial", 4], ["Mesero", 3], ["Analista de datos", 3], ["Conductor", 3], ["Cajero", 3], ["Auxiliar contable", 3], ["Desarrollador backend", 2], ["Enfermera jefe", 2], ["Vendedor tienda", 2]];
  const titles = groups.flatMap(([title, n]) => Array.from({ length: n }, () => title));
  for (let i = 0; titles.length < 60; i++) titles.push(`Cargo único ${i} operario`);
  const hub = titles.map((title, i) => ({ ...candidate(i, title), jobId: `${(0x10000000 + i * 7919).toString(16)}-0000-4000-8000-000000000000` }));
  const lists = (ranked: boolean) => new Set(hub.map((job) => pickRelatedJobs(job.jobId, hub, RELATED_JOBS_LIMIT, ranked ? job.title : undefined).map((l) => l.path).join()));
  assert.ok(lists(true).size >= lists(false).size, `${lists(true).size} distinct lists with proximity vs ${lists(false).size} by rotation`);
  const siblings = hub.filter((job) => job.title === "Auxiliar de bodega");
  const siblingLists = new Set(siblings.map((job) => pickRelatedJobs(job.jobId, hub, RELATED_JOBS_LIMIT, job.title).map((l) => l.path).join()));
  assert.equal(siblingLists.size, siblings.length, "same-title siblings still get different lists");
});

test("ADS-038 the job route renders through renderJobPageHtml and filters stale listing rows", () => {
  const server = fs.readFileSync(path.join(here, "..", "src", "server.ts"), "utf-8");
  assert.ok(/renderJobPageHtml\(/.test(server), "job route uses the shared composition");
  assert.ok(/pickRelatedJobs\([\s\S]{0,300}?visible\.title\s*\)/.test(server), "related jobs ranked by the current title");
  assert.ok((server.match(/liveListingJobs\(/g) || []).length >= 2, "hub items and related candidates filtered");
  assert.ok((server.match(/isExcludedFromGoogleIndex\(/g) || []).length >= 2, "both job sitemaps honor D1(b)");
  const indexing = fs.readFileSync(path.join(here, "..", "src", "db", "indexing-repository.ts"), "utf-8");
  assert.ok(/isExcludedFromGoogleIndex\(/.test(indexing), "URL_UPDATED honors D1(b)");
  const indexNow = fs.readFileSync(path.join(here, "..", "scripts", "indexnow-submit.ts"), "utf-8");
  assert.ok(/isExcludedFromGoogleIndex\(/.test(indexNow), "IndexNow honors D1(b)");
});

test("ADS-039 D1(b) needs its ADR before the flag is turned on", () => {
  const adr = fs.readFileSync(path.join(here, "..", "docs", "adr", "0016-third-party-job-excerpt.md"), "utf-8");
  assert.match(adr, /Estado:\*\* Borrador/);
  assert.match(adr, /THIRD_PARTY_JOB_EXCERPT_ENABLED/);
  assert.match(adr, /JOBPOSTING-GOOGLE-CONTRACT\.md/);
  for (const consumer of ["sitemap-jobs.xml", "sitemap-jobs-recent.xml", "URL_UPDATED", "IndexNow", "/api/jobs/:id", "robots", "JobPosting"]) {
    assert.ok(adr.includes(consumer), consumer);
  }
  assert.match(adr, /no se enciende/i, "the ADR says the flag stays off until it is accepted");
});

test("ADS-032 job page carries the «Guías relacionadas» block (F3) after the related jobs", () => {
  const name = goldenCases[0]!.name;
  const guides = { html: '<nav aria-label="Guías relacionadas" data-related-guides><h2>Guías relacionadas</h2></nav>', head: "  <script>window.__SSR_GUIDE_LINKS__={};</script>" };
  const html = render(name, OFF, { guides });
  assert.ok(appHtml(html).includes("data-related-guides"), "guides block in the raw HTML body");
  assert.ok(html.indexOf("__SSR_GUIDE_LINKS__") > 0 && html.indexOf("__SSR_GUIDE_LINKS__") < html.indexOf("</head>"), "guide payload in <head>");
  assert.equal(render(name, OFF), golden(name), "without guides the page stays byte-identical to the golden");
});
