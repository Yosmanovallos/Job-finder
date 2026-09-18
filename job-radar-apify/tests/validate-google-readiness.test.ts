/**
 * Job SEO V2 — pure contract tests (unit suite, offline, no DB).
 * The shared Google gate, the description quality rules, and the JobPosting /
 * visible-body / sitemap consumers built on it. DB-level consumers (robots
 * over HTTP, Indexing API queue) are covered by validate-job-seo-v2.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGoogleJobReadiness, isGoogleReadyNow, type ReadinessInput } from "../src/lib/google-job-readiness.js";
import { assessDescription } from "../src/lib/job-description-quality.js";
import {
  buildJobPageBody,
  buildJobPosting,
  buildJobsSitemapXml,
  escapeJsonForScriptTag,
  isGoogleEligiblePage,
  renderJobDescriptionHtml,
  type SeoJob
} from "../src/lib/job-seo.js";
import { extractJobPostingDetail } from "../src/lib/job-posting-jsonld.js";

/** The JobPosting properties these tests read. */
interface PostingShape {
  title?: string;
  description?: string;
  employmentType?: string;
  validThrough?: string;
  jobLocationType?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: { address: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
  applicantLocationRequirements?: { name: string }[];
  [key: string]: unknown;
}

const NOW = new Date("2026-09-18T12:00:00Z");

const RICH_DESCRIPTION = [
  "Buscamos una persona analista de datos para el equipo de riesgo crediticio de la compañía.",
  "Serás responsable de construir tableros de seguimiento de cartera y automatizar reportes mensuales.",
  "Trabajarás con las áreas de cobranza y finanzas para priorizar los indicadores del negocio.",
  "Horario de lunes a viernes, contrato a término indefinido."
].join("\n");
const RICH_REQUIREMENTS = [
  "Profesional en ingeniería industrial, estadística o afines.",
  "Dos años de experiencia en análisis de datos financieros.",
  "Manejo de SQL y Power BI."
];

// Real shape of the 2026-09-17 LinkedIn sample (c53b3c52…): hospital website
// navigation stored as the "description", requirements duplicated verbatim.
const NAVIGATION_JUNK = {
  description: [
    "Emergencias: +56 72 2 335100",
    "Acceso",
    "Hospital San Fernando Informa",
    "COMPIN informa a la comunidad",
    "En el contexto de la atención de usuarios para gestión de licencias médicas, COMPIN informa que su lugar de recepción a público es en oficina."
  ].join("\n"),
  requirements: [
    "Transparencia Activa",
    "Gobierno Transparente",
    "Ley de Transparencia",
    "Ley del Lobby",
    "Formación Educacional: Título de Técnico de Nivel Superior en Enfermería.",
    "Especialización y/o Capacitación: Deseable curso de capacitación en IAAS.",
    "Experiencia: Deseable experiencia de al menos un año como Técnico Paramédico.",
    "Formación Educacional: Título de Técnico de Nivel Superior en Enfermería.",
    "Especialización y/o Capacitación: Deseable curso de capacitación en IAAS.",
    "Experiencia: Deseable experiencia de al menos un año como Técnico Paramédico."
  ]
};

function base(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    title: "Analista de Datos",
    company: "Banco Ejemplo S.A.",
    location: "Bogotá, D.C., Colombia",
    country: "CO",
    url: "https://www.elempleo.com/co/ofertas-trabajo/analista-de-datos/123",
    publishedAt: "2026-09-15T10:00:00Z",
    description: RICH_DESCRIPTION,
    requirements: RICH_REQUIREMENTS,
    descriptionKind: "full",
    isActive: true,
    isCanonical: true,
    ...overrides
  };
}

/** What a page would look like after the verdict is stored and read back. */
function asStoredPage(input: ReadinessInput): SeoJob {
  const verdict = evaluateGoogleJobReadiness(input, NOW);
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    title: input.title ?? "",
    company: input.company ?? "",
    location: input.location ?? "",
    url: input.url ?? "",
    dateText: "",
    source: "Elempleo",
    publishedAt: input.publishedAt ? String(input.publishedAt) : undefined,
    country: input.country ?? null,
    description: input.description ?? undefined,
    requirements: input.requirements ?? undefined,
    employmentType: "Tiempo completo",
    salary: "COP 4,000,000",
    remoteType: (input.remoteType ?? undefined) as SeoJob["remoteType"],
    applicantCountries: input.applicantCountries ?? undefined,
    validThrough: input.validThrough ? String(input.validThrough) : undefined,
    seoReady: verdict.ready,
    isActive: input.isActive !== false
  };
}

