// seo-intent-pages (openspec/changes/seo-intent-pages): pure, offline checks
// of the requirements SIP-001 … SIP-041. Fixed clock everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  buildCategoriesSitemapXml,
  buildCategoryInsights,
  buildCategoryMeta,
  buildCategoryPath,
  buildCategorySectionHeadings,
  buildCategoryStatsCopy,
  buildRelatedCityLinks,
  resolveCategoryPath,
  resolveCategorySlug,
  SITE_URL,
  type ResolvedCategory,
  type SeoJob
} from "../src/lib/job-seo.js";
import { classifyExperience } from "../src/lib/job-experience.js";
import {
  INTENT_MIN_JOBS,
  buildIntentAnswer,
  buildIntentHreflangTags,
  intentFilters,
  intentPagesEnabled,
  intentRobots,
  isIntentIndexable,
  listIntentCategories,
  renderIntentAnswerHtml
} from "../src/lib/intent-pages.js";
import { IntentAnswerBlock } from "../src/components/IntentAnswerBlock.js";
import { EXPERIENCE_CASES } from "./fixtures/experience-cases.js";

const AS_OF = new Date("2026-11-07T15:00:00.000Z");

function job(index: number, overrides: Partial<SeoJob> = {}): SeoJob {
  return {
    jobId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    title: `Asesor sin experiencia ${index}`,
    company: `Empresa ${index % 3}`,
    location: "Bogotá, Colombia",
    url: `https://example.invalid/${index}`,
    source: "LinkedIn",
    country: "CO",
    publishedAt: new Date(AS_OF.getTime() - 3_600_000).toISOString(),
    ...overrides
  } as SeoJob;
}

const remotoCO = resolveCategorySlug("remoto", "CO")!;
const remotoVE = resolveCategorySlug("remoto", "VE")!;
const sinExpCO = resolveCategorySlug("sin-experiencia", "CO")!;
const sinExpVE = resolveCategorySlug("sin-experiencia", "VE")!;
const bogotaSinExp = resolveCategoryPath(["bogota", "sin-experiencia"], "CO")!;

// ---- Resolution and routes -------------------------------------------------

test("SIP-001 intents resolve with the country of the URL prefix", () => {
  assert.deepEqual(
    [remotoCO, remotoVE, sinExpCO, sinExpVE].map((c) => [c.kind, c.intent, c.country]),
    [
      ["intencion", "remoto", "CO"],
      ["intencion", "remoto", "VE"],
      ["intencion", "sin-experiencia", "CO"],
      ["intencion", "sin-experiencia", "VE"]
    ]
  );
  assert.equal(buildCategoryPath(remotoCO), "/empleos/remoto");
  assert.equal(buildCategoryPath(remotoVE), "/ve/empleos/remoto");
  assert.equal(buildCategoryPath(sinExpCO), "/empleos/sin-experiencia");
  assert.equal(buildCategoryPath(sinExpVE), "/ve/empleos/sin-experiencia");
  assert.equal(buildCategoryMeta(remotoVE, 50).canonicalUrl, `${SITE_URL}/ve/empleos/remoto`);
  // The VE page never filters on Colombia.
  assert.equal(intentFilters(remotoVE).country, "VE");
  assert.equal(intentFilters(sinExpVE).country, "VE");
});

test("SIP-002 Bogotá × sin experiencia is its own city-intent page", () => {
  assert.equal(bogotaSinExp.kind, "intencion");
  assert.equal(bogotaSinExp.intent, "sin-experiencia");
  assert.equal(bogotaSinExp.city, "Bogotá");
  assert.equal(bogotaSinExp.country, "CO");
  assert.equal(buildCategoryPath(bogotaSinExp), "/empleos/bogota/sin-experiencia");
  assert.equal(buildCategoryMeta(bogotaSinExp, 40).canonicalUrl, `${SITE_URL}/empleos/bogota/sin-experiencia`);
  assert.deepEqual(intentFilters(bogotaSinExp), {
    cities: ["Bogotá"],
    country: "CO",
    experience: "sin-experiencia",
    googleReady: true
  });
});

test("SIP-003 any other second segment keeps the city hub", () => {
  assert.deepEqual(resolveCategoryPath(["bogota", "abc"], "CO"), resolveCategorySlug("bogota", "CO"));
  assert.equal(resolveCategoryPath(["bogota", "abc"], "CO")!.kind, "ciudad");
  // Not whitelisted in this phase.
  assert.equal(resolveCategoryPath(["medellin", "sin-experiencia"], "CO")!.kind, "ciudad");
  assert.equal(resolveCategoryPath(["bogota", "remoto"], "CO")!.kind, "ciudad");
  // A role never takes a second segment.
  assert.equal(resolveCategoryPath(["asesor-comercial", "sin-experiencia"], "CO")!.kind, "rol");
  assert.equal(resolveCategoryPath(["no-existe"], "CO"), null);
});

