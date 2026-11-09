// seo-intent-wave2 (openspec/changes/seo-intent-wave2): pure, offline checks
// of SIW-001 … SIW-053. Fixed clock everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  buildCategoriesSitemapXml,
  buildCategoryMeta,
  buildCategoryInsights,
  buildCategorySectionHeadings,
  buildCategoryStatsCopy,
  buildCategoryPath,
  resolveCategoryPath,
  resolveCategorySlug,
  SITE_URL,
  type ResolvedCategory,
  type SeoJob
} from "../src/lib/job-seo.js";
import { matchesSchedule, scheduleForFilter, sqlSchedule, type ScheduleIntent } from "../src/lib/job-schedule.js";
import {
  INTENT_PAGE_CACHE_ENTRIES,
  buildHubIntentLinks,
  buildIntentAnswer,
  buildIntentHreflangTags,
  collectIndexableIntents,
  intentFilters,
  intentLinkLabel,
  intentRobots,
  listIntentCategories,
  renderIntentAnswerHtml,
  siblingIntent
} from "../src/lib/intent-pages.js";
import { cityHubFilters, resolveJobCityHub } from "../src/lib/job-internal-links.js";
import { hubMatcher, newTodayHeading } from "../src/lib/recent-jobs.js";
import { getCountryConfig } from "../src/countries/index.js";
import { IntentAnswerBlock } from "../src/components/IntentAnswerBlock.js";
import { SCHEDULE_CASES } from "./fixtures/schedule-cases.js";

const AS_OF = new Date("2026-11-07T15:00:00.000Z");

function job(index: number, overrides: Partial<SeoJob> = {}): SeoJob {
  return {
    jobId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    title: `Mesero fines de semana ${index}`,
    company: `Empresa ${index % 3}`,
    location: index % 2 ? "Medellín, Antioquia" : "Bogotá, D.C.",
    url: `https://example.invalid/${index}`,
    source: "Computrabajo",
    country: "CO",
    publishedAt: new Date(AS_OF.getTime() - 3_600_000).toISOString(),
    ...overrides
  } as SeoJob;
}

const fdsCO = resolveCategorySlug("fines-de-semana", "CO")!;
const mtCO = resolveCategorySlug("medio-tiempo", "CO")!;
const tempCO = resolveCategorySlug("temporada", "CO")!;
const medellinSinExp = resolveCategoryPath(["medellin", "sin-experiencia"], "CO")!;
const caliSinExp = resolveCategoryPath(["cali", "sin-experiencia"], "CO")!;
const guayana = resolveCategorySlug("ciudad-guayana", "VE")!;
const NEW_PAGES: ResolvedCategory[] = [fdsCO, mtCO, tempCO, medellinSinExp, caliSinExp];

// ---- Ciudad × intención ------------------------------------------------------

test("SIW-001 Medellín and Cali × sin experiencia resolve with their own canonical and no hreflang", () => {
  for (const [page, city, path] of [
    [medellinSinExp, "Medellín", "/empleos/medellin/sin-experiencia"],
    [caliSinExp, "Cali", "/empleos/cali/sin-experiencia"]
  ] as const) {
    assert.deepEqual([page.kind, page.intent, page.city, page.country], ["intencion", "sin-experiencia", city, "CO"]);
    assert.equal(buildCategoryPath(page), path);
    assert.equal(buildCategoryMeta(page, 34).canonicalUrl, `${SITE_URL}${path}`);
    assert.equal(buildIntentHreflangTags(page, { CO: 100, VE: 100 }), "");
    assert.deepEqual(intentFilters(page), { cities: [city], experience: "sin-experiencia", country: "CO", googleReady: true });
  }
});

test("SIW-002 any other second segment keeps the city hub", () => {
  for (const segments of [["medellin", "fines-de-semana"], ["cali", "medio-tiempo"], ["bogota", "temporada"], ["caracas", "sin-experiencia"]]) {
    const page = resolveCategoryPath(segments, "CO")!;
    assert.equal(page.kind, "ciudad", segments.join("/"));
    assert.equal(buildCategoryPath(page), `/empleos/${segments[0]}`);
  }
});

// ---- Clasificador de jornada -------------------------------------------------

test("SIW-010 schedule classifier: explicit title phrases only", () => {
  const intents: ScheduleIntent[] = ["fines-de-semana", "medio-tiempo", "temporada"];
  for (const item of SCHEDULE_CASES) {
    const got = intents.filter((intent) => matchesSchedule(intent, item.title));
    assert.deepEqual(got, item.expected, `${item.note}: ${item.title}`);
  }
});