const FIXTURES: Record<string, { input: ReadinessInput; ready: boolean; reason?: string }> = {
  "valid rich physical job": { input: base(), ready: true },
  "valid rich fully remote job with a source-stated country": {
    input: base({ location: "Remoto", country: null, remoteType: "fully_remote", applicantCountries: ["CO", "MX"] }),
    ready: true
  },
  "remote job with unknown eligible country": {
    input: base({ location: "Remoto", country: null, remoteType: "fully_remote", applicantCountries: [] }),
    ready: false,
    reason: "INVALID_REMOTE_LOCATION"
  },
  "'Remoto' text with no source evidence of remote work": {
    input: base({ location: "Remoto", country: null }),
    ready: false,
    reason: "INVALID_REMOTE_LOCATION"
  },
  "hybrid job": { input: base({ location: "Híbrido - Medellín, Antioquia", remoteType: "hybrid" }), ready: true },
  "missing description": { input: base({ description: null, requirements: [] }), ready: false, reason: "MISSING_DESCRIPTION" },
  "generic BuscoTrabajo template description": {
    input: base({
      description:
        "Analista de Datos en Banco Ejemplo S.A., Bogotá. Modalidad: Presencial. Publicado el 15 de septiembre de 2026. Vacante agregada de Elempleo. Aplica directamente en la página de Elempleo.",
      requirements: []
    }),
    ready: false,
    reason: "DESCRIPTION_DUPLICATED_TEMPLATE"
  },
  "navigation-junk description": { input: base(NAVIGATION_JUNK), ready: false, reason: "DESCRIPTION_NAVIGATION_JUNK" },
  "one-line teaser (Torre tagline)": {
    input: base({
      description: "You will drive sustainable agricultural growth by empowering farmers with innovative technology.",
      requirements: [],
      descriptionKind: "snippet"
    }),
    ready: false,
    reason: "DESCRIPTION_SNIPPET"
  },
  "missing application URL": { input: base({ url: "javascript:alert(1)" }), ready: false, reason: "MISSING_APPLICATION_URL" },
  "expired (source validThrough in the past)": {
    input: base({ validThrough: "2026-09-01T00:00:00Z" }),
    ready: false,
    reason: "EXPIRED"
  },
  "noncanonical duplicate": { input: base({ isCanonical: false }), ready: false, reason: "NON_CANONICAL" },
  "inactive job": { input: base({ isActive: false }), ready: false, reason: "INACTIVE" },
  "title repeated as description": {
    input: base({ description: "Analista de Datos", requirements: [] }),
    ready: false,
    reason: "DESCRIPTION_IS_METADATA"
  },
  "captcha page": {
    input: base({ description: "Please complete the CAPTCHA to continue.\nWe need to verify you are human before showing this page." }),
    ready: false,
    reason: "DESCRIPTION_ERROR_PAGE"
  },
  "cookie banner": {
    input: base({ description: `${RICH_DESCRIPTION}\nUsamos cookies para mejorar tu experiencia. Aceptar cookies.` }),
    ready: false,
    reason: "DESCRIPTION_NAVIGATION_JUNK"
  },
  "truncated snippet": {
    input: base({ description: `${RICH_DESCRIPTION}\nEl candidato ideal tendrá experiencia en…`, requirements: [] }),
    ready: false,
    reason: "DESCRIPTION_TRUNCATED"
  },
  "application-only text": {
    input: base({ description: "Postúlate ya en el enlace.", requirements: [] }),
    ready: false,
    reason: "DESCRIPTION_APPLICATION_ONLY"
  },
  "location country conflict": {
    input: base({ location: "Santiago, Chile", country: "CO" }),
    ready: false,
    reason: "LOCATION_COUNTRY_CONFLICT"
  }
};

