import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../scripts/adsense-audit.js";
import {
  appHtml,
  bareLinkLists,
  countWords,
  hasScriptRedirect,
  mainText,
  robotsBlocksSite,
  ssrJobSource,
  textSegments
} from "../scripts/lib/adsense-audit-html.js";
import { GENERIC_USER_AGENT, GetFetcher, validateFetcherOptions } from "../scripts/lib/adsense-audit-crawl.js";
import {
  RULES,
  TEXT_PAGE_KINDS,
  diffAgainst,
  evaluateRules,
  exitCodeFor,
  isOriginalPath,
  summarize,
  type AuditAttestations,
  type BrowserFact,
  type PageFact,
  type PageKind,
  type SiteFacts
} from "../scripts/lib/adsense-audit-rules.js";

// openspec/changes/adsense-readiness F0 — offline checks of the auditor
// (ADS-001). The isolated run against the synthetic build is
// tests/validate-adsense-audit.ts (`npm run adsense:audit`).

const LONG = Array.from({ length: 200 }, (_, index) => `palabra${index}`).join(" ");

function page(kind: PageKind, path: string, overrides: Partial<PageFact> = {}): PageFact {
  return {
    kind,
    path,
    status: 200,
    location: null,
    contentType: "text/html; charset=utf-8",
    robots: "",
    canonical: `https://buscotrabajo.co${path}`,
    lang: "es",
    adMarker: false,
    manualAdSlots: 0,
    rawWords: 200,
    text: LONG,
    segments: ["Un bloque de texto del servidor"],
    jsonLd: [],
    internalLinks: [],
    externalLinks: [],
    metaRefresh: false,
    scriptRedirect: false,
    attachment: false,
    bareLinkLists: 0,
    jobSource: null,
    markers: [],
    ...overrides
  };
}

function seen(entry: PageFact, overrides: Partial<BrowserFact> = {}): BrowserFact {
  return {
    path: entry.path,
    kind: entry.kind,
    adsRequested: false,
    segments: 1,
    missingSegments: [],
    serverWords: 10,
    missingWords: [],
    hiddenSegments: [],
    footerLinks: ["/contact", "/about", "/metodologia", "/legal/privacidad", "/legal/terminos"],
    overlayShare: 0,
    historyLength: 1,
    hasReportLink: entry.kind.startsWith("vacante-"),
    hydratedWords: entry.rawWords,
    hydratedOnlyWords: [],
    pageErrors: 0,
    error: null,
    ...overrides
  };
}

