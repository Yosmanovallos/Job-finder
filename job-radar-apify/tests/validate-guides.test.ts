import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import { fileURLToPath } from "node:url";
import {
  GUIDE_TAGS,
  MIN_USEFUL_WORDS,
  guideTagsForHub,
  guideTagsForJob,
  isOfficialSourceUrl,
  parseGuide,
  publishedGuides,
  readSsrGuideLinks,
  relatedGuides,
  usefulWordCount,
  validateGuides,
  type Guide
} from "../src/lib/guides.js";
import { isMarkedAdEligible } from "../src/lib/ad-eligibility.js";
import {
  buildGuidesSitemapXml,
  guidesSitemapEntries,
  handleGuidesRoute,
  relatedGuidesSnippet,
  renderGuidePageHtml,
  renderGuidesIndexHtml
} from "../src/server/routes/guides.js";
import { GUIDES_CONTENT_DIR, getPublishedGuides, loadGuidesFrom } from "../src/server/guides-store.js";
import { GUIDES_ENABLED } from "../src/config.js";

// openspec/changes/adsense-readiness — F3, requirement ADS-040 (CX-1, CX-3,
// AV-4, SP-11). Offline: fixtures are built here, never in content/guias.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf-8");
const appHtml = (html: string) => /<div id="app">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? "";
const visibleWords = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").split(/\s+/).filter(Boolean).length;

