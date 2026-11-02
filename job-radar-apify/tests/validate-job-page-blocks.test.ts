/**
 * Job page blocks B1-B3 (openspec/changes/job-page-differentiation) — pure, offline.
 * JPD-001 pins hashes computed on origin/main (109f392) before the change.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildJobPageBody, buildJobPosting, type SeoJob } from "../src/lib/job-seo.js";
import {
  COMPANY_JOBS_LIMIT,
  buildCompanyJobsBlock,
  companyJobsScope,
  readCompanyJobs,
  renderCompanyJobsHtml,
  type CompanyJobsSnapshot
} from "../src/lib/job-company-links.js";
import { companyKey } from "../src/lib/company-key.js";
import { boardJob, officialJob } from "./fixtures/job-page-blocks.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const descriptionSection = (html: string) => /<section data-job-description>[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

const REPUTATION: NonNullable<SeoJob["reputation"]> = [
  { source: "merco", score: 7.5, scoreScale: "0-10", reviewCount: null, sourceUrl: "https://merco.example.invalid/ranking" },
  { source: "gptw", score: null, scoreScale: "certificación", reviewCount: null, sourceUrl: "https://gptw.example.invalid/cert" },
  { source: "computrabajo", score: 4.2, scoreScale: "1-5", reviewCount: 318, sourceUrl: "https://ct.example.invalid/empresa" }
];

const BASELINE = {
  [boardJob.jobId]: {
    section: "196107b910e74b1f0eb02d3da6062f440eb7a7a9af2f0846060034fefc4dc413",
    postingDescription: "dd4824e865b97bbab06eee6b4df20fcdc6c838b137894c3bab8679e35dcdc300",
    posting: "eebf91d28f7bf53d503877b186429003d6a76d0053dfd6a2853ddf03d9acc7b1"
  },
  [officialJob.jobId]: {
    section: "1986261115e3f9d95a8630de68403036dd8d1a98842b90ffa92280ef5656bfe4",
    postingDescription: "0096419f0a01eca6893ac1815b35ac63130ff4d211a2c2e71abfbe9541813831",
    posting: "2347db29538edc10b6a56c3e750523257809c0e01934fd468e1449786735398d"
  }
};

test("JPD-001 description section and JobPosting are byte-identical to origin/main", () => {
  for (const job of [boardJob, officialJob]) {
    for (const variant of [job, { ...job, reputation: REPUTATION }]) {
      const expected = BASELINE[job.jobId];
      assert.equal(sha(descriptionSection(buildJobPageBody(variant))), expected.section, `${job.jobId}: description section`);
      const posting = buildJobPosting(variant)!;
      assert.equal(sha(String(posting.description)), expected.postingDescription, `${job.jobId}: JobPosting.description`);
      assert.equal(sha(JSON.stringify(posting)), expected.posting, `${job.jobId}: whole JobPosting (no block data enters JSON-LD)`);
    }
  }
});

// 14 live vacancies of the same employer under two spellings, the current one included.
function snapshot(total = 14): CompanyJobsSnapshot {
  const cities = ["Bogotá, D.C.", "Medellín, Antioquia", "Bogota, D.C., Capital District, Colombia", "Cali, Valle del Cauca"];
  const jobs = Array.from({ length: total }, (_, index) => ({
    jobId: index === 3 ? boardJob.jobId : `cccccccc-0000-4000-8000-${String(index).padStart(12, "0")}`,
    title: `Cargo ${index}`,
    company: index % 2 ? "ACCENTURE S.A.S." : "Accenture Colombia",
    location: cities[index % cities.length],
    url: `https://example.invalid/${index}`,
    isLocked: false
  }));
  return { total, jobs };
}

test("JPD-002 B1 lists up to 6 other jobs, same city first, plus the company link with the snapshot total", () => {
  const block = buildCompanyJobsBlock(boardJob, snapshot());
  assert.ok(block);
  assert.equal(block.total, 14);
  assert.equal(block.path, "/empresas/accenture-colombia");
  assert.equal(block.jobs.length, COMPANY_JOBS_LIMIT);
  assert.ok(block.jobs.every((link) => !link.path.includes(boardJob.jobId)), "never links itself");
  // Bogotá rows (both spellings of the city) come before any other city.
  const bogota = block.jobs.map((link) => /bogot/i.test(link.location));
  assert.deepEqual(bogota, [...bogota].sort((a, b) => Number(b) - Number(a)), "same-city links first");
  assert.ok(bogota.filter(Boolean).length >= 2);

  const html = renderCompanyJobsHtml(block);
  assert.equal((html.match(/href="\/empleos\/[^"]+"/g) || []).length, 6);
  assert.ok(html.includes(`<a href="/empresas/accenture-colombia">Ver las 14 vacantes de Accenture Colombia</a>`));

  // Stable: the same job always gets the same links; a sibling gets another slice.
  assert.deepEqual(buildCompanyJobsBlock(boardJob, snapshot()), block);
});

test("JPD-002 the B1 cache key groups employer spellings like the /empresas directory", () => {
  assert.equal(companyKey("Accenture Colombia"), companyKey("ACCENTURE S.A.S."));
  const scope = companyJobsScope(boardJob);
  assert.deepEqual(scope, { key: "CO|accenture", name: "Accenture Colombia", path: "/empresas/accenture-colombia", country: "CO" });
  assert.equal(companyJobsScope({ ...boardJob, company: "ACCENTURE S.A.S." })?.key, scope?.key, "one cache entry per employer");
  const ve = companyJobsScope({ ...boardJob, country: "VE" });
  assert.equal(ve?.path, "/ve/empresas/accenture-colombia");
  assert.equal(ve?.key, "VE|accenture");
  assert.equal(companyJobsScope({ ...boardJob, country: null })?.country, "CO", "no country: the CO directory, like the job route");
});

test("JPD-003 placeholder employers and single-vacancy companies never get B1", () => {
  for (const company of ["Confidencial", "Confidential Careers", "", null]) {
    assert.equal(companyJobsScope({ ...boardJob, company }), null, `scope for ${company}`);
    assert.equal(buildCompanyJobsBlock({ ...boardJob, company }, snapshot()), null, `block for ${company}`);
  }
  const onlySelf = { total: 1, jobs: [snapshot().jobs[3]] };
  assert.equal(buildCompanyJobsBlock(boardJob, onlySelf), null);
  assert.equal(buildCompanyJobsBlock(boardJob, { total: 0, jobs: [] }), null);
  // Others exist but none is publicly linkable (masked/locked rows).
  const unlinkable = { total: 3, jobs: snapshot(3).jobs.map((job) => ({ ...job, url: null })) };
  assert.equal(buildCompanyJobsBlock(boardJob, unlinkable), null);
});

test("JPD-004 a cold company cache renders only the company link, without a number", () => {
  const block = buildCompanyJobsBlock(boardJob, undefined);
  assert.deepEqual(block, { jobId: boardJob.jobId, name: "Accenture Colombia", path: "/empresas/accenture-colombia", total: null, jobs: [] });
  const html = renderCompanyJobsHtml(block!);
  assert.equal(html, `<section data-company-jobs><p><a href="/empresas/accenture-colombia">Ver las vacantes de Accenture Colombia</a></p></section>`);
});

test("JPD-005 reputation is in the raw HTML as text with scale and source link, never a logo", () => {
  const html = buildJobPageBody({ ...boardJob, reputation: REPUTATION });
  const section = /<section data-company-reputation>[\s\S]*?<\/section>/.exec(html)?.[0];
  assert.ok(section, "reputation section present");
  assert.ok(section.includes("Merco Talento: 7.5 (0-10)"));
  assert.ok(section.includes("Great Place to Work: Certificación"));
  assert.ok(section.includes("Computrabajo: 4.2 (1-5) · 318 reseñas"));
  for (const entry of REPUTATION) assert.ok(section.includes(`href="${entry.sourceUrl}"`), `${entry.source} source link`);
  assert.equal((section.match(/>Ver fuente</g) || []).length, 3);
  assert.ok(!/<img|<svg/i.test(section), "text only");
  assert.ok(!buildJobPageBody(boardJob).includes("data-company-reputation"), "no alias, no section");
  assert.ok(!buildJobPageBody({ ...boardJob, reputation: [] }).includes("data-company-reputation"));
});

test("JPD-006 official employer mark and curated careers link", () => {
  const official = buildJobPageBody(officialJob);
  assert.ok(
    official.includes(
      `<li data-official-source>Fuente: <a href="https://careers.example.invalid/" target="_blank" rel="nofollow noopener">Portal oficial de empleo de Alpina</a></li>`
    ),
    "official source fact names the employer and links its careers domain"
  );
  assert.ok(buildJobPageBody(boardJob).includes("<li>Fuente: LinkedIn</li>"), "job boards keep the plain fact");

  // Accenture is on the curated list: the link shows on any of its jobs, whatever the source.
  const careers = /<p data-official-careers>[\s\S]*?<\/p>/.exec(buildJobPageBody(boardJob))?.[0];
  assert.equal(
    careers,
    `<p data-official-careers><a href="https://www.accenture.com/co-es/careers/jobsearch" target="_blank" rel="nofollow noopener">Portal de empleo de Accenture Colombia</a></p>`
  );
  assert.ok(!official.includes("data-official-careers"), "not on the curated list");
});

test("JPD-009 new blocks hold no template phrases, no unsourced figures and stay out of JSON-LD", () => {
  const blocks = [
    renderCompanyJobsHtml(buildCompanyJobsBlock(boardJob, snapshot())!),
    renderCompanyJobsHtml(buildCompanyJobsBlock(boardJob, undefined)!),
    /<section data-company-reputation>[\s\S]*?<\/section>/.exec(buildJobPageBody({ ...boardJob, reputation: REPUTATION }))![0],
    /<p data-official-careers>[\s\S]*?<\/p>/.exec(buildJobPageBody(boardJob))![0]
  ];
  for (const html of blocks) {
    assert.ok(!/agregada de|BuscoTrabajo encontrar|en promedio|salario promedio|preguntas frecuentes/i.test(html), html);
  }
  // Every number in B1's visible text comes from the snapshot: the total or a job title.
  const text = blocks[0].replace(/<[^>]+>/g, " ");
  const allowed = new Set(["14", ...snapshot().jobs.flatMap((job) => job.title.match(/\d+/g) || [])]);
  for (const figure of text.match(/\d+/g) || []) assert.ok(allowed.has(figure), `figure ${figure} has a source row`);
  const posting = JSON.stringify(buildJobPosting({ ...boardJob, reputation: REPUTATION }));
  assert.ok(!/Merco|Ver las|Otras vacantes|Portal de empleo/.test(posting));
});

test("readCompanyJobs only trusts this job's own, well-formed payload", () => {
  const block = buildCompanyJobsBlock(boardJob, snapshot())!;
  const payload = JSON.parse(JSON.stringify({ jobId: boardJob.jobId, related: [], company: block }));
  assert.deepEqual(readCompanyJobs(boardJob.jobId, payload), block);
  assert.equal(readCompanyJobs("other-id", payload), null);
  assert.equal(readCompanyJobs(boardJob.jobId, { ...payload, company: { ...block, path: "https://evil.example/" } }), null);
  assert.equal(readCompanyJobs(boardJob.jobId, { ...payload, company: { ...block, total: 1 } }), null);
  assert.equal(readCompanyJobs(boardJob.jobId, { ...payload, company: { ...block, total: 2.5 } }), null);
  const badLink = { ...block, jobs: [{ ...block.jobs[0], path: "javascript:alert(1)" }] };
  assert.deepEqual(readCompanyJobs(boardJob.jobId, { ...payload, company: badLink })?.jobs, []);
  const tooMany = { ...block, jobs: [...block.jobs, ...block.jobs] };
  assert.equal(readCompanyJobs(boardJob.jobId, { ...payload, company: tooMany })?.jobs.length, COMPANY_JOBS_LIMIT);
  const cold = buildCompanyJobsBlock(boardJob, undefined)!;
  assert.deepEqual(readCompanyJobs(boardJob.jobId, { ...payload, company: cold }), cold);
  assert.equal(readCompanyJobs(boardJob.jobId, { jobId: boardJob.jobId, related: [] }), null);
});