/** A site that satisfies every measurable rule (the «todo cumple» scenario). */
function compliantSite(): SiteFacts {
  const hub = { markers: ["data-hub-comparison"] };
  const pages: PageFact[] = [
    page("home-co", "/", { adMarker: true }),
    page("home-ve", "/ve", { adMarker: true }),
    page("empleos", "/empleos", { adMarker: true }),
    page("hub-grande", "/empleos/bogota", { adMarker: true, ...hub }),
    page("hub-cargo", "/empleos/ingeniero-civil", { adMarker: true, ...hub }),
    page("hub-pequeno", "/empleos/santa-marta", { robots: "noindex, follow" }),
    page("empresas", "/empresas", { adMarker: true }),
    page("vacante-oficial", "/empleos/a/oficial", {
      adMarker: true,
      jobSource: "Portal oficial",
      externalLinks: [{ href: "https://empresa.example/jobs/1", text: "Postularme en el portal oficial" }]
    }),
    page("vacante-terceros", "/empleos/b/terceros", {
      jobSource: "LinkedIn",
      externalLinks: [{ href: "https://www.linkedin.com/jobs/1", text: "Aplicar en LinkedIn" }],
      internalLinks: ["/empleos/00000000-0000-4000-8000-000000000001/x"]
    }),
    page("vacante-terceros-hermana", "/empleos/c/terceros", {
      jobSource: "LinkedIn",
      externalLinks: [{ href: "https://www.linkedin.com/jobs/2", text: "Aplicar en LinkedIn" }],
      internalLinks: ["/empleos/00000000-0000-4000-8000-000000000002/y"]
    }),
    page("vacante-vencida", "/empleos/d/vencida", { status: 410, robots: "noindex", rawWords: 10 }),
    page("no-existe", "/esta-pagina-no-existe", { status: 404, robots: "noindex", rawWords: 5 }),
    page("legal-privacidad", "/legal/privacidad", {
      text: `${LONG} google publicidad cookies adssettings no procesamos pagos`
    }),
    page("legal-terminos", "/legal/terminos"),
    page("legal-uso-aceptable", "/legal/uso-aceptable"),
    page("legal-cookies", "/legal/cookies"),
    page("privacy", "/privacy", { text: `${LONG} el servicio no procesa pagos` }),
    page("about", "/about", { internalLinks: ["/metodologia"] }),
    page("contact", "/contact", { text: `${LONG} retirar una vacante` }),
    page("metodologia", "/metodologia", { text: `${LONG} duplicados vence 30 días fuente` }),
    page("preguntas", "/preguntas"),
    page("como-funciona", "/como-funciona"),
    page("fuentes", "/fuentes"),
    page("opiniones", "/opiniones"),
    page("login", "/login", { rawWords: 20 }),
    page("reset-password", "/reset-password", { rawWords: 20 }),
    page("cuenta", "/cuenta", { rawWords: 20 }),
    page("dashboard", "/dashboard"),
    page("dashboard-filtrado", "/dashboard?q=x"),
    page("guias", "/guias"),
    page("informes", "/informes"),
    page("herramientas", "/herramientas")
  ];
  const originalPages = [
    ...Array.from({ length: 30 }, (_, index) => ({ path: `/guias/guia-${index}`, words: 900 })),
    ...Array.from({ length: 2 }, (_, index) => ({ path: `/herramientas/calc-${index}`, words: 400 })),
    ...Array.from({ length: 10 }, (_, index) => ({ path: `/legal/x${index}`, words: 300 }))
  ];
  return {
    mode: "sintetico",
    base: "http://127.0.0.1:3000",
    pages,
    browser: pages.filter((entry) => entry.status === 200).map((entry) => seen(entry)),
    robotsTxt: "User-agent: *\nDisallow: /api/\n",
    adsTxt: "google.com, pub-2247075733653451, DIRECT, f08c47fec0942fa0\n",
    adsenseAccount: "ca-pub-2247075733653451",
    sitemapPages: originalPages.map((entry) => entry.path),
    sitemapCategories: ["https://buscotrabajo.co/empleos/bogota"],
    originalPages,
    jobSample: [
      { path: "/empleos/a/oficial", source: "Portal oficial", indexable: true },
      { path: "/empleos/b/terceros", source: "LinkedIn", indexable: true }
    ],
    brokenLinks: [],
    checkedLinks: 40,
    requests: 80,
    methods: ["GET"]
  };
}

function attestAll(): AuditAttestations {
  const manual = Object.fromEntries(
    RULES.filter((rule) => rule.tipo === "manual").map((rule) => [rule.id, { fecha: "2026-11-15", evidencia: "prueba" }])
  );
  return { decisions: { D1: "a" }, manual };
}

test("ADS-001 the matrix has the 50 rules of proposal.md, once each", () => {
  const ids = RULES.map((rule) => rule.id);
  assert.equal(ids.length, 50);
  assert.equal(new Set(ids).size, 50);
  const groups: Record<string, number> = {};
  for (const id of ids) groups[id.split("-")[0]] = (groups[id.split("-")[0]] ?? 0) + 1;
  assert.deepEqual(groups, { AV: 5, CX: 10, SP: 19, MA: 1, PP: 6, PG: 7, TX: 2 });
  const proposal = RULES.reduce<Record<string, number>>((counts, rule) => ({ ...counts, [rule.propuesta]: (counts[rule.propuesta] ?? 0) + 1 }), {});
  assert.deepEqual(proposal, { "✅": 26, "⚠️": 15, "❌": 9 }, "proposal.md: 26 ✅ / 15 ⚠️ / 9 ❌");
});

