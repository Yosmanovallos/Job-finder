import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCategoryInsights,
  buildCategoryMeta,
  buildCategoryStatsCopy,
  resolveCategorySlug,
  type SeoJob
} from "../src/lib/job-seo.js";
import { CITY_OPTIONS } from "../src/lib/job-filters.js";
import { getCountryConfig } from "../src/countries/index.js";

const AS_OF = new Date("2026-10-29T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function job(index: number, overrides: Partial<SeoJob> = {}): SeoJob {
  return {
    jobId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    title: `Analista ${index}`,
    company: "Empresa Uno",
    location: "Santa Marta, Colombia",
    url: `https://example.invalid/${index}`,
    source: "LinkedIn",
    country: "CO",
    publishedAt: new Date(AS_OF.getTime() - DAY).toISOString(),
    ...overrides
  } as SeoJob;
}

const santaMarta = resolveCategorySlug("santa-marta", "CO")!;
const caracas = resolveCategorySlug("caracas", "VE")!;

test("CHS-001 7-day count is exact below the cap and a lower bound at it", () => {
  const mixed = [job(1), job(2), job(3, { publishedAt: new Date(AS_OF.getTime() - 12 * DAY).toISOString() })];
  const exact = buildCategoryInsights(santaMarta, 90, mixed, AS_OF);
  assert.equal(exact.freshLast7Days, 2);
  assert.equal(exact.freshLast7DaysIsLowerBound, false);
  assert.equal(exact.freshLast7DaysLabel, "2");
  assert.equal(exact.activeLast30Days, 90);

  const allFresh = Array.from({ length: 60 }, (_, i) => job(i + 1));
  const capped = buildCategoryInsights(santaMarta, 140, allFresh, AS_OF);
  assert.equal(capped.freshLast7DaysIsLowerBound, true);
  assert.equal(capped.freshLast7DaysLabel, "60+");
  const copy = buildCategoryStatsCopy(santaMarta, capped)!;
  assert.match(copy.summary, /^140 vacantes activas publicadas en los últimos 30 días; al menos 60 son de los últimos 7 días\.$/);
  assert.match(copy.basis, /las 60 ofertas más recientes/);

  // Not capped: every job is visible, so all-fresh is exact.
  const whole = buildCategoryInsights(santaMarta, 60, allFresh, AS_OF);
  assert.equal(whole.freshLast7DaysIsLowerBound, false);
  assert.equal(whole.freshLast7DaysLabel, "60");
});

test("CHS-002 companies ranked with real counts, placeholders excluded", () => {
  const jobs = [
    job(1, { company: "Olímpica" }),
    job(2, { company: "Olímpica" }),
    job(3, { company: "Confidencial" }),
    job(4, { company: "Confidencial" }),
    job(5, { company: "Confidencial" }),
    job(6, { company: "Ara" })
  ];
  const insights = buildCategoryInsights(santaMarta, 6, jobs, AS_OF);
  assert.deepEqual(insights.companyRanking, [
    { label: "Olímpica", count: 2 },
    { label: "Ara", count: 1 }
  ]);
  const copy = buildCategoryStatsCopy(santaMarta, insights)!;
  assert.deepEqual(copy.companies, ["Olímpica: 2 ofertas", "Ara: 1 oferta"]);
});

test("CHS-003 most requested roles need two matches and link the city's country", () => {
  const jobs = [
    job(1, { title: "Asesor comercial" }),
    job(2, { title: "Asesor Comercial Senior" }),
    job(3, { title: "Auxiliar de bodega" })
  ];
  const insights = buildCategoryInsights(santaMarta, 3, jobs, AS_OF);
  const asesor = insights.topRoles.find((role) => role.label === "Asesor Comercial");
  assert.ok(asesor, JSON.stringify(insights.topRoles));
  assert.equal(asesor.count, 2);
  assert.equal(asesor.href, "/empleos/asesor-comercial");
  assert.ok(insights.topRoles.every((role) => role.count >= 2));

  const ve = buildCategoryInsights(
    caracas,
    2,
    [job(1, { title: "Asesor comercial", country: "VE" }), job(2, { title: "Asesor comercial", country: "VE" })],
    AS_OF
  );
  assert.ok(ve.topRoles.length > 0 && ve.topRoles.every((role) => role.href.startsWith("/ve/empleos/")));

  const role = resolveCategorySlug("asesor-comercial", "CO")!;
  assert.deepEqual(buildCategoryInsights(role, 2, jobs, AS_OF).topRoles, []);
});

test("CHS-004 salary range only from numbers with a published currency", () => {
  const withSalary = [
    job(1, { salaryMin: 1_600_000, salaryMax: 2_600_000, salaryCurrency: "COP" }),
    job(2, { salaryMin: 1_700_000, salaryMax: 2_800_000, salaryCurrency: "COP" }),
    job(3, { salaryMax: 2_000_000, salaryCurrency: "cop" }),
    job(4, { salaryMin: 3_000, salaryMax: 4_000, salaryCurrency: "USD" }),
    // No currency, a 0 sentinel and free text never count.
    job(5, { salaryMin: 9_000_000 }),
    job(6, { salaryMin: 0, salaryMax: 0, salaryCurrency: "COP" }),
    job(7, { salaryRaw: "Hasta 20 millones" })
  ];
  const insights = buildCategoryInsights(santaMarta, 7, withSalary, AS_OF);
  assert.deepEqual(insights.salaryRange, { currency: "COP", min: 1_600_000, max: 2_800_000, jobCount: 3 });
  const copy = buildCategoryStatsCopy(santaMarta, insights)!;
  assert.equal(
    copy.salary,
    "Salario publicado por la fuente en 3 de las 7 ofertas de la muestra: entre COP 1.600.000 y COP 2.800.000."
  );

  const tooFew = buildCategoryInsights(santaMarta, 2, withSalary.slice(0, 2), AS_OF);
  assert.equal(tooFew.salaryRange, null);
  assert.equal(buildCategoryStatsCopy(santaMarta, tooFew)!.salary, null);
});

test("CHS-005 empty hubs render no statistics section", () => {
  assert.equal(buildCategoryStatsCopy(santaMarta, buildCategoryInsights(santaMarta, 0, [], AS_OF)), null);
});

test("CHS-006 city descriptions target the real queries and stay short", () => {
  const meta = buildCategoryMeta(santaMarta, 312);
  assert.equal(meta.title, "Empleos en Santa Marta: trabajo y ofertas de empleo | BuscoTrabajo");
  assert.match(meta.description, /^¿Buscas trabajo en Santa Marta\? 312 vacantes y ofertas de empleo activas\./);
  const cities = [...CITY_OPTIONS.filter((city) => city !== "Remoto"), ...getCountryConfig("VE").cities];
  for (const city of cities) {
    const category = resolveCategorySlug(city.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "-"), "CO")
      ?? resolveCategorySlug(city.toLowerCase().replace(/\s+/g, "-"), "VE");
    assert.ok(category, city);
    const description = buildCategoryMeta(category, 12_345).description;
    assert.ok(description.length <= 160, `${city}: ${description.length} ${description}`);
  }
  // The remote bucket and role pages keep their own wording.
  assert.match(buildCategoryMeta(resolveCategorySlug("remoto", "CO")!, 5).description, /^Encuentra 5 vacantes de trabajo remoto/);
});
