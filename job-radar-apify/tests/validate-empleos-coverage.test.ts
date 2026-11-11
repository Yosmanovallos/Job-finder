// seo-empleos-coverage (openspec/changes/seo-empleos-coverage): pure, offline
// checks of SEC-001 … SEC-040. No clock, no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GUARDED_CITY_HUBS,
  RETIRED_ROLE_SLUGS,
  SITE_URL,
  buildCategoriesSitemapXml,
  buildCategoryMeta,
  buildCategoryPath,
  buildRelatedCityLinks,
  isGuardedCityHub,
  listGuardedCityHubs,
  resolveCategoryPath,
  resolveCategorySlug,
  slugify,
  type ResolvedCategory
} from "../src/lib/job-seo.js";
import { CITY_OPTIONS } from "../src/lib/job-filters.js";
import { COUNTRIES } from "../src/countries/index.js";
import { DEFAULT_ROLES_200 } from "../src/queue/scheduler.js";
import {
  INTENT_PAGE_CACHE_ENTRIES,
  empleosCoverageEnabled,
  intentRobots,
  listIntentCategories
} from "../src/lib/intent-pages.js";
import { cityHubFilters, resolveJobCityHub } from "../src/lib/job-internal-links.js";
import {
  buildEmpleosIndexBreadcrumbList,
  buildEmpleosIndexHreflangTags,
  buildEmpleosIndexIntro,
  buildEmpleosIndexItemList,
  buildEmpleosIndexMeta,
  buildEmpleosIndexSections,
  empleosIndexCountryForPath,
  isEmpleosIndexPayload,
  renderEmpleosIndexHtml,
  type EmpleosIndexPayload
} from "../src/lib/empleos-index.js";

const guardedSlugs = GUARDED_CITY_HUBS.map((hub) => slugify(hub.label));

test("SEC-001 every guarded city resolves as a city hub with the city template", () => {
  for (const hub of GUARDED_CITY_HUBS) {
    const resolved = resolveCategorySlug(slugify(hub.label), "CO");
    assert.deepEqual(resolved, { kind: "ciudad", label: hub.label, country: hub.country });
    const meta = buildCategoryMeta(resolved as ResolvedCategory, 25);
    assert.equal(meta.heading, `Empleos en ${hub.label}: trabajo y ofertas de empleo`);
    assert.equal(meta.canonicalUrl, `${SITE_URL}/empleos/${slugify(hub.label)}`);
    assert.ok(meta.description.includes("25 vacantes"));
    assert.ok(meta.description.length <= 165, `${hub.label}: ${meta.description.length}`);
    assert.ok(meta.title.length <= 75, `${hub.label}: ${meta.title.length}`);
  }
});

test("SEC-002 a guarded city has one URL whatever the request prefix", () => {
  for (const hub of GUARDED_CITY_HUBS) {
    const slug = slugify(hub.label);
    const fromVe = resolveCategorySlug(slug, "VE");
    assert.equal(fromVe?.country, hub.country);
    assert.equal(buildCategoryPath(fromVe as ResolvedCategory), `/empleos/${slug}`);
  }
});

test("SEC-003 guarded slugs collide with no city, role, intent or retired role", () => {
  assert.equal(new Set(guardedSlugs).size, guardedSlugs.length);
  const taken = new Set<string>([
    ...CITY_OPTIONS.map(slugify),
    ...COUNTRIES.VE.cities.map(slugify),
    ...DEFAULT_ROLES_200.map(slugify),
    ...listIntentCategories().map((intent) => String(intent.intent)),
    ...RETIRED_ROLE_SLUGS
  ]);
  for (const slug of guardedSlugs) assert.ok(!taken.has(slug), slug);
});

test("SEC-004 an unknown slug is still not a category, and a second segment adds nothing", () => {
  assert.equal(resolveCategorySlug("ciudad-que-no-existe"), null);
  assert.equal(resolveCategorySlug("sincelejo"), null);
  const withSegment = resolveCategoryPath(["soacha", "sin-experiencia"], "CO");
  assert.deepEqual(withSegment, { kind: "ciudad", label: "Soacha", country: "CO" });
});

test("SEC-010/011 the guard: noindex,follow below 10 jobs, indexable from 10", () => {
  assert.equal(intentRobots(0), "noindex,follow");
  assert.equal(intentRobots(9), "noindex,follow");
  assert.equal(intentRobots(10), null);
});