test("ADS-001 todo cumple: 50 entries and exit code 0", () => {
  const facts = compliantSite();
  const results = evaluateRules(facts, attestAll());
  assert.equal(results.length, 50);
  const failing = results.filter((result) => result.estado !== "CUMPLE").map((result) => `${result.id}: ${result.evidencia}`);
  assert.deepEqual(failing, []);
  assert.equal(exitCodeFor(results), 0);
  assert.equal(summarize(results, facts).porEstado.CUMPLE, 50);
});

test("ADS-001 una regla no cumple: PP-1 names the route and the exit code is 1", () => {
  const facts = compliantSite();
  facts.pages = facts.pages.map((entry) => (entry.kind === "login" ? { ...entry, adMarker: true } : entry));
  const results = evaluateRules(facts, attestAll());
  const pp1 = results.find((result) => result.id === "PP-1")!;
  assert.equal(pp1.estado, "NO CUMPLE");
  assert.match(pp1.evidencia, /\/login/);
  assert.equal(exitCodeFor(results), 1);
});

test("ADS-001 an ad request seen in the browser fails PP-3 even without the marker", () => {
  const facts = compliantSite();
  facts.browser = facts.browser!.map((entry) => (entry.kind === "dashboard" ? { ...entry, adsRequested: true } : entry));
  assert.equal(evaluateRules(facts, attestAll()).find((result) => result.id === "PP-3")!.estado, "NO CUMPLE");
});

test("ADS-001 PP-4 needs the positive control: the official job carries the marker", () => {
  const facts = compliantSite();
  facts.pages = facts.pages.map((entry) => (entry.kind === "vacante-oficial" ? { ...entry, adMarker: false } : entry));
  assert.equal(evaluateRules(facts, attestAll()).find((result) => result.id === "PP-4")!.estado, "PARCIAL");
});

test("ADS-001 MANUAL rules stay MANUAL without an attestation and never fail the exit code", () => {
  const facts = compliantSite();
  const results = evaluateRules(facts, { decisions: { D1: "a" } });
  const manual = results.filter((result) => result.estado === "MANUAL");
  assert.deepEqual(manual.map((result) => result.id), RULES.filter((rule) => rule.tipo === "manual").map((rule) => rule.id));
  assert.ok(manual.every((result) => result.pendiente_manual));
  assert.equal(exitCodeFor(results), 0);
});

test("ADS-001 without D1 the third-party rules do not pass", () => {
  const results = evaluateRules(compliantSite(), {});
  for (const id of ["CX-4", "SP-11", "SP-12", "AV-1", "CX-2"]) {
    assert.equal(results.find((result) => result.id === id)!.estado, "NO CUMPLE", id);
  }
});

test("ADS-001 D1(b) requires noindex, no JobPosting and no sitemap entry", () => {
  const results = evaluateRules(compliantSite(), { ...attestAll(), decisions: { D1: "b" } });
  assert.equal(results.find((result) => result.id === "SP-11")!.estado, "NO CUMPLE");
});

test("ADS-001 privacy: a past-payments mention is not a contradiction; the old wording is", () => {
  const facts = compliantSite();
  facts.pages = facts.pages.map((entry) =>
    entry.kind === "privacy" ? { ...entry, text: `${LONG} no procesa pagos; cuando existieron pagos, wompi los procesaba` } : entry
  );
  assert.equal(evaluateRules(facts, attestAll()).find((result) => result.id === "CX-5")!.estado, "CUMPLE");
  facts.pages = facts.pages.map((entry) =>
    entry.kind === "privacy" ? { ...entry, text: `${LONG} historial de transacciones procesadas con wompi` } : entry
  );
  const results = evaluateRules(facts, attestAll());
  assert.equal(results.find((result) => result.id === "PG-5")!.estado, "NO CUMPLE");
  assert.equal(summarize(results, facts).metricas.duplicate_policy_pages, 1);
});