// Digit-free unique filler: "seed" picks a distinct vocabulary per guide so
// two fixture guides never share a paragraph by accident.
function word(n: number, seed: string): string {
  let out = "";
  let value = n + 1;
  while (value > 0) {
    out = String.fromCharCode(97 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return `${seed}${out}`;
}
function paragraphs(seed: string, count: number, wordsEach = 50): string[] {
  return Array.from({ length: count }, (_, p) => Array.from({ length: wordsEach }, (_, w) => word(p * wordsEach + w, seed)).join(" ") + ".");
}

interface FixtureOptions {
  slug?: string;
  seed?: string;
  approved?: boolean;
  omit?: string[];
  extraBody?: string;
  paragraphCount?: number;
  corpus?: boolean;
  tags?: string;
}

function fixtureSource(options: FixtureOptions = {}): string {
  const slug = options.slug ?? "guia-de-prueba";
  const approved = options.approved ?? true;
  const meta: Record<string, string> = {
    slug,
    titulo: "Guía de prueba sobre el periodo de prueba",
    descripcion: "Una guía de prueba con fuente oficial, dato propio del corpus y revisión del propietario para las pruebas.",
    autor: "Equipo de prueba",
    autor_tipo: "Organization",
    publicada: approved ? "2026-11-20" : "",
    actualizada: approved ? "2026-11-21" : "",
    etiquetas: options.tags ?? `${GUIDE_TAGS.contracts}, ${GUIDE_TAGS.firstJob}`,
    revision_propietario: approved ? "aprobada" : "pendiente",
    revisado_por: approved ? "Propietario de prueba" : "",
    fecha_revision: approved ? "2026-11-19" : ""
  };
  for (const key of options.omit ?? []) delete meta[key];
  const front = Object.entries(meta).map(([key, value]) => `${key}: ${value}`).join("\n");
  const filler = paragraphs(options.seed ?? "zq", options.paragraphCount ?? 17).join("\n\n");
  const corpus = options.corpus ?? true;
  return `---\n${front}\n---\n## Qué dice la norma\n\nEl periodo de prueba no puede exceder dos meses según el artículo del código.[^cst]\n\n` +
    (corpus ? `Al corte había 120 vacantes activas que lo mencionan.[^bt]\n\n` : "") +
    `${filler}\n\n${options.extraBody ?? ""}\n\n` +
    `[^cst]: [Código Sustantivo del Trabajo, artículo 78](https://www.secretariasenado.gov.co/senado/basedoc/codigo_sustantivo_trabajo_pr002.html) — consultado el 2026-11-14\n` +
    (corpus ? `[^bt]: [BuscoTrabajo, API pública](https://buscotrabajo.co/api/v1/jobs?country=CO&search=periodo%20de%20prueba&limit=1) — corte 2026-11-14\n` : "");
}

const guide = (options: FixtureOptions = {}): Guide => parseGuide(`${options.slug ?? "guia-de-prueba"}.md`, fixtureSource(options));
const errorsOf = (...guides: Guide[]) => validateGuides(guides).map((result) => result.errors);

test("ADS-040 a complete, approved guide validates and publishes", () => {
  const valid = guide();
  assert.ok(usefulWordCount(valid) >= MIN_USEFUL_WORDS, `${usefulWordCount(valid)} useful words`);
  assert.deepEqual(errorsOf(valid), [[]]);
  assert.equal(publishedGuides([valid]).length, 1);
});

test("ADS-040 a guide without the owner's approval does not publish", () => {
  const pending = guide({ approved: false });
  assert.deepEqual(errorsOf(pending), [[]], "a pending draft is otherwise valid");
  assert.equal(publishedGuides([pending]).length, 0);
});

test("ADS-040 the owner-review fields are mandatory", () => {
  for (const key of ["revision_propietario", "revisado_por", "fecha_revision"]) {
    const [errors] = errorsOf(guide({ omit: [key] }));
    assert.ok(errors!.some((error) => error.includes(`'${key}'`)), `${key}: ${errors!.join("; ")}`);
  }
  assert.equal(publishedGuides([guide({ omit: ["revision_propietario"] })]).length, 0);
});

test("ADS-040 a figure or a norm without an official source fails", () => {
  const cases = [
    "El salario mínimo subió un 9 % este año.",
    "Lo establece el artículo sobre jornada.",
    "La ley obliga a pagar la prima.",
    "El 40 % de los casos sale de un blog.[^blog]\n\n[^blog]: [Un blog](https://example.com/blog) — consultado el 2026-11-14"
  ];
  for (const extra of cases) {
    const [errors] = errorsOf(guide({ extraBody: extra }));
    assert.ok(errors!.some((error) => error.startsWith("cifra o norma sin fuente oficial")), `${extra}: ${errors!.join("; ")}`);
  }
  const [backed] = errorsOf(guide({ extraBody: "El periodo de prueba se pacta por escrito según el artículo citado.[^cst]" }));
  assert.deepEqual(backed, []);
});

test("ADS-040 official sources are Colombian state domains and SENA, over https", () => {
  assert.ok(isOfficialSourceUrl("https://www.mintrabajo.gov.co/x"));
  assert.ok(isOfficialSourceUrl("https://www.dane.gov.co/x"));
  assert.ok(isOfficialSourceUrl("https://www.secretariasenado.gov.co/x"));
  assert.ok(isOfficialSourceUrl("https://www.funcionpublica.gov.co/x"));
  assert.ok(isOfficialSourceUrl("https://agenciapublicadeempleo.sena.edu.co/x"));
  assert.equal(isOfficialSourceUrl("http://www.mintrabajo.gov.co/x"), false);
  assert.equal(isOfficialSourceUrl("https://gov.co.example.com/x"), false);
  assert.equal(isOfficialSourceUrl("https://buscotrabajo.co/x"), false);
});

test("ADS-040 each guide carries a BuscoTrabajo corpus fact with a cut-off date", () => {
  const [errors] = errorsOf(guide({ corpus: false }));
  assert.ok(errors!.some((error) => error.includes("dato propio del corpus")), errors!.join("; "));
  const noCutoff = fixtureSource().replace("— corte 2026-11-14", "— sin fecha");
  const [errors2] = errorsOf(parseGuide("guia-de-prueba.md", noCutoff));
  assert.ok(errors2!.some((error) => error.includes("sin 'corte AAAA-MM-DD'")), errors2!.join("; "));
});

test("ADS-040 fewer than 800 useful words fails", () => {
  const short = guide({ paragraphCount: 8 });
  assert.ok(usefulWordCount(short) < MIN_USEFUL_WORDS);
  const [errors] = errorsOf(short);
  assert.ok(errors!.some((error) => error.includes("palabras útiles")), errors!.join("; "));
});

test("ADS-040 no paragraph over 40 words repeats across guides", () => {
  const shared = paragraphs("wx", 1, 45)[0]!;
  const a = guide({ slug: "guia-a", seed: "aa", extraBody: shared });
  const b = guide({ slug: "guia-b", seed: "bb", extraBody: shared });
  const [errorsA, errorsB] = errorsOf(a, b);
  assert.deepEqual(errorsA, []);
  assert.ok(errorsB!.some((error) => error.includes("repetido en guia-a.md")), errorsB!.join("; "));
  assert.equal(publishedGuides([a, b]).length, 1, "the duplicate does not publish");

  const shortShared = paragraphs("vy", 1, 30)[0]!;
  assert.deepEqual(errorsOf(guide({ slug: "guia-a", seed: "aa", extraBody: shortShared }), guide({ slug: "guia-b", seed: "bb", extraBody: shortShared })), [[], []]);
});

test("ADS-040 raw HTML, images and h1 in the body are rejected", () => {
  for (const extra of ["<script>alert(1)</script>", "![x](https://example.com/x.png)", "# Otro título"]) {
    assert.throws(() => guide({ extraBody: extra }), undefined, extra);
  }
});

test("ADS-040 published guide page: full text, byline, Article JSON-LD and the ad marker", () => {
  const valid = guide();
  const html = renderGuidePageHtml(indexHtml, valid);
  const app = appHtml(html);
  assert.match(app, /<h1>Guía de prueba sobre el periodo de prueba<\/h1>/);
  assert.ok(visibleWords(app) >= MIN_USEFUL_WORDS, `${visibleWords(app)} words in the raw HTML`);
  assert.match(app, /Por Equipo de prueba/);
  assert.match(app, /Revisada por Propietario de prueba/);
  assert.match(app, /<h2 id="guia-fuentes">Fuentes<\/h2>/);
  assert.match(app, /href="https:\/\/www\.secretariasenado\.gov\.co\//);
  assert.match(app, /<sup><a href="#fuente-1"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/buscotrabajo\.co\/guias\/guia-de-prueba" \/>/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
  const article = ld.find((item) => item["@type"] === "Article");
  assert.ok(article, "Article JSON-LD");
  assert.equal(article.author.name, "Equipo de prueba");
  assert.equal(article.datePublished, "2026-11-20");
  assert.equal(article.dateModified, "2026-11-21");
  assert.equal(article.citation.length, 2);
  assert.ok(isMarkedAdEligible(html), "a published guide carries the ad marker");
});

test("ADS-040 the index lists every published guide and carries no ads", () => {
  const guides = [guide({ slug: "guia-a", seed: "aa" }), guide({ slug: "guia-b", seed: "bb" })];
  const html = renderGuidesIndexHtml(indexHtml, guides);
  for (const slug of ["guia-a", "guia-b"]) assert.match(appHtml(html), new RegExp(`href="/guias/${slug}"`));
  assert.equal(isMarkedAdEligible(html), false, "a list of links is a navigation screen (PP-3)");
});

test("ADS-040 sitemap lists /guias and each guide only when there are guides", () => {
  assert.deepEqual(guidesSitemapEntries([]), []);
  const xml = buildGuidesSitemapXml([guide()]);
  assert.match(xml, /<loc>https:\/\/buscotrabajo\.co\/guias<\/loc>/);
  assert.match(xml, /<loc>https:\/\/buscotrabajo\.co\/guias\/guia-de-prueba<\/loc>\s*<lastmod>2026-11-21<\/lastmod>/);
  assert.deepEqual(guidesSitemapEntries([guide()]), ["https://buscotrabajo.co/sitemap-guides.xml"]);
});

async function call(pathname: string, guides: Guide[], accept = "text/html") {
  let sent: { status: number; headers: http.OutgoingHttpHeaders; body: string } | null = null;
  const handled = await handleGuidesRoute({ headers: { accept } } as http.IncomingMessage, {} as http.ServerResponse, {
    pathname,
    method: "GET",
    guides,
    loadIndexHtml: async () => indexHtml,
    sendBody: async (_req, _res, status, headers, body) => {
      sent = { status, headers, body: String(body) };
    }
  });
  return { handled, sent: sent as unknown as { status: number; headers: http.OutgoingHttpHeaders; body: string } };
}

test("ADS-040 switch off or nothing approved: every /guias path is a real 404", async () => {
  assert.deepEqual(getPublishedGuides(false), []);
  for (const pathname of ["/guias", "/guias/guia-de-prueba", "/api/guias", "/api/guias/guia-de-prueba", "/sitemap-guides.xml"]) {
    const { handled, sent } = await call(pathname, []);
    assert.equal(handled, true, pathname);
    assert.equal(sent.status, 404, pathname);
  }
  const markdown = await call("/guias", [], "text/markdown");
  assert.equal(markdown.sent.status, 404);
  assert.match(String(markdown.sent.headers["Content-Type"]), /text\/markdown/);
  assert.equal((await call("/dashboard", [])).handled, false, "other paths are untouched");
});

test("ADS-040 routes serve HTML, Markdown and JSON for published guides; unknown slugs 404", async () => {
  const guides = [guide()];
  const page = await call("/guias/guia-de-prueba", guides);
  assert.equal(page.sent.status, 200);
  assert.match(page.sent.body, /data-guide="guia-de-prueba"/);
  assert.equal(page.sent.headers.Vary, "Accept");
  const markdown = await call("/guias/guia-de-prueba", guides, "text/markdown");
  assert.equal(markdown.sent.status, 200);
  assert.match(markdown.sent.body, /^# Guía de prueba sobre el periodo de prueba/);
  const api = await call("/api/guias/guia-de-prueba", guides);
  assert.equal(JSON.parse(api.sent.body).slug, "guia-de-prueba");
  assert.equal((await call("/guias/no-existe", guides)).sent.status, 404);
  assert.equal((await call("/api/guias/no-existe", guides)).sent.status, 404);
  assert.equal((await call("/guias", guides)).sent.status, 200);
  assert.equal((await call("/sitemap-guides.xml", guides)).sent.status, 200);
});

test("ADS-040 hubs and jobs link at most three related published guides", () => {
  const guides = publishedGuides([
    guide({ slug: "guia-a", seed: "aa", tags: GUIDE_TAGS.firstJob }),
    guide({ slug: "guia-b", seed: "bb", tags: GUIDE_TAGS.resume }),
    guide({ slug: "guia-c", seed: "cc", tags: GUIDE_TAGS.publicService }),
    guide({ slug: "guia-d", seed: "dd", tags: GUIDE_TAGS.firstJob }),
    guide({ slug: "guia-e", seed: "ee", tags: GUIDE_TAGS.remote, approved: false })
  ]);
  const links = relatedGuides(guides, guideTagsForHub({ kind: "intencion", intent: "sin-experiencia" }));
  assert.equal(links.length, 3);
  assert.ok(links.every((link) => link.path.startsWith("/guias/")));
  assert.deepEqual(relatedGuides(guides, guideTagsForJob({ modality: "presencial" })).map((link) => link.slug), ["guia-b"]);
  assert.deepEqual(relatedGuides(guides, guideTagsForJob({ modality: "remoto" })), [], "the unapproved remote guide is never linked");
  const snippet = relatedGuidesSnippet(guides, guideTagsForHub({ kind: "ciudad" }), "/empleos/bogota");
  assert.match(snippet.html, /aria-label="Guías relacionadas"/);
  assert.match(snippet.head, /window\.__SSR_GUIDE_LINKS__=/);
  assert.deepEqual(relatedGuidesSnippet([], guideTagsForHub({ kind: "ciudad" }), "/empleos/bogota"), { html: "", head: "" });
});

test("ADS-040 the client trusts guide links only for its own page", () => {
  const links = relatedGuides(publishedGuides([guide()]), [GUIDE_TAGS.contracts]);
  assert.equal(readSsrGuideLinks({ path: "/empleos/bogota", links }, "/empleos/bogota").length, 1);
  assert.deepEqual(readSsrGuideLinks({ path: "/empleos/cali", links }, "/empleos/bogota"), []);
  assert.deepEqual(readSsrGuideLinks({ path: "/empleos/bogota", links: [{ ...links[0], path: "https://evil.example" }] }, "/empleos/bogota"), []);
});

test("ADS-040 every guide in content/guias parses and passes validation", () => {
  const files = fs.existsSync(GUIDES_CONTENT_DIR) ? fs.readdirSync(GUIDES_CONTENT_DIR).filter((name) => name.endsWith(".md") && name !== "README.md") : [];
  const guides = loadGuidesFrom(GUIDES_CONTENT_DIR);
  assert.equal(guides.length, files.length, "no guide file fails to parse");
  for (const result of validateGuides(guides)) assert.deepEqual(result.errors, [], result.file);
});

test("ADS-040 the switch never exposes an empty /guias: menu and footer follow GUIDES_ENABLED", () => {
  if (GUIDES_ENABLED) {
    assert.ok(publishedGuides(loadGuidesFrom(GUIDES_CONTENT_DIR)).length > 0, "GUIDES_ENABLED needs at least one owner-approved guide");
  }
  const header = fs.readFileSync(path.join(root, "src/sections/Header.tsx"), "utf-8");
  const footer = fs.readFileSync(path.join(root, "src/sections/Footer.tsx"), "utf-8");
  assert.match(header, /GUIDES_ENABLED \? \[\{ label: "Guías", to: "\/guias" \}\]/);
  assert.match(footer, /GUIDES_ENABLED\s*\?\s*\[\{ label: "Guías", href: "\/guias"/);
});
