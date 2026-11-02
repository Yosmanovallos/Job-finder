/**
 * Job page <title> and meta description (F5, contract §5) — pure, offline.
 * JMT-001 pins hashes computed on origin/main (4459862) before the change.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  JOB_META_DESCRIPTION_MAX,
  JOB_TITLE_TAG_MAX,
  buildCompanyMeta,
  buildJobMeta,
  buildJobPageBody,
  buildJobPagePayload,
  buildJobPosting,
  buildJobSitemapEntry,
  buildJobUrl,
  clipAtWord,
  firstSourceSentence,
  injectJobHeadMeta,
  isGoogleEligiblePage
} from "../src/lib/job-seo.js";
import { ROUTE_META, companiesDirectoryMeta, dashboardDescription } from "../src/lib/page-meta.js";
import {
  META_FIXTURES,
  bareJob,
  boardJob,
  confidentialJob,
  fullJob,
  longTitleJob,
  messyJob,
  noCityJob,
  noCompanyJob,
  officialJob,
  remoteJob
} from "./fixtures/job-meta.js";

const sha = (value: unknown) =>
  createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const length = (text: string) => Array.from(text).length;

const UNCHANGED: Record<string, string> = {
  "aaaaaaaa-1111-4111-8111-111111111111": "02c96f68b5f1067464b2e220bc11323cc5abfa641f001fdcc0cb4688b65dd5f8",
  "bbbbbbbb-2222-4222-8222-222222222222": "6af077468311af35260abb7ad59b7baa4572dc2a08428bf25aa6b2e0c00498cf",
  "cccccccc-3333-4333-8333-333333333333": "fd5ec908b2d98e4859728ea0dd7d25171ca256a56d24572ab664dc92cf2116ac",
  "dddddddd-4444-4444-8444-444444444444": "e42c0979b918c6cccfe2457f92e9c74fe4f7e819d22e6ffde1b2c1add49a856e",
  "eeeeeeee-5555-4555-8555-555555555555": "c9ff1ea5ab857ffd61d2d5fdeaac952a7c01593ed3394ad96c7e3a5ecc079627",
  "ffffffff-6666-4666-8666-666666666666": "1d3f4d1b6c4bd47987415e40ea00f9b64cfd20a00311f5a36974f79d068c7d6c",
  "abababab-7777-4777-8777-777777777777": "44497a74a6c042bb7e5c356d29031906f304af50f5e851b63bbbe202422aa343",
  "cdcdcdcd-8888-4888-8888-888888888888": "ef08c4694b4f280134a8bc95917d829db32b9ac57581bd27848beff7773b0549",
  "efefefef-9999-4999-8999-999999999999": "805c3093a7ee901cb3f001a43a99dbd1f644c52b54856d0c28497e598369e268",
  "fafafafa-0000-4000-8000-000000000000": "8dcbec100aed4e4e1b1e73c6b047a81088e0a138bd200e3e2fe2044c7a71f743"
};
const OTHER_PAGES_UNCHANGED = "306fc945966e687ab5799bbb22cc3723f654cd71d2e5f6eeb48b1d1ce9a6f03e";

test("JMT-001 visible body, JobPosting, payload, canonical, robots verdict, sitemap and other pages' meta are unchanged", () => {
  for (const job of META_FIXTURES) {
    const actual = sha({
      body: buildJobPageBody(job),
      posting: buildJobPosting(job),
      payload: buildJobPagePayload(job),
      url: buildJobUrl(job),
      eligible: isGoogleEligiblePage(job),
      sitemap: buildJobSitemapEntry(job as Parameters<typeof buildJobSitemapEntry>[0])
    });
    assert.equal(actual, UNCHANGED[job.jobId], job.jobId);
    assert.equal(buildJobMeta(job).canonicalUrl, buildJobUrl(job));
  }
  const other = sha({
    ROUTE_META,
    dir: companiesDirectoryMeta("Colombia"),
    dash: dashboardDescription("CO", "Colombia"),
    company: buildCompanyMeta("Accenture Colombia", 12, "CO")
  });
  assert.equal(other, OTHER_PAGES_UNCHANGED, "hub, dashboard and company titles are untouched");
});

test("JMT-002 full vacancy: title with city and company, description with type and the first real sentence", () => {
  const meta = buildJobMeta(fullJob);
  assert.equal(meta.title, "Oracle DBA en Bogota – Amaris Consulting | BuscoTrabajo");
  assert.equal(
    meta.description,
    "Oracle DBA en Amaris Consulting, Bogota, D.C., Capital District, Colombia. Tiempo completo. Únete a Amaris Consulting como Administrador de Bases de Datos…"
  );
});

test("JMT-003 a missing city or company is left out, never filled", () => {
  assert.equal(buildJobMeta(noCityJob).title, "Oracle DBA – Amaris Consulting | BuscoTrabajo");
  assert.ok(buildJobMeta(noCityJob).description.startsWith("Oracle DBA en Amaris Consulting. Tiempo completo. "));
  for (const job of [confidentialJob, noCompanyJob]) {
    const meta = buildJobMeta(job);
    assert.equal(meta.title, "Oracle DBA en Bogota | BuscoTrabajo", job.jobId);
    assert.ok(meta.description.startsWith("Oracle DBA, Bogota, D.C., Capital District, Colombia. "), job.jobId);
    assert.doesNotMatch(`${meta.title} ${meta.description}`, /confidencial/i);
  }
  assert.equal(
    buildJobMeta({ ...fullJob, title: "Inspector de Calidad", company: "Ejemplo", location: "Cali" }).title,
    "Inspector de Calidad en Cali – Ejemplo | BuscoTrabajo",
    "a city inside another word is not 'already in the title'"
  );
  assert.equal(buildJobMeta(remoteJob).title, "Oracle DBA – Amaris Consulting | BuscoTrabajo", "a remote job gets no city");
  assert.equal(buildJobMeta(bareJob).description, "Oracle DBA en Amaris Consulting, Bogota, D.C., Capital District, Colombia.");
});

test("JMT-004 the job title is never cut; the rest is dropped to fit about 60 characters", () => {
  assert.equal(buildJobMeta(longTitleJob).title, longTitleJob.title);
  // Brand before city or employer.
  assert.equal(buildJobMeta(boardJob).title, "Analista de Riesgo <Crédito> & Cartera en Bogotá");
  assert.equal(
    buildJobMeta({ ...fullJob, title: "Practicante Universitario de Compras", location: "Medellín" }).title,
    "Practicante Universitario de Compras en Medellín"
  );
  assert.equal(
    firstSourceSentence("Practicante de Compras (Gestión de Proveedores) Lleva tus conocimientos a la práctica.", "Practicante de Compras"),
    "Lleva tus conocimientos a la práctica."
  );
  for (const job of META_FIXTURES) {
    const { title, description } = buildJobMeta(job);
    assert.ok(title.includes(job.title), job.jobId);
    assert.ok(length(title) <= JOB_TITLE_TAG_MAX || title === job.title, `${job.jobId}: ${title}`);
    assert.ok(description.startsWith(job.title), job.jobId);
    assert.ok(length(description) <= JOB_META_DESCRIPTION_MAX || !description.includes(". "), `${job.jobId}: ${description}`);
  }
});

test("JMT-005 description with markup, emoji, a repeated title and abbreviations", () => {
  const { title, description } = buildJobMeta(messyJob);
  assert.equal(title, "🎯Asesor(a) Comercial - Medellín📉 – Banco Ejemplo", "city already in the title is not repeated");
  const sentence = description.slice(`${messyJob.title} en Banco Ejemplo, Medellín, Antioquia. `.length);
  assert.equal(sentence, "¡Convierte cada interacción en una oportunidad $& de negocio $` con el Sr. Gómez!");
  assert.equal(
    firstSourceSentence("La Posición\nEstamos buscando un/a Controlling Sr. Analyst, con perfil financiero. Otra.", "X"),
    "Estamos buscando un/a Controlling Sr. Analyst, con perfil financiero."
  );
  assert.equal(firstSourceSentence("Envía tu hoja de vida a rrhh@example.invalid hoy mismo", "X"), null);
});

test("JMT-006 official portal vacancies follow the same rules", () => {
  const meta = buildJobMeta(officialJob);
  assert.equal(meta.title, "Ingeniero de Procesos en Sopó – Alpina | BuscoTrabajo");
  assert.equal(meta.description, "Ingeniero de Procesos en Alpina, Sopó, Cundinamarca. Tiempo completo. Diseñarás mejoras de proceso en planta.");
});

test("JMT-007 no boilerplate left in any description", () => {
  for (const job of META_FIXTURES) {
    assert.doesNotMatch(buildJobMeta(job).description, /Vacante agregada|en BuscoTrabajo —|portal oficial de empleo de/, job.jobId);
  }
});

test("JMT-008 the hydrated head equals the server one (built from the public payload)", () => {
  for (const job of META_FIXTURES) {
    assert.deepEqual(buildJobMeta(buildJobPagePayload(job).job), buildJobMeta(job), job.jobId);
  }
});

test("JMT-009 clipping never splits a word or a multibyte character", () => {
  assert.equal(clipAtWord("Únete a nuestro equipo de bodega", 20), "Únete a nuestro…");
  assert.equal(clipAtWord("corto", 20), "corto");
  assert.equal(clipAtWord("😀".repeat(30), 10), "", "no space to cut at: drop, never split");
  for (const job of META_FIXTURES) {
    assert.doesNotMatch(buildJobMeta(job).description, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, job.jobId);
  }
});

test("JMT-010 injected head escapes source text and never expands $ patterns", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const shell = fs.readFileSync(path.join(here, "..", "index.html"), "utf-8");
  const meta = { ...buildJobMeta(messyJob), title: `Cargo "<x>" $' $& $$ | BuscoTrabajo` };
  const html = injectJobHeadMeta(shell, meta);
  const escaped = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "";
  assert.ok(escaped.includes("oportunidad $&amp; de negocio $` con"), escaped);
  assert.ok(html.includes(`<title>Cargo &quot;&lt;x&gt;&quot; $&#39; $&amp; $$ | BuscoTrabajo</title>`));
  assert.equal(html.match(/<title>/g)?.length, 1);
  assert.equal(html.match(/<meta name="description"/g)?.length, 1);
  for (const tag of ["og:title", "og:description", "twitter:title", "twitter:description"]) {
    assert.equal(html.match(new RegExp(`${tag}"`, "g"))?.length, 1, tag);
  }
  assert.ok(html.includes(`<meta property="og:description" content="${escaped}" />`));
  assert.ok(html.includes(`<link rel="canonical" href="${meta.canonicalUrl}" />`));
});