test("ADS-001 TX-1: a shell filled by JavaScript fails; short but complete pages are PARCIAL", () => {
  const facts = compliantSite();
  facts.browser = facts.browser!.map((entry) => (entry.kind === "fuentes" ? { ...entry, hydratedWords: 400 } : entry));
  assert.equal(evaluateRules(facts, attestAll()).find((result) => result.id === "TX-1")!.estado, "NO CUMPLE");
  const short = compliantSite();
  short.pages = short.pages.map((entry) => (entry.kind === "legal-cookies" ? { ...entry, rawWords: 120 } : entry));
  short.browser = short.browser!.map((entry) => (entry.kind === "legal-cookies" ? { ...entry, hydratedWords: 120 } : entry));
  assert.equal(evaluateRules(short, attestAll()).find((result) => result.id === "TX-1")!.estado, "PARCIAL");
  assert.equal(TEXT_PAGE_KINDS.length, 11);
});

test("ADS-001 SP-1 parity: word-level, PARCIAL for wording differences, NO CUMPLE when text vanishes", () => {
  const facts = compliantSite();
  facts.browser = facts.browser!.map((entry) => (entry.kind === "about" ? { ...entry, serverWords: 100, missingWords: ["qué"] } : entry));
  assert.equal(evaluateRules(facts, attestAll()).find((result) => result.id === "SP-1")!.estado, "PARCIAL");
  facts.browser = facts.browser!.map((entry) =>
    entry.kind === "about" ? { ...entry, serverWords: 100, missingWords: Array.from({ length: 40 }, (_, index) => `w${index}`) } : entry
  );
  assert.equal(evaluateRules(facts, attestAll()).find((result) => result.id === "SP-1")!.estado, "NO CUMPLE");
  facts.browser = null;
  assert.equal(evaluateRules(facts, attestAll()).find((result) => result.id === "SP-1")!.estado, "NO CUMPLE", "unmeasured is never CUMPLE");
});

test("ADS-001 --expect: the diff lists only changed states", () => {
  const results = evaluateRules(compliantSite(), attestAll());
  const expected = Object.fromEntries(results.map((result) => [result.id, result.estado]));
  assert.deepEqual(diffAgainst(results, expected), []);
  expected["PP-1"] = "NO CUMPLE";
  assert.deepEqual(diffAgainst(results, expected), [{ id: "PP-1", esperado: "NO CUMPLE", obtenido: "CUMPLE" }]);
});

test("ADS-001 original pages: institutional, legal, guides, reports, tools — not /privacy, /docs or indexes", () => {
  for (const path of ["/about", "/metodologia", "/legal/cookies", "/guias/hoja-de-vida", "/informes/empleo-colombia-2026-10", "/herramientas/liquidacion"]) {
    assert.equal(isOriginalPath(path), true, path);
  }
  for (const path of ["/", "/privacy", "/docs", "/guias", "/guias/", "/empleos/bogota", "/empresas"]) {
    assert.equal(isOriginalPath(path), false, path);
  }
});

test("ADS-001 sin escrituras: the fetcher only does GET, stays on the audited site and keeps its budget", async () => {
  assert.throws(() => validateFetcherOptions({ base: "https://example.com", live: true, maxUrls: 10, delayMs: 1000, userAgent: "x" }), /solo admite/);
  assert.throws(() => validateFetcherOptions({ base: "https://buscotrabajo.co", live: true, maxUrls: 10, delayMs: 200, userAgent: "x" }), /pausa mínima/);
  assert.throws(() => validateFetcherOptions({ base: "https://buscotrabajo.co", live: true, maxUrls: 500, delayMs: 1000, userAgent: "x" }), /no puede superar/);
  assert.throws(() => validateFetcherOptions({ base: "https://buscotrabajo.co", live: false, maxUrls: 10, delayMs: 0, userAgent: "x" }), /servidor local/);
  assert.doesNotThrow(() => validateFetcherOptions({ base: "https://buscotrabajo.co", live: true, maxUrls: 40, delayMs: 1000, userAgent: "x" }));

  const original = globalThis.fetch;
  const calls: { url: string; method: string; agent: string | null; at: number }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      agent: new Headers(init?.headers).get("user-agent"),
      at: Date.now()
    });
    return new Response("<html lang=\"es\"><body><div id=\"app\"><p>hola</p></div></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" }
    });
  }) as typeof fetch;
  try {
    const fetcher = new GetFetcher({ base: "http://127.0.0.1:9", live: false, maxUrls: 3, delayMs: 50, userAgent: GENERIC_USER_AGENT });
    await assert.rejects(fetcher.get("/x", "POST"), /solo hace peticiones GET/);
    await assert.rejects(fetcher.get("https://evil.example/"), /fuera del sitio/);
    for (const path of ["/a", "/b", "/c", "/d"]) await fetcher.get(path);
    assert.equal(calls.length, 3, "budget of 3 URLs");
    assert.equal(await fetcher.get("/e"), null);
    assert.ok(calls.every((call) => call.method === "GET" && call.agent === GENERIC_USER_AGENT));
    assert.ok(calls[2].at - calls[1].at >= 45, "pause between requests");
    await fetcher.get("/a");
    assert.equal(calls.length, 3, "a repeated URL is not fetched twice");
  } finally {
    globalThis.fetch = original;
  }
});