for (const [name, fixture] of Object.entries(FIXTURES)) {
  test(`gate: ${name}`, () => {
    const verdict = evaluateGoogleJobReadiness(fixture.input, NOW);
    assert.equal(verdict.ready, fixture.ready, `reasons: ${verdict.reasons.join(",")}`);
    if (fixture.reason) assert.ok(verdict.reasons.includes(fixture.reason as never), verdict.reasons.join(","));
    assert.ok(verdict.qualitySignals && typeof verdict.qualitySignals.letters === "number");
  });

  test(`consumers agree: ${name}`, () => {
    const page = asStoredPage(fixture.input);
    const eligible = isGoogleEligiblePage(page);
    const posting = buildJobPosting(page);
    const inSitemap = buildJobsSitemapXml([page]).includes("<loc>");
    assert.equal(eligible, fixture.ready, "eligibility ≠ gate");
    assert.equal(posting !== null, eligible, "JobPosting emitted ≠ eligibility");
    assert.equal(inSitemap, eligible, "sitemap membership ≠ eligibility");
    // The visible body exists for EVERY user-visible job, ready or not, with the source link.
    const body = buildJobPageBody(page);
    if (name === "missing application URL") {
      assert.doesNotMatch(body, /data-apply-link|javascript:/, "a non-http URL must never become a link");
    } else {
      assert.match(body, /data-apply-link href="https:\/\/www\.elempleo\.com\//);
    }
  });
}

test("JobPosting (physical): required fields, HTML description = visible body, no invented properties", () => {
  const page = asStoredPage(base());
  const posting = buildJobPosting(page) as PostingShape;
  assert.equal(posting.title, "Analista de Datos");
  assert.equal(posting.hiringOrganization!.name, "Banco Ejemplo S.A.");
  assert.equal(posting.jobLocation!.address.addressLocality, "Bogotá");
  assert.equal(posting.jobLocation!.address.addressCountry, "CO");
  assert.equal(posting.employmentType, "FULL_TIME");
  assert.match(posting.description ?? "", /^<p>Buscamos/);
  assert.match(posting.description ?? "", /<ul><li>Profesional en ingeniería/);
  for (const forbidden of ["validThrough", "baseSalary", "directApply", "identifier", "qualifications", "skills", "jobLocationType"]) {
    assert.equal(forbidden in posting, false, `${forbidden} must not be emitted`);
  }
  const body = buildJobPageBody(page);
  assert.ok(body.includes(posting.description ?? "\u0000"), "JSON-LD description must be byte-identical to the visible description");
  assert.ok(body.includes("Salario: COP 4,000,000"), "salary stays visible to humans");
  assert.ok(body.includes("<h1>Analista de Datos</h1>"));
});

test("JobPosting (fully remote): TELECOMMUTE + only the source-stated countries, no jobLocation", () => {
  const posting = buildJobPosting(
    asStoredPage(base({ location: "Remoto", country: null, remoteType: "fully_remote", applicantCountries: ["CO", "MX"] }))
  ) as PostingShape;
  assert.equal(posting.jobLocationType, "TELECOMMUTE");
  assert.deepEqual(
    posting.applicantLocationRequirements!.map((c) => c.name),
    ["Colombia", "México"]
  );
  assert.equal("jobLocation" in posting, false);
});

test("JobPosting (hybrid): jobLocation, never TELECOMMUTE", () => {
  const posting = buildJobPosting(asStoredPage(base({ location: "Híbrido - Medellín, Antioquia", remoteType: "hybrid" }))) as PostingShape;
  assert.equal(posting.jobLocationType, undefined);
  assert.equal(posting.jobLocation!.address.addressLocality, "Medellín");
  assert.equal(posting.jobLocation!.address.addressRegion, "Antioquia");
});

test("validThrough: omitted when unknown, source value when stated, and expiry flips readiness on read", () => {
  const unknown = buildJobPosting(asStoredPage(base())) as PostingShape;
  assert.equal(unknown.validThrough, undefined);
  const stated = asStoredPage(base({ validThrough: "2026-10-30T00:00:00Z" }));
  assert.equal((buildJobPosting(stated) as PostingShape).validThrough, "2026-10-30T00:00:00.000Z");
  // Stored as ready, later the source date passes: every reader turns it off.
  assert.equal(isGoogleReadyNow({ seoReady: true, isActive: true, validThrough: "2026-10-30T00:00:00Z" }, new Date("2026-11-01T00:00:00Z")), false);
});

test("malicious HTML in source text is escaped: only <p>/<ul>/<li> ever emitted", () => {
  const hostile = {
    description: 'Cargo real.\n<script>alert("x")</script><img src=x onerror=alert(1)>\nSegunda línea </script><script>alert(2)</script>',
    requirements: ['<a href="javascript:alert(3)">click</a>']
  };
  const html = renderJobDescriptionHtml(hostile);
  assert.doesNotMatch(html, /<script|<img|<a /i);
  assert.deepEqual([...new Set(html.match(/<\/?[a-z]+/gi))].sort(), ["</li", "</p", "</ul", "<li", "<p", "<ul"]);
  const embedded = escapeJsonForScriptTag({ description: html, title: "</script><script>alert(4)</script>" });
  assert.doesNotMatch(embedded, /<\/script/i);
});

test("description quality: salaries and addresses in a real posting are not mistaken for chrome", () => {
  const assessment = assessDescription({
    title: "Auxiliar Contable",
    description: [
      "Empresa del sector salud requiere auxiliar contable para su sede principal.",
      "Salario: 3.500.000 más prestaciones de ley.",
      "Horario: lunes a viernes de 7:00 a 17:00, sábados medio día.",
      "Enviar hoja de vida al WhatsApp 300 123 4567 indicando aspiración salarial."
    ].join("\n"),
    requirements: ["Técnico o tecnólogo en contabilidad.", "Un año de experiencia en causación y conciliaciones."]
  });
  assert.equal(assessment.ok, true, assessment.reasons.join(","));
});

test("JSON-LD parser reads remote modality, eligible countries and expiration only as the source states them", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    description: "<p>Desarrollador backend.</p>",
    jobLocationType: "TELECOMMUTE",
    applicantLocationRequirements: [{ "@type": "Country", name: "Colombia" }, { "@type": "Country", name: "Atlantis" }],
    validThrough: "2026-12-01"
  })}</script>`;
  const detail = extractJobPostingDetail(html)!;
  assert.equal(detail.remoteType, "fully_remote");
  assert.deepEqual(detail.applicantCountries, ["CO"]);
  assert.equal(detail.validThrough, "2026-12-01T00:00:00.000Z");

  const onsite = extractJobPostingDetail(
    `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", description: "<p>Cargo presencial.</p>" })}</script>`
  )!;
  assert.equal(onsite.remoteType, undefined);
  assert.equal(onsite.applicantCountries, undefined);
  assert.equal(onsite.validThrough, undefined);
});