test("SIP-004 remoto filters with the PR #104 modality classifier", () => {
  assert.deepEqual(intentFilters(remotoCO), { modality: "remoto", country: "CO", googleReady: true });
  assert.deepEqual(intentFilters(sinExpCO), { experience: "sin-experiencia", country: "CO", googleReady: true });
});

test("Remoto stays a dashboard city filter but no longer a city hub", () => {
  assert.equal(resolveCategorySlug("remoto", "CO")!.kind, "intencion");
  // Job pages never had a Remoto hub: the CO city list excludes it.
  assert.ok(!buildRelatedCityLinks(resolveCategorySlug("bogota", "CO")!).some((l) => l.href.endsWith("/remoto")));
});

// ---- Classifier --------------------------------------------------------------

test("SIP-010 only explicit phrases count; required years exclude", () => {
  for (const c of EXPERIENCE_CASES) {
    assert.equal(
      classifyExperience({ title: c.title, description: c.description }) === "sin-experiencia",
      c.sinExperiencia,
      `${c.note}: ${c.title} | ${c.description}`
    );
  }
});

// ---- Guard --------------------------------------------------------------------

test("SIP-020/021 the guard is >= 10 Google-ready jobs", () => {
  assert.equal(INTENT_MIN_JOBS, 10);
  assert.equal(isIntentIndexable(10), true);
  assert.equal(isIntentIndexable(9), false);
  assert.equal(intentRobots(10), null);
  assert.equal(intentRobots(9), "noindex,follow");
  assert.equal(intentRobots(0), "noindex,follow");
});

test("SIP-020/021 sitemap lists exactly the indexable intent pages, once", () => {
  const indexable = [remotoCO, sinExpCO, bogotaSinExp];
  const xml = buildCategoriesSitemapXml({ intents: indexable });
  for (const c of indexable) assert.ok(xml.includes(`<loc>${SITE_URL}${buildCategoryPath(c)}</loc>`), buildCategoryPath(c));
  assert.ok(!xml.includes(`<loc>${SITE_URL}/ve/empleos/remoto</loc>`));
  assert.equal(xml.split(`<loc>${SITE_URL}/empleos/remoto</loc>`).length - 1, 1, "remoto once");
  const none = buildCategoriesSitemapXml({ intents: [] });
  assert.ok(!none.includes("/empleos/remoto<"));
  assert.ok(!none.includes("sin-experiencia"));
  // Flag off: the legacy sitemap, with Remoto as the CO city bucket.
  const legacy = buildCategoriesSitemapXml();
  assert.ok(legacy.includes(`<loc>${SITE_URL}/empleos/remoto</loc>`));
  assert.ok(!legacy.includes("sin-experiencia"));
});

test("SIP-022 every intent filter carries its own predicate (no filling)", () => {
  for (const c of listIntentCategories()) {
    const f = intentFilters(c);
    assert.ok(f.modality === "remoto" || f.experience === "sin-experiencia", buildCategoryPath(c));
    assert.equal(f.googleReady, true);
  }
  assert.deepEqual(
    listIntentCategories().map(buildCategoryPath),
    ["/empleos/remoto", "/ve/empleos/remoto", "/empleos/sin-experiencia", "/ve/empleos/sin-experiencia", "/empleos/bogota/sin-experiencia"]
  );
});

// ---- Content ------------------------------------------------------------------

test("SIP-030 D4 titles carry the real total only from 10 up", () => {
  const cases: Array<[ResolvedCategory, string, string]> = [
    [remotoVE, "Trabajo remoto en Venezuela: 123 vacantes desde casa | BuscoTrabajo", "Trabajo remoto en Venezuela: vacantes desde casa"],
    [sinExpCO, "Trabajo sin experiencia en Colombia: 123 vacantes | BuscoTrabajo", "Trabajo sin experiencia en Colombia"],
    [sinExpVE, "Trabajo sin experiencia en Venezuela: 123 vacantes | BuscoTrabajo", "Trabajo sin experiencia en Venezuela"],
    [bogotaSinExp, "Trabajo sin experiencia en Bogotá: 123 vacantes | BuscoTrabajo", "Trabajo sin experiencia en Bogotá"]
  ];
  for (const [c, title, heading] of cases) {
    const meta = buildCategoryMeta(c, 123);
    assert.equal(meta.title, title);
    assert.equal(meta.heading, heading);
    assert.ok(meta.description.includes("123"), meta.description);
    for (const n of [10, 123, 4567]) {
      const len = buildCategoryMeta(c, n).description.length;
      assert.ok(len >= 150 && len <= 160, `${buildCategoryPath(c)} n=${n}: ${len}`);
    }
    assert.ok(!/\d/.test(buildCategoryMeta(c, 9).title), buildCategoryMeta(c, 9).title);
  }
});