test("ADS-001 CLI arguments", () => {
  assert.equal(parseArgs(["--live"]).live, true);
  assert.equal(parseArgs(["--live", "--max-urls", "30"]).maxUrls, 30);
  assert.throws(() => parseArgs(["--live", "--base-url", "http://127.0.0.1:1"]), /no ambos/);
  assert.throws(() => parseArgs(["--write"]), /desconocido/);
  assert.throws(() => parseArgs(["--live", "--browser"]), /no se admite con --live/);
  assert.equal(parseArgs(["--base-url", "http://127.0.0.1:1", "--browser"]).browser, true);
  assert.throws(() => parseArgs(["--max-urls"]), /necesita un valor/);
});

test("HTML readers: main text without scripts, footer or header; segments; job source", () => {
  const html =
    '<html lang="es"><head><script>window.__SSR_JOB__={"job":{"source":"LinkedIn"}};</script></head><body>' +
    '<div id="app"><header>Menú del sitio</header><h1>Título de la página</h1><p>Primer párrafo con varias palabras útiles.</p>' +
    '<nav aria-label="Empresas"><ul><li><a href="/empresas/a">Empresa A</a> — 3 vacantes</li></ul></nav>' +
    '<script>var x = 1;</script><footer>Pie con enlaces</footer></div></body></html>';
  assert.match(appHtml(html), /^<header>/);
  const text = mainText(html);
  assert.ok(!text.includes("Menú") && !text.includes("Pie") && !text.includes("var x"));
  assert.ok(text.includes("Empresa A"), "an SSR <nav> is page content");
  assert.equal(countWords("uno, dos — tres 4"), 4);
  assert.deepEqual(textSegments(html), ["Título de la página", "Primer párrafo con varias palabras útiles.", "Empresa A — 3 vacantes"]);
  assert.equal(ssrJobSource(html), "LinkedIn");
});

test("HTML readers: script redirects, link lists and robots.txt", () => {
  assert.equal(hasScriptRedirect('<script>const safeLocation = location.pathname; var q = window.location.search;</script>'), false);
  assert.equal(hasScriptRedirect('<script>window.location.href = "https://otro.example";</script>'), true);
  assert.equal(hasScriptRedirect('<script>location.replace("/x")</script>'), true);
  assert.equal(hasScriptRedirect('<script src="/app.js"></script>'), false);
  const list = `<div id="app"><nav><ul>${Array.from({ length: 9 }, (_, index) => `<li><a href="/empleos/c${index}">Ciudad ${index}</a></li>`).join("")}</ul></nav></div></body>`;
  assert.equal(bareLinkLists(`<body>${list}`).length, 1);
  const withContext = `<body><div id="app"><ul>${Array.from({ length: 9 }, (_, index) => `<li><a href="/empleos/c${index}">Ciudad ${index}</a> concentra ${index} por ciento de las vacantes activas del país</li>`).join("")}</ul></div></body>`;
  assert.equal(bareLinkLists(withContext).length, 0);
  assert.equal(robotsBlocksSite("User-agent: *\nDisallow: /api/\n", "Mediapartners-Google"), false);
  assert.equal(robotsBlocksSite("User-agent: *\nDisallow: /\n", "Googlebot"), true);
  assert.equal(robotsBlocksSite("User-agent: *\nDisallow: /\n\nUser-agent: Mediapartners-Google\nAllow: /\n", "Mediapartners-Google"), false);
});
