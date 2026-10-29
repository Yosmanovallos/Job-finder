/**
 * Job page link graph (docs/SEO-JOB-LINK-GRAPH-2026-10-29.md) — pure, offline.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobBreadcrumbList,
  cityHubFilters,
  pickRelatedJobs,
  readJobLinks,
  renderJobBreadcrumbHtml,
  renderRelatedJobsHtml,
  resolveJobCityHub
} from "../src/lib/job-internal-links.js";
import { buildCategoryPath, resolveCategorySlug } from "../src/lib/job-seo.js";

// JS twin of buildJobWhere's city predicate:
// LOWER(TRANSLATE(location, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')) LIKE '%<folded city>%'
// plus the country predicate (country IS NULL OR country = X).
function hubSqlWouldList(job: { location: string; country: string | null }, filters: { cities: string[]; country: string }) {
  const from = "áéíóúüñÁÉÍÓÚÜÑ";
  const to = "aeiouunAEIOUUN";
  const translated = [...job.location].map((ch) => (from.includes(ch) ? to[from.indexOf(ch)] : ch)).join("").toLowerCase();
  const cityOk = filters.cities.some((city) =>
    translated.includes(city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase())
  );
  return cityOk && (job.country === null || job.country === filters.country);
}

const LOCATIONS: Array<[string, string | null, string | null]> = [
  ["Pereira, Risaralda, Colombia", "CO", "Pereira"],
  ["Fontibón, Bogotá D.C., Soacha", "CO", "Bogotá"],
  ["Bogota, D.C., Capital District, Colombia", "CO", "Bogotá"],
  ["Ibagué, Tolima", "CO", "Ibagué"],
  ["Cúcuta, Norte de Santander", "CO", "Cúcuta"],
  ["Caracas, Federal District, Venezuela", "VE", "Caracas"],
  ["Barquisimeto, Lara State, Venezuela", "VE", "Barquisimeto"],
  ["Caracas, Venezuela", "CO", null],
  ["Remoto", null, null],
  ["Apartadó, Antioquia, Colombia", "CO", null]
];

test("each job resolves to the city hub whose SQL filter actually lists it", () => {
  for (const [location, country, expected] of LOCATIONS) {
    const hub = resolveJobCityHub({ location, country });
    assert.equal(hub?.label ?? null, expected, location);
    if (!hub) continue;
    assert.ok(hubSqlWouldList({ location, country }, cityHubFilters(hub)), `hub ${hub.label} must list ${location}`);
    const slug = buildCategoryPath(hub).split("/").pop()!;
    assert.deepEqual(resolveCategorySlug(slug), hub, "the linked hub URL resolves back to the same category");
  }
});

const candidates = Array.from({ length: 20 }, (_, i) => ({
  jobId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  title: `Cargo ${i}`,
  company: `Empresa ${i}`,
  location: "Pereira, Risaralda",
  url: `https://example.com/${i}`
}));

test("related jobs exclude the job itself, are stable, bounded and rotate per job", () => {
  const self = candidates[3].jobId;
  const picked = pickRelatedJobs(self, candidates);
  assert.equal(picked.length, 6);
  assert.ok(picked.every((link) => !link.path.includes(self)));
  assert.deepEqual(pickRelatedJobs(self, candidates), picked, "deterministic");
  const firsts = new Set(candidates.map((job) => pickRelatedJobs(job.jobId, candidates)[0].path));
  assert.ok(firsts.size > 5, "different jobs link different slices of the hub");
  assert.deepEqual(pickRelatedJobs(self, [{ ...candidates[0], company: null }]), [], "incomplete jobs are skipped");
  assert.deepEqual(pickRelatedJobs(self, []), []);
});

test("raw HTML links are escaped and point at the hub", () => {
  const hub = resolveJobCityHub({ location: "Pereira", country: "CO" });
  const hostile = { title: '<img src=x onerror=alert(1)>' };
  const crumb = renderJobBreadcrumbHtml(hostile, hub);
  assert.ok(crumb.includes('href="/empleos/pereira"'));
  assert.ok(!crumb.includes("<img"));
  const related = renderRelatedJobsHtml(hub, [{ path: "/empleos/x/y", title: '"><script>', company: "A", location: "B" }]);
  assert.ok(!related.includes("<script>"));
  assert.ok(related.includes("Más empleos en Pereira"));
  assert.equal(renderRelatedJobsHtml(null, []), "");
  assert.ok(renderRelatedJobsHtml(hub, []).includes('href="/empleos/pereira"'), "the hub link survives a cold cache");
});

test("BreadcrumbList mirrors the visible trail", () => {
  const job = { jobId: candidates[0].jobId, title: "Analista", location: "Pereira" };
  const list = buildJobBreadcrumbList(job, resolveJobCityHub({ location: "Pereira", country: "CO" })) as {
    itemListElement: Array<{ position: number; name: string; item: string }>;
  };
  assert.deepEqual(list.itemListElement.map((entry) => entry.name), ["Inicio", "Empleos en Pereira", "Analista"]);
  assert.equal(list.itemListElement[1].item, "https://buscotrabajo.co/empleos/pereira");
  const noHub = buildJobBreadcrumbList(job, null) as { itemListElement: unknown[] };
  assert.equal(noHub.itemListElement.length, 2);
});

test("the client only trusts this job's own path-only links", () => {
  const id = candidates[0].jobId;
  const link = { path: "/empleos/a/b", title: "T", company: "C", location: "L" };
  assert.deepEqual(readJobLinks(id, { jobId: id, related: [link] }), [link]);
  assert.deepEqual(readJobLinks(id, { jobId: "other", related: [link] }), []);
  assert.deepEqual(readJobLinks(id, { jobId: id, related: [{ ...link, path: "javascript:alert(1)" }] }), []);
  assert.deepEqual(readJobLinks(id, { jobId: id, related: [{ ...link, path: "https://evil.example/empleos/x" }] }), []);
  assert.deepEqual(readJobLinks(id, null), []);
});