test("SIW-011 schedule SQL is constant-only and title-only", () => {
  for (const intent of ["fines-de-semana", "medio-tiempo", "temporada"] as const) {
    const sql = sqlSchedule(intent, "title");
    assert.ok(!/\$\d/.test(sql), "no parameters");
    assert.ok(!/description/.test(sql), "never reads the description");
  }
});

test("SIW-012 every intent has its own filter, copy, link label and answer", () => {
  assert.deepEqual(intentFilters(fdsCO), { schedule: "fines-de-semana", country: "CO", googleReady: true });
  assert.deepEqual(intentFilters(mtCO), { schedule: "medio-tiempo", country: "CO", googleReady: true });
  assert.deepEqual(intentFilters(tempCO), { schedule: "temporada", country: "CO", googleReady: true });
  const titles = NEW_PAGES.map((page) => buildCategoryMeta(page, 30).title);
  assert.equal(new Set(titles).size, titles.length);
  for (const page of [fdsCO, mtCO, tempCO]) {
    assert.ok(!/sin experiencia/i.test(buildCategoryMeta(page, 30).title), page.intent);
    assert.ok(!/remoto/i.test(buildCategoryMeta(page, 30).title), page.intent);
  }
  assert.equal(intentLinkLabel(fdsCO), "Trabajo los fines de semana en Colombia");
  assert.equal(intentLinkLabel(mtCO), "Trabajo de medio tiempo en Colombia");
  assert.equal(intentLinkLabel(tempCO), "Trabajo por temporada en Colombia");
  assert.equal(intentLinkLabel(medellinSinExp), "Trabajo sin experiencia en Medellín");
  const answer = buildIntentAnswer(fdsCO, 30, [job(1), job(2)])!;
  assert.equal(answer.items[0].answer, "30 vacantes activas en Colombia cuyo título dice que son de fines de semana.");
  assert.equal(buildIntentAnswer(mtCO, 26, [job(1)])!.items[0].answer, "26 vacantes activas en Colombia cuyo título dice que son de medio tiempo.");
  assert.equal(buildIntentAnswer(tempCO, 245, [job(1)])!.items[0].answer, "245 vacantes activas en Colombia cuyo título dice que son por temporada.");
  assert.equal(newTodayHeading(fdsCO), "Vacantes de fines de semana nuevas hoy");
  assert.equal(newTodayHeading(mtCO), "Vacantes de medio tiempo nuevas hoy");
  assert.equal(newTodayHeading(tempCO), "Vacantes por temporada nuevas hoy");
});

test("SIW-013 the schedule filter only accepts the whitelist", () => {
  assert.equal(scheduleForFilter("fines-de-semana"), "fines-de-semana");
  assert.equal(scheduleForFilter("por-dias"), null);
  assert.equal(scheduleForFilter("' OR 1=1 --"), null);
  assert.equal(scheduleForFilter(undefined), null);
});

// ---- Países --------------------------------------------------------------------

test("SIW-020 an intent resolves only in its whitelisted countries", () => {
  assert.equal(resolveCategorySlug("fines-de-semana", "VE"), null);
  assert.equal(resolveCategorySlug("medio-tiempo", "VE"), null);
  assert.equal(resolveCategorySlug("temporada", "VE"), null);
  assert.equal(resolveCategorySlug("por-dias", "CO"), null);
  assert.equal(resolveCategorySlug("remoto", "VE")?.country, "VE");
  assert.equal(resolveCategorySlug("sin-experiencia", "VE")?.country, "VE");
});

test("SIW-021 listIntentCategories is the exact page list of this phase", () => {
  assert.deepEqual(listIntentCategories().map(buildCategoryPath), [
    "/empleos/remoto",
    "/ve/empleos/remoto",
    "/empleos/sin-experiencia",
    "/ve/empleos/sin-experiencia",
    "/empleos/fines-de-semana",
    "/empleos/medio-tiempo",
    "/empleos/temporada",
    "/empleos/bogota/sin-experiencia",
    "/empleos/medellin/sin-experiencia",
    "/empleos/cali/sin-experiencia"
  ]);
});