test("SEC-012 the sitemap lists only the guarded hubs and index pages it is given", () => {
  const before = buildCategoriesSitemapXml({ intents: [] });
  for (const slug of guardedSlugs) assert.ok(!before.includes(`/empleos/${slug}</loc>`), slug);
  assert.ok(!before.includes(`<loc>${SITE_URL}/empleos</loc>`));

  const yopal: ResolvedCategory = { kind: "ciudad", label: "Yopal", country: "CO" };
  const after = buildCategoriesSitemapXml({ intents: [], guardedCities: [yopal], indexPaths: ["/empleos", "/ve/empleos"] });
  const locs = [...after.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  assert.ok(locs.includes(`${SITE_URL}/empleos/yopal`));
  assert.ok(locs.includes(`${SITE_URL}/empleos`));
  assert.ok(locs.includes(`${SITE_URL}/ve/empleos`));
  assert.ok(!locs.includes(`${SITE_URL}/empleos/soacha`));
  assert.equal(new Set(locs).size, locs.length, "no duplicated URL");
  const beforeLocs = [...before.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  assert.equal(locs.length, beforeLocs.length + 3);
});

test("SEC-013 /empleos links a guarded page only from a known total of 10 or more", () => {
  const none = buildEmpleosIndexSections("CO", () => undefined);
  for (const slug of guardedSlugs) assert.ok(!none.cities.some((link) => link.href === `/empleos/${slug}`), slug);
  assert.deepEqual(none.intents, []);

  const totals = new Map<string, number>([
    ["/empleos/yopal", 10],
    ["/empleos/soacha", 9],
    ["/empleos/maturin", 40],
    ["/empleos/sin-experiencia", 232],
    ["/empleos/temporada", 3]
  ]);
  const co = buildEmpleosIndexSections("CO", (category) => totals.get(buildCategoryPath(category)));
  const hrefs = co.cities.map((link) => link.href);
  assert.ok(hrefs.includes("/empleos/yopal"));
  assert.ok(!hrefs.includes("/empleos/soacha"), "below the guard");
  assert.ok(!hrefs.includes("/empleos/barrancabermeja"), "unknown total");
  assert.ok(!hrefs.includes("/empleos/maturin"), "another country's city");
  assert.deepEqual(co.intents.map((link) => link.href), ["/empleos/sin-experiencia"]);

  const ve = buildEmpleosIndexSections("VE", (category) => totals.get(buildCategoryPath(category)));
  assert.ok(ve.cities.some((link) => link.href === "/empleos/maturin"));
});

test("SEC-020/021 meta, canonical and reciprocal hreflang of the two index pages", () => {
  assert.equal(empleosIndexCountryForPath("/empleos"), "CO");
  assert.equal(empleosIndexCountryForPath("/ve/empleos"), "VE");
  assert.equal(empleosIndexCountryForPath("/empleos/"), null);
  assert.equal(empleosIndexCountryForPath("/empleos/bogota"), null);

  for (const [country, path, name] of [["CO", "/empleos", "Colombia"], ["VE", "/ve/empleos", "Venezuela"]] as const) {
    for (const total of [null, 4280, 29315]) {
      const meta = buildEmpleosIndexMeta(country, total);
      assert.equal(meta.canonicalUrl, `${SITE_URL}${path}`);
      assert.equal(meta.heading, `Empleos en ${name}`);
      assert.ok(meta.title.startsWith(`Empleos en ${name}`));
      assert.ok(meta.title.length <= 60, `${meta.title.length}`);
      assert.ok(meta.description.length >= 140 && meta.description.length <= 160, `${country} ${total}: ${meta.description.length}`);
    }
  }
  const tags = buildEmpleosIndexHreflangTags();
  assert.ok(tags.includes(`hreflang="es-CO" href="${SITE_URL}/empleos"`));
  assert.ok(tags.includes(`hreflang="es-VE" href="${SITE_URL}/ve/empleos"`));
  assert.ok(tags.includes(`hreflang="x-default" href="${SITE_URL}/empleos"`));
});

test("SEC-022 a number appears only when a real total was passed in", () => {
  assert.ok(buildEmpleosIndexMeta("CO", 29315).description.includes("29.315 ofertas"));
  assert.ok(buildEmpleosIndexIntro("CO", 29315).includes("29.315 ofertas"));
  for (const total of [null, 0]) {
    assert.ok(!/\d/.test(buildEmpleosIndexMeta("CO", total).description));
    assert.ok(!/\d/.test(buildEmpleosIndexIntro("CO", total)));
  }
});

test("SEC-023 the page links every existing city hub of its country and every role hub", () => {
  const co = buildEmpleosIndexSections("CO", () => undefined);
  const coCities = CITY_OPTIONS.filter((city) => city !== "Remoto");
  assert.equal(co.cities.length, coCities.length);
  for (const city of coCities) assert.ok(co.cities.some((link) => link.href === `/empleos/${slugify(city)}`), city);
  assert.equal(co.roles.length, DEFAULT_ROLES_200.length);
  assert.ok(co.roles.every((link) => link.href.startsWith("/empleos/")));
  // Every href resolves to a real category of that country.
  for (const link of [...co.cities, ...co.roles]) {
    assert.ok(resolveCategoryPath(link.href.slice("/empleos/".length).split("/"), "CO"), link.href);
  }
  const ve = buildEmpleosIndexSections("VE", () => undefined);
  assert.equal(ve.cities.length, COUNTRIES.VE.cities.length);
  assert.ok(ve.roles.every((link) => link.href.startsWith("/ve/empleos/")));
  assert.ok(ve.more.some((link) => link.href === "/ve/dashboard"));
});

const samplePayload: EmpleosIndexPayload = {
  country: "CO",
  total: 29315,
  jobs: [
    {
      path: "/empleos/11111111-1111-4111-8111-111111111111/auxiliar-bogota",
      url: `${SITE_URL}/empleos/11111111-1111-4111-8111-111111111111/auxiliar-bogota`,
      title: 'Auxiliar <script>alert("x")</script>',
      company: "Empresa & Cía",
      location: "Bogotá"
    }
  ],
  sections: buildEmpleosIndexSections("CO", () => undefined)
};

test("SEC-024 raw HTML and JSON-LD list exactly the jobs on the page, escaped", () => {
  const html = renderEmpleosIndexHtml(samplePayload);
  assert.ok(html.startsWith("<h1>Empleos en Colombia</h1>"));
  assert.ok(html.includes("29.315 ofertas"));
  assert.ok(!html.includes("<script>"), "job titles are escaped");
  assert.ok(html.includes("Empresa &amp; Cía"));
  assert.ok(html.includes('href="/empleos/bogota"'));
  assert.ok(!html.includes("data-empleos-intents"), "no intent section without known totals");

  const itemList = buildEmpleosIndexItemList(samplePayload) as { numberOfItems: number; itemListElement: Array<{ url: string }> };
  assert.equal(itemList.numberOfItems, 1);
  assert.equal(itemList.itemListElement[0].url, samplePayload.jobs[0].url);
  assert.equal(buildEmpleosIndexItemList({ ...samplePayload, jobs: [] }), null);

  const breadcrumb = buildEmpleosIndexBreadcrumbList("VE") as { itemListElement: Array<{ item: string }> };
  assert.deepEqual(breadcrumb.itemListElement.map((entry) => entry.item), [`${SITE_URL}/ve`, `${SITE_URL}/ve/empleos`]);

  // Without jobs or a total the page still renders its links and no number.
  const empty = renderEmpleosIndexHtml({ ...samplePayload, total: null, jobs: [] });
  assert.ok(!empty.includes("data-empleos-jobs"));
  assert.ok(empty.includes("data-empleos-cities"));
});

test("SEC-026 the client accepts only a well-formed payload", () => {
  assert.ok(isEmpleosIndexPayload(samplePayload));
  assert.ok(isEmpleosIndexPayload(JSON.parse(JSON.stringify({ ...samplePayload, total: null }))));
  assert.ok(!isEmpleosIndexPayload(null));
  assert.ok(!isEmpleosIndexPayload({ ...samplePayload, country: "AR" }));
  assert.ok(!isEmpleosIndexPayload({ ...samplePayload, sections: { cities: [] } }));
});

test("SEC-030/031 existing hubs, job breadcrumbs and the dashboard city list are untouched", () => {
  // No guarded city entered the shared lists.
  for (const hub of GUARDED_CITY_HUBS) {
    assert.ok(!CITY_OPTIONS.includes(hub.label), hub.label);
    assert.ok(!COUNTRIES.CO.cities.includes(hub.label) && !COUNTRIES.VE.cities.includes(hub.label), hub.label);
  }
  // Existing hubs link the same cities as before: none of the guarded ones.
  const bogota: ResolvedCategory = { kind: "ciudad", label: "Bogotá", country: "CO" };
  const related = buildRelatedCityLinks(bogota).map((link) => link.href);
  assert.equal(related.length, CITY_OPTIONS.filter((city) => city !== "Remoto").length - 1);
  for (const slug of guardedSlugs) assert.ok(!related.includes(`/empleos/${slug}`), slug);
  // A job in a guarded city gets no hub breadcrumb (job pages do not change).
  assert.equal(resolveJobCityHub({ location: "Yopal, Casanare", country: "CO" }), null);
  assert.equal(resolveJobCityHub({ location: "Soacha", country: "CO" }), null);
  assert.equal(isGuardedCityHub(bogota), false);
  assert.equal(isGuardedCityHub({ kind: "rol", label: "Yopal", country: "CO" }), false);
  // A guarded hub filters by its own city and country, like any city hub.
  assert.deepEqual(cityHubFilters({ kind: "ciudad", label: "Yopal", country: "CO" }), { cities: ["Yopal"], country: "CO" });
});

test("the intent cache holds every intent page and every guarded hub", () => {
  assert.ok(INTENT_PAGE_CACHE_ENTRIES >= listIntentCategories().length + listGuardedCityHubs().length + 4);
});

test("SEC-040 rollback flag: on by default, off with false/0/off", () => {
  assert.equal(empleosCoverageEnabled({}), true);
  assert.equal(empleosCoverageEnabled({ EMPLEOS_COVERAGE_ENABLED: "true" }), true);
  for (const value of ["false", "0", "off", " FALSE "]) {
    assert.equal(empleosCoverageEnabled({ EMPLEOS_COVERAGE_ENABLED: value }), false, value);
  }
});