test("ADR 0012 §5 /empleos/remoto (CO) keeps its measured copy byte for byte", () => {
  const legacyRemoto: ResolvedCategory = { kind: "ciudad", label: "Remoto", country: "CO" };
  const jobs = [job(1, { location: "Remoto" }), job(2, { location: "Remoto" })];
  const copy = (c: ResolvedCategory) => {
    const insights = buildCategoryInsights(c, 77, jobs, AS_OF);
    return JSON.stringify({
      meta: buildCategoryMeta(c, 77),
      headings: buildCategorySectionHeadings(c),
      related: buildRelatedCityLinks(c),
      insights,
      stats: buildCategoryStatsCopy(c, insights)
    });
  };
  assert.equal(copy(remotoCO), copy(legacyRemoto));
  const hash = createHash("sha256").update(copy(legacyRemoto)).digest("hex").slice(0, 16);
  assert.equal(hash, createHash("sha256").update(copy(remotoCO)).digest("hex").slice(0, 16));
});

test("SIP-031 answer block is identical in server HTML and React", () => {
  const jobs = [
    job(1, { location: "Bogotá, Colombia", company: "Acme" }),
    job(2, { location: "Medellín, Antioquia", company: "Acme" }),
    job(3, { location: "Bogotá D.C.", company: "Beta" }),
    job(4, { location: "Colombia", company: "Empresa Confidencial" }),
    job(5, { location: "Cali", company: "Empresa Confidencial" })
  ];
  const answer = buildIntentAnswer(sinExpCO, 42, jobs)!;
  assert.ok(answer);
  const serverHtml = renderIntentAnswerHtml(answer);
  const reactHtml = renderToStaticMarkup(createElement(IntentAnswerBlock, { answer }));
  const inner = /^<section[^>]*>([\s\S]*)<\/section>$/.exec(reactHtml)?.[1];
  const h = (s: string) => createHash("sha256").update(s).digest("hex");
  assert.equal(h(inner ?? ""), h(serverHtml));
  assert.match(serverHtml, /42 vacantes/);
  assert.match(serverHtml, /Bogotá \(2\)/);
  assert.match(serverHtml, /Acme \(2\)/);
  assert.ok(!serverHtml.includes("Beta"), "companies need >= 2 jobs");
  assert.ok(!/Confidencial/.test(serverHtml), "placeholder employers are not companies");
  // City × intent: no city list.
  assert.ok(!renderIntentAnswerHtml(buildIntentAnswer(bogotaSinExp, 42, jobs)!).includes("ciudades"));
  assert.equal(buildIntentAnswer(sinExpCO, 0, []), null);
});

test("SIP-032 no salary figures in the answer block", () => {
  const jobs = Array.from({ length: 12 }, (_, i) => job(i, { salaryMin: 1_500_000, salaryMax: 2_000_000, salaryCurrency: "COP" } as Partial<SeoJob>));
  assert.ok(!/COP|\$|salario/i.test(renderIntentAnswerHtml(buildIntentAnswer(sinExpCO, 12, jobs)!)));
});

// ---- Hreflang -------------------------------------------------------------------

test("SIP-040 national intent hreflang only when both countries are indexable", () => {
  const tags = buildIntentHreflangTags(sinExpVE, { CO: 30, VE: 12 });
  assert.ok(tags.includes(`hreflang="es-CO" href="${SITE_URL}/empleos/sin-experiencia"`));
  assert.ok(tags.includes(`hreflang="es-VE" href="${SITE_URL}/ve/empleos/sin-experiencia"`));
  assert.ok(tags.includes(`hreflang="x-default" href="${SITE_URL}/empleos/sin-experiencia"`));
  assert.equal(buildIntentHreflangTags(sinExpCO, { CO: 30, VE: 9 }), "");
  assert.equal(buildIntentHreflangTags(sinExpVE, { CO: 30, VE: 9 }), "");
});

test("SIP-041 city × intent pages never emit hreflang", () => {
  assert.equal(buildIntentHreflangTags(bogotaSinExp, { CO: 99, VE: 99 }), "");
});

// ---- Rollback flag ---------------------------------------------------------------

test("INTENT_PAGES_ENABLED: unset or anything but false keeps them on", () => {
  assert.equal(intentPagesEnabled({}), true);
  assert.equal(intentPagesEnabled({ INTENT_PAGES_ENABLED: "true" }), true);
  assert.equal(intentPagesEnabled({ INTENT_PAGES_ENABLED: "false" }), false);
  assert.equal(intentPagesEnabled({ INTENT_PAGES_ENABLED: "0" }), false);
});