test("SIW-022 a national intent without a sibling emits no hreflang", () => {
  for (const page of [fdsCO, mtCO, tempCO]) {
    assert.equal(siblingIntent(page), null);
    assert.equal(buildIntentHreflangTags(page, { CO: 500, VE: 500 }), "");
  }
  // The existing pairs keep theirs (SIP-040).
  assert.ok(buildIntentHreflangTags(resolveCategorySlug("remoto", "CO")!, { CO: 500, VE: 500 }).includes('hreflang="es-VE"'));
});

// ---- Guarda, sitemap, enlaces, keeper ----------------------------------------------

test("SIW-030 the guard applies to the new pages", () => {
  assert.equal(intentRobots(9), "noindex,follow");
  assert.equal(intentRobots(10), null);
  const xml = buildCategoriesSitemapXml({ intents: [fdsCO, medellinSinExp] });
  assert.ok(xml.includes(`${SITE_URL}/empleos/fines-de-semana</loc>`));
  assert.ok(xml.includes(`${SITE_URL}/empleos/medellin/sin-experiencia</loc>`));
  assert.ok(!buildCategoriesSitemapXml({ intents: [] }).includes("fines-de-semana"));
});

test("SIW-032 hubs link new pages only with a known total of at least 10", () => {
  const medellin = resolveCategorySlug("medellin", "CO")!;
  const totals = new Map<string, number>([
    ["/empleos/medellin/sin-experiencia", 34],
    ["/empleos/fines-de-semana", 30],
    ["/empleos/medio-tiempo", 9]
  ]);
  const links = buildHubIntentLinks(medellin, (page) => totals.get(buildCategoryPath(page)));
  assert.deepEqual(
    links.map((link) => link.href),
    ["/empleos/fines-de-semana", "/empleos/medellin/sin-experiencia"]
  );
  assert.deepEqual(buildHubIntentLinks(medellin, () => undefined), []);
  // A VE hub never links CO-only intents.
  const caracas = resolveCategorySlug("caracas", "VE")!;
  assert.ok(buildHubIntentLinks(caracas, () => 100).every((link) => link.href.startsWith("/ve/")));
});

test("SIW-033 the sitemap reuses known totals and loads only the unknown ones, in series", async () => {
  const pages = listIntentCategories();
  const known = new Map<string, number>(pages.slice(0, 7).map((page, index) => [buildCategoryPath(page), index < 3 ? 50 : 5]));
  const loaded: string[] = [];
  let inFlight = 0;
  const indexable = await collectIndexableIntents(
    pages,
    (page) => known.get(buildCategoryPath(page)),
    async (page) => {
      inFlight += 1;
      assert.equal(inFlight, 1, "one query at a time");
      loaded.push(buildCategoryPath(page));
      await Promise.resolve();
      inFlight -= 1;
      return 20;
    }
  );
  assert.deepEqual(loaded, pages.slice(7).map(buildCategoryPath));
  assert.deepEqual(indexable.map(buildCategoryPath), [...pages.slice(0, 3), ...pages.slice(7)].map(buildCategoryPath));
  await assert.rejects(
    collectIndexableIntents(pages, () => undefined, async () => {
      throw new Error("db down");
    })
  );
});

test("SIW-034 the intent cache holds every intent page", () => {
  assert.ok(INTENT_PAGE_CACHE_ENTRIES >= listIntentCategories().length);
});

// ---- Contenido ----------------------------------------------------------------

test("SIW-040 title, H1 and meta of the new pages (design D4)", () => {
  const expected: Array<[ResolvedCategory, number, string, string]> = [
    [fdsCO, 30, "Trabajo los fines de semana en Colombia: 30 vacantes | BuscoTrabajo", "Trabajo los fines de semana en Colombia"],
    [mtCO, 26, "Trabajo de medio tiempo en Colombia: 26 vacantes | BuscoTrabajo", "Trabajo de medio tiempo en Colombia"],
    [tempCO, 245, "Trabajo por temporada en Colombia: 245 vacantes | BuscoTrabajo", "Trabajo por temporada en Colombia"],
    [medellinSinExp, 34, "Trabajo sin experiencia en Medellín: 34 vacantes | BuscoTrabajo", "Trabajo sin experiencia en Medellín"],
    [caliSinExp, 15, "Trabajo sin experiencia en Cali: 15 vacantes | BuscoTrabajo", "Trabajo sin experiencia en Cali"]
  ];
  for (const [page, total, title, heading] of expected) {
    const meta = buildCategoryMeta(page, total);
    assert.equal(meta.title, title);
    assert.equal(meta.heading, heading);
    assert.ok(meta.description.length >= 150 && meta.description.length <= 160, `${meta.description.length}: ${meta.description}`);
    assert.ok(meta.description.startsWith(`${total} vacantes`), meta.description);
    // Below the guard the title carries no count.
    assert.equal(buildCategoryMeta(page, 9).title, `${heading} | BuscoTrabajo`);
  }
});

test("SIW-040 section headings of the schedule pages name the intent, never the bare label", () => {
  const expected: Array<[ResolvedCategory, string, string]> = [
    [fdsCO, "Vacantes de fines de semana recientes en Colombia", "Trabajos de fines de semana en Colombia: cifras de las ofertas activas"],
    [mtCO, "Vacantes de medio tiempo recientes en Colombia", "Trabajos de medio tiempo en Colombia: cifras de las ofertas activas"],
    [tempCO, "Vacantes por temporada recientes en Colombia", "Trabajos por temporada en Colombia: cifras de las ofertas activas"]
  ];
  for (const [page, jobsHeading, statsHeading] of expected) {
    assert.equal(buildCategorySectionHeadings(page).jobs, jobsHeading);
    const jobs = [job(1), job(2)];
    const stats = buildCategoryStatsCopy(page, buildCategoryInsights(page, 30, jobs, AS_OF))!;
    assert.equal(stats.heading, statsHeading);
  }
});

test("SIW-041 the answer block is identical in the SSR string and the React render", () => {
  for (const page of NEW_PAGES) {
    const answer = buildIntentAnswer(page, 30, [job(1), job(2), job(3), job(4)])!;
    const html = renderIntentAnswerHtml(answer);
    const react = renderToStaticMarkup(createElement(IntentAnswerBlock, { answer }));
    assert.ok(react.includes(html), buildCategoryPath(page));
  }
});

// ---- Ciudad Guayana y Puerto Ordaz ----------------------------------------------

test("SIW-050 the Ciudad Guayana hub lists Puerto Ordaz, in SQL filters and in memory", () => {
  assert.deepEqual(cityHubFilters(guayana), { cities: ["Ciudad Guayana", "Puerto Ordaz"], country: "VE" });
  const matches = hubMatcher(guayana);
  assert.equal(matches({ title: "Asistente comercial", location: "Puerto Ordaz, Bolívar", country: "VE" }), true);
  assert.equal(matches({ title: "Asistente comercial", location: "Ciudad Guayana", country: "VE" }), true);
  assert.equal(matches({ title: "Asistente comercial", location: "Caracas", country: "VE" }), false);
});

test("SIW-051 its title and H1 name Puerto Ordaz; the canonical stays", () => {
  const meta = buildCategoryMeta(guayana, 8);
  assert.equal(meta.heading, "Empleos en Ciudad Guayana y Puerto Ordaz: trabajo y ofertas de empleo");
  assert.equal(meta.title, "Empleos en Ciudad Guayana y Puerto Ordaz: trabajo y ofertas de empleo | BuscoTrabajo");
  assert.ok(meta.description.includes("Puerto Ordaz"), meta.description);
  assert.ok(meta.description.length <= 160, meta.description);
  assert.equal(meta.canonicalUrl, `${SITE_URL}/empleos/ciudad-guayana`);
});

test("SIW-052 nothing else changes: other hubs, VE city list, job breadcrumbs, no /puerto-ordaz", () => {
  assert.equal(resolveCategorySlug("puerto-ordaz", "VE"), null);
  assert.deepEqual(getCountryConfig("VE").cities, ["Caracas", "Maracaibo", "Valencia", "Barquisimeto", "Maracay", "Ciudad Guayana"]);
  assert.equal(resolveJobCityHub({ location: "Puerto Ordaz, Bolívar", country: "VE" }), null);
  const caracas = resolveCategorySlug("caracas", "VE")!;
  assert.deepEqual(cityHubFilters(caracas), { cities: ["Caracas"], country: "VE" });
  assert.equal(buildCategoryMeta(caracas, 100).heading, "Empleos en Caracas: trabajo y ofertas de empleo");
  const bogota = resolveCategorySlug("bogota", "CO")!;
  assert.deepEqual(cityHubFilters(bogota), { cities: ["Bogotá"], country: "CO" });
  assert.equal(
    buildCategoryMeta(bogota, 100).description,
    "¿Buscas trabajo en Bogotá? 100 vacantes y ofertas de empleo activas. Compara las empresas y cargos que más contratan y aplica en la fuente original."
  );
});


