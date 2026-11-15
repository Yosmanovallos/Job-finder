// The 50 rules of openspec/changes/adsense-readiness/proposal.md, evaluated
// from crawled facts (F0). Pure: no I/O, so the same evaluation runs on the
// synthetic build, on `--live` and in the offline unit tests.
//
// States:
//   CUMPLE / PARCIAL / NO CUMPLE — decided by code from what was crawled.
//   MANUAL — depends on the owner or on Google (Search Console, GA4, the
//            AdSense panel, an owner decision). The entry says what to verify.
//            An owner attestation (see AuditAttestations) turns it into CUMPLE.
//
// Mixed rules: the code part decides the state; what only the owner can
// confirm is listed in `pendiente_manual` and never makes a rule pass.

import { robotsBlocksSite } from "./adsense-audit-html.js";

export type Estado = "CUMPLE" | "PARCIAL" | "NO CUMPLE" | "MANUAL";
export type Tipo = "codigo" | "mixta" | "manual";
export type Propuesta = "✅" | "⚠️" | "❌";

export type PageKind =
  | "home-co"
  | "home-ve"
  | "empleos"
  | "hub-grande"
  | "hub-pequeno"
  | "hub-cargo"
  | "empresas"
  | "empresa"
  | "vacante-oficial"
  | "vacante-terceros"
  | "vacante-terceros-hermana"
  | "vacante-vencida"
  | "no-existe"
  | "legal-terminos"
  | "legal-privacidad"
  | "legal-uso-aceptable"
  | "legal-cookies"
  | "privacy"
  | "about"
  | "contact"
  | "metodologia"
  | "preguntas"
  | "como-funciona"
  | "fuentes"
  | "docs"
  | "opiniones"
  | "login"
  | "reset-password"
  | "cuenta"
  | "dashboard"
  | "dashboard-filtrado"
  | "guias"
  | "informes"
  | "herramientas"
  | "original";

export interface PageFact {
  kind: PageKind;
  path: string;
  status: number;
  /** 3xx target, when the response was a redirect. */
  location: string | null;
  contentType: string;
  /** `<meta name="robots">` plus `X-Robots-Tag`, lower-cased. */
  robots: string;
  canonical: string | null;
  lang: string | null;
  adMarker: boolean;
  manualAdSlots: number;
  /** Words of the main content in the raw HTML (no scripts, menu or footer). */
  rawWords: number;
  /** Lower-cased main text, kept in memory only; never written to a report. */
  text: string;
  segments: string[];
  jsonLd: { valid: boolean; types: string[] }[];
  internalLinks: string[];
  externalLinks: { href: string; text: string }[];
  metaRefresh: boolean;
  scriptRedirect: boolean;
  attachment: boolean;
  bareLinkLists: number;
  jobSource: string | null;
  /** Data attributes of the content layers added by F2–F5. */
  markers: string[];
}

export interface BrowserFact {
  path: string;
  kind: PageKind;
  adsRequested: boolean;
  segments: number;
  missingSegments: string[];
  /** Distinct words (≥ 3 letters) of the server text, and those absent after hydration. */
  serverWords: number;
  missingWords: string[];
  hiddenSegments: string[];
  footerLinks: string[];
  overlayShare: number;
  historyLength: number;
  hasReportLink: boolean;
  /** Words of the hydrated #app without menu, footer and buttons (TX-1 completeness). */
  hydratedWords: number;
  pageErrors: number;
  /** First line of the navigation error, when the page could not be observed. */
  error: string | null;
}

export interface SiteFacts {
  mode: "sintetico" | "live" | "local";
  base: string;
  pages: PageFact[];
  browser: BrowserFact[] | null;
  robotsTxt: string | null;
  adsTxt: string | null;
  adsenseAccount: string | null;
  sitemapPages: string[];
  sitemapCategories: string[];
  /** Indexable pages whose main text is ours (see ORIGINAL_FAMILIES). */
  originalPages: { path: string; words: number }[];
  jobSample: { path: string; source: string | null; indexable: boolean }[];
  brokenLinks: { from: string; to: string; status: number }[];
  checkedLinks: number;
  requests: number;
  methods: string[];
}

export interface AuditAttestations {
  /** Owner decisions of proposal.md (D1 «a» | «b», D5 «activo»…). */
  decisions?: Record<string, string>;
  /** Owner/Google confirmations for MANUAL rules: id → evidence and date. */
  manual?: Record<string, { fecha: string; evidencia: string }>;
}

export interface RuleResult {
  id: string;
  grupo: string;
  regla: string;
  tipo: Tipo;
  fase: string;
  propuesta: Propuesta;
  estado: Estado;
  evidencia: string;
  umbral: string | null;
  valor: string | number | null;
  pendiente_manual: string | null;
}

interface Verdict {
  estado: Estado;
  evidencia: string;
  umbral?: string;
  valor?: string | number;
  pendiente?: string;
}

interface RuleDef {
  id: string;
  grupo: string;
  regla: string;
  tipo: Tipo;
  fase: string;
  propuesta: Propuesta;
  evaluate: (facts: SiteFacts, ctx: Context) => Verdict;
}

// Own criteria (design.md, F0 table) — not Google figures; Google publishes none.
export const THRESHOLDS = {
  originalPages: 40,
  originalPagesPartial: 20,
  originalWords: 30000,
  rawWords: 150,
  parity: 1,
  overlayShare: 0.3,
  guides: 12,
  guideFreshDays: 14
};

/** Pages that must deliver their own text in the raw HTML (TX-1). */
export const TEXT_PAGE_KINDS: PageKind[] = [
  "legal-terminos",
  "legal-privacidad",
  "legal-uso-aceptable",
  "legal-cookies",
  "privacy",
  "about",
  "contact",
  "metodologia",
  "preguntas",
  "como-funciona",
  "fuentes"
];

/** Screens without publisher content (PP-1). */
const EMPTY_SCREENS: PageKind[] = ["login", "reset-password", "cuenta", "no-existe", "vacante-vencida"];
/** Under construction / empty states (PP-2). */
const EMPTY_STATES: PageKind[] = ["opiniones", "hub-pequeno"];
/** Navigation and search screens (PP-3). */
const NAVIGATION_SCREENS: PageKind[] = ["dashboard", "dashboard-filtrado"];
/** Replicated content (PP-4). */
const THIRD_PARTY_JOBS: PageKind[] = ["vacante-terceros", "vacante-terceros-hermana"];

/**
 * Route families counted as `original_pages`: our own text. Excluded on
 * purpose: the home and listings (generated from the corpus), job pages
 * (source text), `/privacy` (a summary of /legal/privacidad) and `/docs`
 * (API reference for agents).
 */
export const ORIGINAL_INSTITUTIONAL = [
  "/about",
  "/metodologia",
  "/contact",
  "/como-funciona",
  "/preguntas",
  "/fuentes",
  "/legal/terminos",
  "/legal/privacidad",
  "/legal/uso-aceptable",
  "/legal/cookies"
];
export const ORIGINAL_PREFIXES = ["/guias/", "/informes/", "/herramientas/"];

export function isOriginalPath(pathname: string): boolean {
  const clean = pathname.replace(/\/$/, "") || "/";
  return ORIGINAL_INSTITUTIONAL.includes(clean) || ORIGINAL_PREFIXES.some((prefix) => clean.startsWith(prefix) && clean.length > prefix.length);
}

interface Context {
  page: (kind: PageKind) => PageFact | undefined;
  pages: (kinds: PageKind[]) => PageFact[];
  browser: (kind: PageKind) => BrowserFact | undefined;
  decisions: Record<string, string>;
  noindex: (page: PageFact) => boolean;
}

const list = (values: string[], max = 6) =>
  values.length === 0 ? "ninguna" : values.slice(0, max).join(", ") + (values.length > max ? ` (+${values.length - max})` : "");

function adsOn(page: PageFact, ctx: Context): boolean {
  return page.adMarker || page.manualAdSlots > 0 || ctx.browser(page.kind)?.adsRequested === true;
}

function noAdsRule(kinds: PageKind[], label: string) {
  return (facts: SiteFacts, ctx: Context): Verdict => {
    const sample = ctx.pages(kinds);
    if (sample.length === 0) return { estado: "NO CUMPLE", evidencia: `sin muestra de ${label}: no se pudo medir` };
    const offending = sample.filter((page) => adsOn(page, ctx)).map((page) => page.path);
    const browserNote = facts.browser ? "marcador bt-ads, bloques <ins> y petición real a adsbygoogle.js en el navegador" : "marcador bt-ads y bloques <ins> (sin navegador)";
    return {
      estado: offending.length === 0 ? "CUMPLE" : "NO CUMPLE",
      evidencia:
        offending.length === 0
          ? `${sample.length} rutas de ${label} sin anuncios (${browserNote}): ${list(sample.map((page) => page.path))}`
          : `cargan anuncios: ${list(offending)}`,
      umbral: "0 rutas con anuncios",
      valor: offending.length
    };
  };
}

/**
 * The contradiction proposal.md found: /privacy described payments as current
 * («historial de transacciones procesadas con Wompi») while /legal/privacidad
 * says no payments are processed. Mentioning past payments is not one.
 */
const CURRENT_PAYMENTS = /historial de transacciones procesadas|procesamos (?:los )?pagos|pagos procesados con wompi/;
const NO_PAYMENTS = /no procesa(?:mos)? pagos/;
function contradictsPayments(privacy: PageFact, legal: PageFact): boolean {
  const claimsPayments = (page: PageFact) => CURRENT_PAYMENTS.test(page.text) && !NO_PAYMENTS.test(page.text);
  return claimsPayments(privacy) !== claimsPayments(legal);
}

function guideCount(facts: SiteFacts): number {
  return facts.originalPages.filter((page) => page.path.startsWith("/guias/")).length;
}

function sectionLive(ctx: Context, kind: PageKind): boolean {
  const page = ctx.page(kind);
  return Boolean(page && page.status === 200 && !ctx.noindex(page));
}

function originalTotals(facts: SiteFacts) {
  return {
    pages: facts.originalPages.length,
    words: facts.originalPages.reduce((sum, page) => sum + page.words, 0)
  };
}

function d1(ctx: Context): "a" | "b" | null {
  const value = (ctx.decisions.D1 || "").toLowerCase();
  return value === "a" || value === "b" ? value : null;
}

/** Third-party job copies: treatment required by the chosen D1 option. */
function thirdPartyTreatment(facts: SiteFacts, ctx: Context, needOriginalLink: boolean): Verdict {
  const sample = ctx.pages(THIRD_PARTY_JOBS).filter((page) => page.status === 200);
  const share = copiedShare(facts);
  const shareText = share === null ? "sin muestra de vacantes" : `${Math.round(share * 100)} % de la muestra de vacantes indexables viene de portales de terceros`;
  if (sample.length === 0) return { estado: "NO CUMPLE", evidencia: "sin muestra de vacante de terceros: no se pudo medir", valor: shareText };
  const problems: string[] = [];
  for (const page of sample) {
    if (adsOn(page, ctx)) problems.push(`${page.path}: anuncios`);
    if (!page.jobSource) problems.push(`${page.path}: no nombra la fuente`);
    if (needOriginalLink && page.externalLinks.length === 0) problems.push(`${page.path}: sin enlace al original`);
  }
  const option = d1(ctx);
  if (option === "b") {
    for (const page of sample) {
      if (!ctx.noindex(page)) problems.push(`${page.path}: D1(b) exige noindex`);
      if (page.jsonLd.some((block) => block.types.includes("JobPosting"))) problems.push(`${page.path}: D1(b) no admite JobPosting`);
      if (facts.sitemapPages.includes(page.path)) problems.push(`${page.path}: D1(b) la saca del sitemap`);
    }
  }
  if (!option) {
    return {
      estado: "NO CUMPLE",
      evidencia: `D1 sin decidir; F2 (PR #138) sin fusionar. ${shareText}. ${problems.length ? `Además: ${list(problems)}` : "Tratamiento actual: fuente nombrada, enlace al original, sin anuncios"}`,
      umbral: "D1 decidida y tratamiento de la opción elegida en todas las vacantes de terceros",
      valor: shareText,
      pendiente: "Decisión D1 del propietario (registrar en el archivo de atestaciones)"
    };
  }
  return {
    estado: problems.length === 0 ? "CUMPLE" : "NO CUMPLE",
    evidencia: problems.length === 0 ? `D1(${option}) aplicada en ${sample.length} vacantes de terceros. ${shareText}` : list(problems),
    umbral: `tratamiento D1(${option})`,
    valor: shareText
  };
}

function copiedShare(facts: SiteFacts): number | null {
  const indexable = facts.jobSample.filter((job) => job.indexable);
  if (indexable.length === 0) return null;
  return indexable.filter((job) => job.source !== "Portal oficial").length / indexable.length;
}

function hubAnalysis(ctx: Context): { ok: boolean; evidence: string } {
  const hubs = ctx.pages(["hub-grande", "hub-cargo"]).filter((page) => page.status === 200 && !ctx.noindex(page));
  if (hubs.length === 0) return { ok: false, evidence: "sin muestra de hubs indexables" };
  const without = hubs.filter((page) => !page.markers.includes("data-hub-comparison")).map((page) => page.path);
  return without.length === 0
    ? { ok: true, evidence: `${hubs.length} hubs con análisis propio (data-hub-comparison)` }
    : { ok: false, evidence: `hubs sin análisis propio (F4, PR #139 sin fusionar): ${list(without)}` };
}

function smallHubGuard(facts: SiteFacts, ctx: Context): { ok: boolean; evidence: string } {
  const small = ctx.page("hub-pequeno");
  if (!small) return { ok: false, evidence: "sin muestra de hub con < 10 vacantes" };
  const inSitemap = facts.sitemapCategories.some((loc) => loc.endsWith(small.path));
  const ok = ctx.noindex(small) && !inSitemap && !adsOn(small, ctx);
  return {
    ok,
    evidence: `${small.path}: robots «${small.robots || "(ninguno)"}», ${inSitemap ? "en" : "fuera del"} sitemap de categorías${adsOn(small, ctx) ? ", con anuncios" : ""}`
  };
}

function manualRule(what: string, observed?: (facts: SiteFacts, ctx: Context) => string) {
  return (facts: SiteFacts, ctx: Context): Verdict => ({
    estado: "MANUAL",
    evidencia: observed ? observed(facts, ctx) : "no se puede medir por código",
    pendiente: what
  });
}

const PROVIDER_PUB = /pub-\d{16}/;

export const RULES: RuleDef[] = [
  // A. Aviso de AdSense
  {
    id: "AV-1",
    grupo: "A",
    regla: "Valor único sustancial",
    tipo: "codigo",
    fase: "F2–F5",
    propuesta: "❌",
    evaluate: (facts, ctx) => {
      const totals = originalTotals(facts);
      const hubs = hubAnalysis(ctx);
      const problems: string[] = [];
      if (totals.pages < THRESHOLDS.originalPages) problems.push(`original_pages ${totals.pages} < ${THRESHOLDS.originalPages}`);
      if (totals.words < THRESHOLDS.originalWords) problems.push(`original_words ${totals.words} < ${THRESHOLDS.originalWords}`);
      if (!hubs.ok) problems.push(hubs.evidence);
      if (!d1(ctx)) problems.push("D1 sin decidir");
      return {
        estado: problems.length === 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: problems.length === 0 ? `capa original visible: ${totals.pages} páginas, ${totals.words} palabras; ${hubs.evidence}` : list(problems),
        umbral: `original_pages ≥ ${THRESHOLDS.originalPages}, original_words ≥ ${THRESHOLDS.originalWords}, hubs con análisis propio, D1 aplicada`,
        valor: `${totals.pages} páginas / ${totals.words} palabras`
      };
    }
  },
  {
    id: "AV-2",
    grupo: "A",
    regla: "Presencia constante en la Web",
    tipo: "mixta",
    fase: "F3, F4",
    propuesta: "⚠️",
    evaluate: (_facts, ctx) => {
      const guides = sectionLive(ctx, "guias");
      const reports = sectionLive(ctx, "informes");
      const live = [guides && "/guias", reports && "/informes"].filter(Boolean) as string[];
      return {
        estado: live.length === 2 ? "CUMPLE" : live.length === 1 ? "PARCIAL" : "NO CUMPLE",
        evidencia: `secciones permanentes indexables: ${list(live)}; ${!guides ? "/guias (F3, PR #137 sin fusionar) " : ""}${!reports ? "/informes (F4, PR #139 sin fusionar) " : ""}${live.length < 2 ? "no responden 200 indexable" : ""}`.trim(),
        umbral: "/guias y /informes en 200 e indexables",
        valor: live.length,
        pendiente: "14 días de la capa nueva en producción y tendencia de 404 en Search Console (F6)"
      };
    }
  },
  {
    id: "AV-3",
    grupo: "A",
    regla: "Interés genuino de los usuarios",
    tipo: "manual",
    fase: "F1, F6",
    propuesta: "⚠️",
    evaluate: manualRule("Sesiones y fuentes de tráfico en GA4 (28 días) y opiniones publicadas reales", (_facts, ctx) => {
      const page = ctx.page("opiniones");
      if (!page) return "sin muestra de /opiniones";
      return page.text.includes("todavía no hay opiniones publicadas")
        ? "/opiniones muestra «Todavía no hay opiniones publicadas»"
        : "/opiniones no muestra un apartado vacío de opiniones";
    })
  },
  {
    id: "AV-4",
    grupo: "A",
    regla: "Información, herramientas o servicios auténticos de alta calidad",
    tipo: "codigo",
    fase: "F3, F5",
    propuesta: "⚠️",
    evaluate: (facts, ctx) => {
      const guides = guideCount(facts);
      const tools = facts.originalPages.filter((page) => page.path.startsWith("/herramientas/")).length;
      const okGuides = guides >= THRESHOLDS.guides;
      const okTools = tools >= 1 || sectionLive(ctx, "herramientas");
      return {
        estado: okGuides && okTools ? "CUMPLE" : okGuides || okTools ? "PARCIAL" : "NO CUMPLE",
        evidencia: `${guides} guías indexables (F3, PR #137 sin fusionar), ${tools} herramientas (F5, según D6)`,
        umbral: `≥ ${THRESHOLDS.guides} guías y ≥ 1 herramienta`,
        valor: `${guides} guías / ${tools} herramientas`
      };
    }
  },
  {
    id: "AV-5",
    grupo: "A",
    regla: "Selección y mantenimiento estructural continuos",
    tipo: "codigo",
    fase: "F1, F4",
    propuesta: "⚠️",
    evaluate: (facts, ctx) => {
      const page = ctx.page("metodologia");
      if (!page || page.status !== 200) return { estado: "NO CUMPLE", evidencia: "/metodologia no responde 200" };
      const topics = [/dedupl|duplicad/, /vigen|venc|sigue abierta/, /30 días/, /fuente/].filter((pattern) => pattern.test(page.text)).map((pattern) => pattern.source);
      const footer = facts.browser ? facts.browser.some((entry) => entry.footerLinks.includes("/metodologia")) : null;
      const about = ctx.page("about")?.internalLinks.includes("/metodologia") ?? false;
      const ok = page.rawWords >= THRESHOLDS.rawWords && topics.length === 4 && footer !== false && about && !ctx.noindex(page);
      return {
        estado: ok ? "CUMPLE" : "NO CUMPLE",
        evidencia: `/metodologia: ${page.rawWords} palabras en el HTML inicial, temas ${list(topics)}; enlazada desde /about: ${about ? "sí" : "no"}; en el pie: ${footer === null ? "no medido (sin navegador)" : footer ? "sí" : "no"}`,
        umbral: `≥ ${THRESHOLDS.rawWords} palabras; deduplicación, vigencia, retención de 30 días y fuentes; enlazada`,
        valor: page.rawWords
      };
    }
  },
  // B. Contenido y experiencia de usuario
  {
    id: "CX-1",
    grupo: "B",
    regla: "Suficiente contenido original",
    tipo: "codigo",
    fase: "F3",
    propuesta: "❌",
    evaluate: (facts) => {
      const totals = originalTotals(facts);
      const ok = totals.pages >= THRESHOLDS.originalPages && totals.words >= THRESHOLDS.originalWords;
      return {
        estado: ok ? "CUMPLE" : totals.pages >= THRESHOLDS.originalPagesPartial ? "PARCIAL" : "NO CUMPLE",
        evidencia: `original_pages ${totals.pages}, original_words ${totals.words} (institucionales y legales; guías F3 e informes F4 sin fusionar)`,
        umbral: `original_pages ≥ ${THRESHOLDS.originalPages} y original_words ≥ ${THRESHOLDS.originalWords} (PARCIAL desde ${THRESHOLDS.originalPagesPartial} páginas)`,
        valor: `${totals.pages} / ${totals.words}`
      };
    }
  },
  {
    id: "CX-2",
    grupo: "B",
    regla: "Valor sustancial frente a sitios similares",
    tipo: "codigo",
    fase: "F2, F4",
    propuesta: "❌",
    evaluate: (_facts, ctx) => {
      const hubs = hubAnalysis(ctx);
      const option = d1(ctx);
      const ok = hubs.ok && option !== null;
      return {
        estado: ok ? "CUMPLE" : "NO CUMPLE",
        evidencia: `${hubs.evidence}; D1 ${option ? `= ${option}` : "sin decidir"}`,
        umbral: "análisis propio en cada hub indexable y D1 aplicada"
      };
    }
  },
  {
    id: "CX-3",
    grupo: "B",
    regla: "Contenido nuevo y original con regularidad",
    tipo: "mixta",
    fase: "F3, F4",
    propuesta: "❌",
    evaluate: (facts, ctx) => {
      const guides = guideCount(facts);
      const reports = sectionLive(ctx, "informes");
      const ok = guides >= THRESHOLDS.guides && reports;
      return {
        estado: ok ? "CUMPLE" : guides > 0 || reports ? "PARCIAL" : "NO CUMPLE",
        evidencia: `${guides} guías publicadas; informe mensual: ${reports ? "sí" : "no (F4 sin fusionar)"}`,
        umbral: `≥ ${THRESHOLDS.guides} guías e informe mensual publicado`,
        valor: guides,
        pendiente: `Ritmo de 2 guías por semana sostenido (fechas de publicación de las últimas ${THRESHOLDS.guideFreshDays} días)`
      };
    }
  },
  {
    id: "CX-4",
    grupo: "B",
    regla: "Sin contenido copiado (tal cual, con sinónimos, o solo insertado)",
    tipo: "mixta",
    fase: "F2",
    propuesta: "❌",
    evaluate: (facts, ctx) => thirdPartyTreatment(facts, ctx, true)
  },
  {
    id: "CX-5",
    grupo: "B",
    regla: "Sin duplicados internos ni texto largo repetido",
    tipo: "codigo",
    fase: "F1, F2",
    propuesta: "⚠️",
    evaluate: (_facts, ctx) => {
      const problems: string[] = [];
      const privacy = ctx.page("privacy");
      const legal = ctx.page("legal-privacidad");
      if (!privacy || !legal) problems.push("sin muestra de /privacy o /legal/privacidad");
      else if (contradictsPayments(privacy, legal)) problems.push("/privacy contradice a /legal/privacidad sobre pagos");
      const first = ctx.page("vacante-terceros");
      const sibling = ctx.page("vacante-terceros-hermana");
      let related = "sin par de vacantes hermanas";
      if (first && sibling) {
        const pick = (page: PageFact) =>
          page.internalLinks.filter((href) => /^\/empleos\/[0-9a-f-]{36}\//.test(href) && href !== first.path && href !== sibling.path).sort();
        const a = pick(first);
        const b = pick(sibling);
        if (a.length === 0 && b.length === 0) related = "sin bloque «Más empleos» en el HTML inicial";
        else if (a.join("|") === b.join("|")) {
          related = `bloque «Más empleos» idéntico entre vacantes hermanas (${a.length} enlaces)`;
          problems.push(`${related} — F2 (PR #138) sin fusionar`);
        } else {
          const shared = a.filter((href) => b.includes(href)).length;
          related = `bloque «Más empleos» distinto entre vacantes hermanas (${a.length} y ${b.length} enlaces, ${shared} en común)`;
        }
      }
      return {
        estado: problems.length === 0 ? "CUMPLE" : problems.length === 1 && problems[0].includes("bloque") ? "PARCIAL" : "NO CUMPLE",
        evidencia: problems.length === 0 ? `duplicate_policy_pages 0 (/privacy no contradice a /legal/privacidad); ${related}` : list(problems),
        umbral: "duplicate_policy_pages = 0 y «Más empleos» distinto entre vacantes hermanas",
        valor: problems.length
      };
    }
  },
  {
    id: "CX-6",
    grupo: "B",
    regla: "Páginas similares: ampliar o agrupar",
    tipo: "codigo",
    fase: "F4",
    propuesta: "⚠️",
    evaluate: (facts, ctx) => {
      const hubs = hubAnalysis(ctx);
      const small = smallHubGuard(facts, ctx);
      return {
        estado: hubs.ok && small.ok ? "CUMPLE" : "NO CUMPLE",
        evidencia: `${hubs.evidence}; ${small.evidence}`,
        umbral: "hubs indexables con análisis propio; hubs < 10 vacantes con noindex y fuera del sitemap"
      };
    }
  },
  {
    id: "CX-7",
    grupo: "B",
    regla: "Navegación alineada, legible, funcional y precisa",
    tipo: "codigo",
    fase: "F1",
    propuesta: "✅",
    evaluate: (facts) => {
      if (!facts.browser) return { estado: "NO CUMPLE", evidencia: "el pie se pinta en el cliente: requiere el navegador (--browser)" };
      const required = ["/contact", "/about", "/metodologia", "/legal/privacidad", "/legal/terminos"];
      const withFooter = facts.browser.filter((entry) => entry.footerLinks.length > 0);
      const missing = required.filter((href) => !withFooter.every((entry) => entry.footerLinks.includes(href)));
      const brokenFooter = facts.brokenLinks.filter((link) => required.includes(link.to));
      const ok = withFooter.length > 0 && missing.length === 0 && brokenFooter.length === 0;
      return {
        estado: ok ? "CUMPLE" : "NO CUMPLE",
        evidencia: `pie presente en ${withFooter.length}/${facts.browser.length} páginas; faltan: ${list(missing)}; enlaces del pie rotos: ${brokenFooter.length}`,
        umbral: "pie con contacto, acerca de, metodología y legales en todas las páginas; 0 rotos",
        valor: missing.length
      };
    }
  },
  {
    id: "CX-8",
    grupo: "B",
    regla: "Contenido organizado por temática",
    tipo: "codigo",
    fase: "—",
    propuesta: "✅",
    evaluate: (_facts, ctx) => {
      const sample = ctx.pages(["hub-grande", "hub-cargo", "empresas"]);
      const ok = sample.length === 3 && sample.every((page) => page.status === 200);
      return {
        estado: ok ? "CUMPLE" : "NO CUMPLE",
        evidencia: `ciudad, cargo y empresas: ${sample.map((page) => `${page.path} ${page.status}`).join(", ") || "sin muestra"}`,
        umbral: "hub de ciudad, de cargo y directorio de empresas en 200"
      };
    }
  },
  {
    id: "CX-9",
    grupo: "B",
    regla: "El sitio cumple lo que promete; sin enlaces a páginas inexistentes",
    tipo: "mixta",
    fase: "F2",
    propuesta: "⚠️",
    evaluate: (facts, ctx) => {
      const problems: string[] = [];
      const expired = ctx.page("vacante-vencida");
      if (!expired) problems.push("sin muestra de vacante vencida");
      else if (![404, 410].includes(expired.status) || !ctx.noindex(expired) || adsOn(expired, ctx)) problems.push(`vacante vencida ${expired.status}, robots «${expired.robots}»`);
      const missing = ctx.page("no-existe");
      if (!missing) problems.push("sin muestra de URL inexistente");
      else if (missing.status !== 404) problems.push(`URL inexistente responde ${missing.status} (soft 404)`);
      if (facts.brokenLinks.length > 0) problems.push(`enlaces internos rotos: ${list(facts.brokenLinks.map((link) => `${link.from} → ${link.to} (${link.status})`), 4)}`);
      return {
        estado: problems.length === 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: problems.length === 0
          ? `vacante vencida ${expired?.status} noindex sin anuncios; URL inexistente 404; ${facts.checkedLinks} enlaces internos comprobados, 0 rotos`
          : list(problems),
        umbral: "vencida 404/410 noindex sin anuncios; inexistente 404; broken_internal_links = 0",
        valor: facts.brokenLinks.length,
        pendiente: "Soft 404 y «No se ha encontrado (404)» en el informe de páginas de Search Console"
      };
    }
  },
  {
    id: "CX-10",
    grupo: "B",
    regla: "Se ve bien en los navegadores",
    tipo: "manual",
    fase: "F6",
    propuesta: "✅",
    evaluate: manualRule("Revisión en Chromium, Firefox y WebKit, escritorio y móvil (F6)", (facts) =>
      facts.browser
        ? `Chromium escritorio: ${facts.browser.filter((entry) => entry.pageErrors === 0).length}/${facts.browser.length} páginas sin errores de JavaScript${facts.browser.some((entry) => entry.error) ? `; no cargaron: ${list(facts.browser.filter((entry) => entry.error).map((entry) => `${entry.path} (${entry.error})`), 2)}` : ""}`
        : "sin navegador"
    )
  },
  // C. Políticas de spam
  {
    id: "SP-1",
    grupo: "C",
    regla: "Encubrimiento",
    tipo: "codigo",
    fase: "F0",
    propuesta: "✅",
    evaluate: (facts) => {
      if (!facts.browser) return { estado: "NO CUMPLE", evidencia: "la paridad requiere el navegador (--browser)" };
      const measured = facts.browser.filter((entry) => entry.serverWords > 0);
      if (measured.length === 0) return { estado: "NO CUMPLE", evidencia: "ninguna página con texto del servidor medida" };
      const total = measured.reduce((sum, entry) => sum + entry.serverWords, 0);
      const missing = measured.reduce((sum, entry) => sum + entry.missingWords.length, 0);
      const perPage = measured.map((entry) => ({ entry, parity: 1 - entry.missingWords.length / entry.serverWords }));
      const below = perPage.filter((row) => row.parity < THRESHOLDS.parity).sort((a, b) => a.parity - b.parity);
      const worst = below[0]?.parity ?? 1;
      const blocks = measured.reduce((sum, entry) => sum + entry.segments, 0);
      const blockMissing = measured.reduce((sum, entry) => sum + entry.missingSegments.length, 0);
      return {
        // CUMPLE: every server word is in the hydrated DOM. PARCIAL: wording
        // or format differs (labels, dates) but ≥ 75 % per page — review.
        // NO CUMPLE: a page whose server text mostly disappears after hydration.
        estado: below.length === 0 ? "CUMPLE" : worst >= 0.75 ? "PARCIAL" : "NO CUMPLE",
        evidencia:
          `ssr_hydration_parity (palabras) ${(((total - missing) / total) * 100).toFixed(1)} % en ${measured.length} páginas; ` +
          `por bloque exacto ${(((blocks - blockMissing) / Math.max(blocks, 1)) * 100).toFixed(1)} %; ` +
          `páginas por debajo del 100 %: ${list(below.map((row) => `${row.entry.path.length > 48 ? `${row.entry.path.slice(0, 45)}…` : row.entry.path} ${(row.parity * 100).toFixed(0)} % (${row.entry.missingWords.slice(0, 4).join(" ")})`), 8)}`,
        umbral: "100 % de las palabras del HTML inicial presentes en el DOM hidratado (PARCIAL ≥ 75 % por página)",
        valor: Number((((total - missing) / total) * 100).toFixed(1))
      };
    }
  },
  {
    id: "SP-2",
    grupo: "C",
    regla: "Páginas puerta",
    tipo: "codigo",
    fase: "F4",
    propuesta: "⚠️",
    evaluate: (facts, ctx) => {
      const small = smallHubGuard(facts, ctx);
      const hubs = hubAnalysis(ctx);
      return {
        estado: small.ok && hubs.ok ? "CUMPLE" : "NO CUMPLE",
        evidencia: `${small.evidence}; ${hubs.evidence}`,
        umbral: "hubs < 10 con noindex y fuera del sitemap; hubs indexables con análisis propio"
      };
    }
  },
  { id: "SP-3", grupo: "C", regla: "Dominio caducado", tipo: "manual", fase: "—", propuesta: "✅", evaluate: manualRule("El propietario confirma que el dominio no se compró para aprovechar la reputación de un sitio anterior") },
  { id: "SP-4", grupo: "C", regla: "Contenido pirateado", tipo: "manual", fase: "—", propuesta: "✅", evaluate: manualRule("Search Console → Problemas de seguridad: ninguno") },
  {
    id: "SP-5",
    grupo: "C",
    regla: "Texto y enlaces ocultos",
    tipo: "codigo",
    fase: "F0",
    propuesta: "✅",
    evaluate: (facts) => {
      if (!facts.browser) return { estado: "NO CUMPLE", evidencia: "requiere el navegador (--browser)" };
      const hidden = facts.browser.flatMap((entry) => entry.hiddenSegments.map((text) => `${entry.path}: «${text.slice(0, 60)}»`));
      return {
        estado: hidden.length === 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: hidden.length === 0
          ? `${facts.browser.length} páginas sin texto del servidor oculto por estilos (se admiten acordeones <details> y bloques que solo una de las dos anchuras, escritorio o móvil, oculta)`
          : `texto oculto: ${list(hidden, 3)}`,
        umbral: "0 bloques ocultos con display:none, visibility:hidden, tamaño 0 o fuera de pantalla",
        valor: hidden.length
      };
    }
  },
  {
    id: "SP-6",
    grupo: "C",
    regla: "Exceso de palabras clave",
    tipo: "codigo",
    fase: "F4",
    propuesta: "⚠️",
    evaluate: (_facts, ctx) => {
      const homes = ctx.pages(["home-co", "home-ve"]);
      if (homes.length === 0) return { estado: "NO CUMPLE", evidencia: "sin muestra de portada" };
      const lists = homes.map((page) => `${page.path}: ${page.bareLinkLists}`);
      const total = homes.reduce((sum, page) => sum + page.bareLinkLists, 0);
      return {
        estado: total === 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: `listas que solo enumeran enlaces (≥ 8 enlaces, < 20 % de texto propio): ${lists.join(", ")}${total ? " — F4 (PR #139) sin fusionar" : ""}`,
        umbral: "0 listas de solo enlaces en la portada (criterio propio)",
        valor: total
      };
    }
  },
  { id: "SP-7", grupo: "C", regla: "Spam de enlaces", tipo: "manual", fase: "—", propuesta: "✅", evaluate: manualRule("El propietario confirma que no compra, vende ni intercambia enlaces") },
  { id: "SP-8", grupo: "C", regla: "Tráfico automatizado hacia Google", tipo: "manual", fase: "—", propuesta: "✅", evaluate: manualRule("El propietario confirma que ningún proceso consulta la Búsqueda de Google de forma automatizada") },
  {
    id: "SP-9",
    grupo: "C",
    regla: "Prácticas maliciosas",
    tipo: "codigo",
    fase: "—",
    propuesta: "✅",
    evaluate: (facts) => {
      const attachments = facts.pages.filter((page) => page.attachment).map((page) => page.path);
      const hijack = (facts.browser ?? []).filter((entry) => entry.historyLength > 2).map((entry) => entry.path);
      const ok = attachments.length === 0 && hijack.length === 0 && facts.browser !== null;
      return {
        estado: ok ? "CUMPLE" : "NO CUMPLE",
        evidencia: facts.browser === null
          ? "sin navegador: no se midió el historial"
          : `descargas forzadas: ${list(attachments)}; entradas de historial añadidas al cargar: ${list(hijack)}`,
        umbral: "0 descargas forzadas y ≤ 2 entradas de historial tras cargar",
        valor: attachments.length + hijack.length
      };
    }
  },
  { id: "SP-10", grupo: "C", regla: "Funciones engañosas", tipo: "manual", fase: "—", propuesta: "✅", evaluate: manualRule("Revisión humana: el buscador y los botones hacen lo que dicen") },
  {
    id: "SP-11",
    grupo: "C",
    regla: "Abuso de contenido a gran escala",
    tipo: "mixta",
    fase: "F2",
    propuesta: "❌",
    evaluate: (facts, ctx) => thirdPartyTreatment(facts, ctx, false)
  },
  {
    id: "SP-12",
    grupo: "C",
    regla: "Raspado de datos",
    tipo: "mixta",
    fase: "F2",
    propuesta: "❌",
    evaluate: (facts, ctx) => thirdPartyTreatment(facts, ctx, true)
  },
  { id: "SP-13", grupo: "C", regla: "Reputación de sitios", tipo: "manual", fase: "—", propuesta: "✅", evaluate: manualRule("El propietario confirma que no aloja contenido de terceros para posicionarlo") },
  {
    id: "SP-14",
    grupo: "C",
    regla: "Redirecciones engañosas",
    tipo: "codigo",
    fase: "—",
    propuesta: "✅",
    evaluate: (facts) => {
      const host = new URL(facts.base).host;
      const problems = facts.pages.flatMap((page) => {
        const found: string[] = [];
        if (page.metaRefresh) found.push(`${page.path}: meta refresh`);
        if (page.scriptRedirect) found.push(`${page.path}: redirección por script`);
        if (page.location) {
          const target = new URL(page.location, facts.base);
          if (target.host !== host) found.push(`${page.path}: redirige a ${target.host}`);
          if (page.status !== 301 && page.status !== 308) found.push(`${page.path}: redirección ${page.status}`);
        }
        return found;
      });
      return {
        estado: problems.length === 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: problems.length === 0 ? `${facts.pages.length} respuestas sin meta refresh, redirecciones por script ni 3xx a otro dominio` : list(problems),
        umbral: "solo 301/308 al mismo dominio",
        valor: problems.length
      };
    }
  },
  {
    id: "SP-15",
    grupo: "C",
    regla: "Afiliación sin valor",
    tipo: "codigo",
    fase: "—",
    propuesta: "✅",
    evaluate: (facts) => {
      const affiliate = facts.pages.flatMap((page) =>
        page.externalLinks.filter((link) => /[?&](aff|affid|affiliate|partner|tag|ref)=/i.test(link.href)).map((link) => `${page.path} → ${new URL(link.href).host}`)
      );
      return {
        estado: affiliate.length === 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: affiliate.length === 0 ? "ningún enlace externo de la muestra lleva parámetros de afiliado" : list(affiliate),
        umbral: "0 enlaces con aff/affiliate/partner/tag/ref",
        valor: affiliate.length
      };
    }
  },
  { id: "SP-16", grupo: "C", regla: "Spam generado por usuarios", tipo: "manual", fase: "—", propuesta: "✅", evaluate: manualRule("Moderación previa de opiniones: `npm run test:site-feedback` y revisión de lo publicado en /opiniones") },
  {
    id: "SP-17",
    grupo: "C",
    regla: "Retiradas legales y de información personal",
    tipo: "codigo",
    fase: "F1",
    propuesta: "⚠️",
    evaluate: (_facts, ctx) => {
      const page = ctx.page("contact");
      const ok = Boolean(page && page.status === 200 && page.text.includes("retirar una vacante"));
      return {
        estado: ok ? "CUMPLE" : "NO CUMPLE",
        evidencia: ok ? "/contact explica en el HTML inicial cómo retirar una vacante o reportar una oferta" : "/contact no tiene el procedimiento de retiro en el HTML inicial",
        umbral: "procedimiento público de retiro en /contact"
      };
    }
  },
  { id: "SP-18", grupo: "C", regla: "Elusión de políticas", tipo: "manual", fase: "—", propuesta: "✅", evaluate: manualRule("El propietario confirma que no hay otros sitios o cuentas usados para eludir políticas") },
  {
    id: "SP-19",
    grupo: "C",
    regla: "Estafa y fraude",
    tipo: "codigo",
    fase: "F1",
    propuesta: "⚠️",
    evaluate: (facts, ctx) => {
      if (!facts.browser) return { estado: "NO CUMPLE", evidencia: "el enlace se pinta en el cliente: requiere el navegador (--browser)" };
      const jobs = ["vacante-oficial", "vacante-terceros"].map((kind) => ctx.browser(kind as PageKind)).filter(Boolean) as BrowserFact[];
      const without = jobs.filter((entry) => !entry.hasReportLink).map((entry) => entry.path);
      return {
        estado: jobs.length > 0 && without.length === 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: jobs.length === 0 ? "sin muestra de vacantes" : without.length === 0 ? `«Reportar esta vacante» visible en ${jobs.length} vacantes (oficial y terceros)` : `sin enlace de reporte: ${list(without)}`,
        umbral: "enlace «Reportar esta vacante» en cada vacante"
      };
    }
  },
  // D. Acción manual
  { id: "MA-1", grupo: "D", regla: "Sin acción manual activa", tipo: "manual", fase: "F6", propuesta: "✅", evaluate: manualRule("Search Console → Acciones manuales: «No se han detectado problemas»") },
  // E. Políticas para editores
  { id: "PP-1", grupo: "E", regla: "Sin anuncios en pantallas sin contenido o de poco valor", tipo: "codigo", fase: "F1", propuesta: "❌", evaluate: noAdsRule(EMPTY_SCREENS, "pantallas sin contenido (login, cuenta, 404, vencida)") },
  { id: "PP-2", grupo: "E", regla: "Sin anuncios en pantallas en construcción", tipo: "codigo", fase: "F1", propuesta: "⚠️", evaluate: noAdsRule(EMPTY_STATES, "estados vacíos (opiniones, hub < 10)") },
  { id: "PP-3", grupo: "E", regla: "Sin anuncios en pantallas de navegación o alertas", tipo: "codigo", fase: "F1", propuesta: "⚠️", evaluate: noAdsRule(NAVIGATION_SCREENS, "buscador y navegación") },
  {
    id: "PP-4",
    grupo: "E",
    regla: "Sin anuncios junto a contenido replicado",
    tipo: "codigo",
    fase: "F1, F2",
    propuesta: "❌",
    evaluate: (facts, ctx) => {
      const verdict = noAdsRule(THIRD_PARTY_JOBS, "vacantes de terceros")(facts, ctx);
      const official = ctx.page("vacante-oficial");
      // Positive control: without it a broken detector would always "pass".
      if (verdict.estado === "CUMPLE" && !(official && official.adMarker)) {
        return { ...verdict, estado: "PARCIAL", evidencia: `${verdict.evidencia}; control positivo fallido: la vacante oficial no lleva el marcador` };
      }
      return { ...verdict, evidencia: `${verdict.evidencia}; control positivo: la vacante oficial sí lleva el marcador` };
    }
  },
  {
    id: "PP-5",
    grupo: "E",
    regla: "Más contenido que anuncios",
    tipo: "codigo",
    fase: "F1",
    propuesta: "✅",
    evaluate: (facts) => {
      const eligible = facts.pages.filter((page) => page.adMarker);
      const slots = facts.pages.reduce((sum, page) => sum + page.manualAdSlots, 0);
      const thin = eligible.filter((page) => page.rawWords < THRESHOLDS.rawWords).map((page) => `${page.path} (${page.rawWords})`);
      return {
        estado: slots === 0 && thin.length === 0 && eligible.length > 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: `${eligible.length} páginas elegibles; bloques manuales <ins>: ${slots}; elegibles con < ${THRESHOLDS.rawWords} palabras: ${list(thin)}`,
        umbral: `0 bloques manuales; toda página con anuncios ≥ ${THRESHOLDS.rawWords} palabras propias`,
        valor: thin.length + slots
      };
    }
  },
  {
    id: "PP-6",
    grupo: "E",
    regla: "Idioma admitido",
    tipo: "codigo",
    fase: "—",
    propuesta: "✅",
    evaluate: (facts) => {
      const html = facts.pages.filter((page) => page.status === 200 && page.contentType.includes("html"));
      const other = html.filter((page) => !(page.lang || "").toLowerCase().startsWith("es")).map((page) => `${page.path} (${page.lang ?? "sin lang"})`);
      return {
        estado: html.length > 0 && other.length === 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: other.length === 0 ? `${html.length} páginas con <html lang="es…">` : list(other),
        umbral: "lang es en todas las páginas"
      };
    }
  },
  // F. Programa AdSense
  { id: "PG-1", grupo: "F", regla: "Sin clics ni impresiones no válidos", tipo: "manual", fase: "—", propuesta: "✅", evaluate: manualRule("Conducta del propietario: no abrir ni pulsar anuncios propios") },
  { id: "PG-2", grupo: "F", regla: "Fuentes de tráfico permitidas", tipo: "manual", fase: "—", propuesta: "✅", evaluate: manualRule("GA4 → Adquisición: orgánico, directo y redes; sin tráfico comprado") },
  {
    id: "PG-3",
    grupo: "F",
    regla: "Comportamiento del sitio (sin emergentes que estorben)",
    tipo: "codigo",
    fase: "—",
    propuesta: "✅",
    evaluate: (facts) => {
      if (!facts.browser) return { estado: "NO CUMPLE", evidencia: "requiere el navegador (--browser)" };
      const blocking = facts.browser.filter((entry) => entry.overlayShare > THRESHOLDS.overlayShare).map((entry) => `${entry.path} (${Math.round(entry.overlayShare * 100)} %)`);
      return {
        estado: blocking.length === 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: blocking.length === 0 ? `${facts.browser.length} páginas sin capas fijas que tapen más del ${THRESHOLDS.overlayShare * 100} % de la pantalla` : list(blocking),
        umbral: `0 capas fijas > ${THRESHOLDS.overlayShare * 100} % del viewport al cargar`,
        valor: blocking.length
      };
    }
  },
  {
    id: "PG-4",
    grupo: "F",
    regla: "Navegación no engañosa",
    tipo: "codigo",
    fase: "—",
    propuesta: "✅",
    evaluate: (_facts, ctx) => {
      const jobs = ctx.pages(["vacante-oficial", "vacante-terceros"]).filter((page) => page.status === 200);
      const vague = jobs.filter((page) => {
        const source = (page.jobSource || "").toLowerCase();
        return !page.externalLinks.some((link) => source && link.text.toLowerCase().includes(source.split(" ")[0]));
      });
      return {
        estado: jobs.length > 0 && vague.length === 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: jobs.length === 0 ? "sin muestra de vacantes" : vague.length === 0 ? `el enlace de salida nombra el portal de destino en ${jobs.length} vacantes` : `sin portal nombrado: ${list(vague.map((page) => page.path))}`,
        umbral: "el enlace a la fuente dice a qué portal lleva"
      };
    }
  },
  {
    id: "PG-5",
    grupo: "F",
    regla: "Privacidad: aviso de cookies y consentimiento donde se exige",
    tipo: "mixta",
    fase: "F1",
    propuesta: "⚠️",
    evaluate: (_facts, ctx) => {
      const legal = ctx.page("legal-privacidad");
      const cookies = ctx.page("legal-cookies");
      const privacy = ctx.page("privacy");
      const problems: string[] = [];
      if (!legal || legal.status !== 200) problems.push("/legal/privacidad no responde 200");
      else {
        if (!legal.text.includes("google")) problems.push("la política no nombra a Google");
        if (!/publicidad|anuncios/.test(legal.text)) problems.push("la política no declara la publicidad");
        if (!/cookie/.test(legal.text)) problems.push("la política no menciona cookies");
        if (!/adssettings|configuración de anuncios|personaliza/.test(legal.text)) problems.push("no dice cómo desactivar la personalización");
      }
      if (!cookies || cookies.status !== 200) problems.push("/legal/cookies no responde 200");
      if (privacy && legal && contradictsPayments(privacy, legal)) problems.push("/privacy contradice a /legal/privacidad sobre pagos");
      return {
        estado: problems.length === 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: problems.length === 0 ? "una sola historia de privacidad: Google, publicidad, cookies y cómo desactivar la personalización; /privacy coherente" : list(problems),
        umbral: "política coherente que declara Google, cookies publicitarias y exclusión",
        pendiente: "D5: mensaje de consentimiento (CMP) para EEE/Reino Unido/Suiza activo en AdSense → Privacidad y mensajes"
      };
    }
  },
  {
    id: "PG-6",
    grupo: "F",
    regla: "Propiedad del sitio y ads.txt",
    tipo: "codigo",
    fase: "—",
    propuesta: "✅",
    evaluate: (facts) => {
      const meta = facts.adsenseAccount?.match(PROVIDER_PUB)?.[0] ?? null;
      const line = (facts.adsTxt || "").split(/\r?\n/).find((row) => /^\s*google\.com\s*,/i.test(row)) ?? null;
      const pub = line?.match(PROVIDER_PUB)?.[0] ?? null;
      const ok = Boolean(meta && pub && meta === pub && /DIRECT/i.test(line || ""));
      return {
        estado: ok ? "CUMPLE" : "NO CUMPLE",
        evidencia: `ads.txt: ${line ? "línea google.com presente" : "sin línea google.com"}; meta google-adsense-account: ${meta ?? "ausente"}; coinciden: ${ok ? "sí" : "no"}`,
        umbral: "ads.txt con google.com, <pub>, DIRECT igual a la meta de verificación",
        valor: pub ?? ""
      };
    }
  },
  { id: "PG-7", grupo: "F", regla: "Titular mayor de 18 años", tipo: "manual", fase: "—", propuesta: "✅", evaluate: manualRule("Dato del titular de la cuenta de AdSense") },
  // G. Condiciones técnicas
  {
    id: "TX-1",
    grupo: "G",
    regla: "El texto está en el HTML inicial",
    tipo: "codigo",
    fase: "F1",
    propuesta: "⚠️",
    evaluate: (facts, ctx) => {
      const sample = ctx.pages(TEXT_PAGE_KINDS);
      if (sample.length < TEXT_PAGE_KINDS.length) return { estado: "NO CUMPLE", evidencia: `solo ${sample.length}/${TEXT_PAGE_KINDS.length} páginas de texto en la muestra` };
      // Completeness: the raw HTML carries the page's own text, not a shell
      // that JavaScript fills (what proposal.md measured: 6–39 words).
      const incomplete = sample.filter((page) => {
        const hydrated = ctx.browser(page.kind)?.hydratedWords;
        return page.status !== 200 || (hydrated !== undefined && hydrated > 0 && page.rawWords < 0.8 * hydrated);
      });
      // design.md threshold: raw_html_words ≥ 150 for every text page.
      const short = sample.filter((page) => page.rawWords < THRESHOLDS.rawWords);
      const words = sample.map((page) => page.rawWords);
      const ratio = sample
        .map((page) => {
          const hydrated = ctx.browser(page.kind)?.hydratedWords;
          return hydrated ? `${page.path} ${page.rawWords}/${hydrated}` : null;
        })
        .filter(Boolean) as string[];
      return {
        estado: incomplete.length > 0 ? "NO CUMPLE" : short.length > 0 ? "PARCIAL" : "CUMPLE",
        evidencia:
          `${sample.length} páginas de texto; ${incomplete.length === 0 ? "todas entregan su texto en el HTML inicial" : `incompletas sin JavaScript: ${list(incomplete.map((page) => page.path))}`}` +
          `${facts.browser ? "" : " (completitud sin medir: sin navegador)"}; por debajo de ${THRESHOLDS.rawWords} palabras: ${list(short.map((page) => `${page.path} (${page.rawWords})`))}` +
          `${ratio.length ? `; palabras inicial/hidratado: ${list(ratio, 11)}` : ""}`,
        umbral: `HTML inicial ≥ 80 % del texto hidratado y raw_html_words ≥ ${THRESHOLDS.rawWords} en cada página de texto (design.md)`,
        valor: words.length ? Math.min(...words) : 0
      };
    }
  },
  {
    id: "TX-2",
    grupo: "G",
    regla: "El rastreador de AdSense puede entrar",
    tipo: "codigo",
    fase: "—",
    propuesta: "✅",
    evaluate: (facts) => {
      if (facts.robotsTxt === null) return { estado: "NO CUMPLE", evidencia: "robots.txt no respondió" };
      const blocked = ["Mediapartners-Google", "Googlebot", "AdsBot-Google"].filter((agent) => robotsBlocksSite(facts.robotsTxt!, agent));
      return {
        estado: blocked.length === 0 ? "CUMPLE" : "NO CUMPLE",
        evidencia: blocked.length === 0 ? "robots.txt no bloquea el sitio a Mediapartners-Google, Googlebot ni AdsBot-Google" : `bloqueados: ${list(blocked)}`,
        umbral: "sin Disallow: / para los rastreadores de Google"
      };
    }
  }
];

export const MEASURABLE: Tipo[] = ["codigo", "mixta"];

export function evaluateRules(facts: SiteFacts, attestations: AuditAttestations = {}): RuleResult[] {
  const ctx: Context = {
    page: (kind) => facts.pages.find((page) => page.kind === kind),
    pages: (kinds) => facts.pages.filter((page) => kinds.includes(page.kind)),
    browser: (kind) => facts.browser?.find((entry) => entry.kind === kind),
    decisions: attestations.decisions ?? {},
    noindex: (page) => /noindex/.test(page.robots)
  };
  return RULES.map((rule) => {
    let verdict: Verdict;
    try {
      verdict = rule.evaluate(facts, ctx);
    } catch (error) {
      verdict = { estado: "NO CUMPLE", evidencia: `error al evaluar: ${error instanceof Error ? error.message : "desconocido"}` };
    }
    const attested = attestations.manual?.[rule.id];
    if (verdict.estado === "MANUAL" && attested) {
      verdict = { ...verdict, estado: "CUMPLE", evidencia: `atestado ${attested.fecha}: ${attested.evidencia}`, pendiente: undefined };
    }
    return {
      id: rule.id,
      grupo: rule.grupo,
      regla: rule.regla,
      tipo: rule.tipo,
      fase: rule.fase,
      propuesta: rule.propuesta,
      estado: verdict.estado,
      evidencia: verdict.evidencia,
      umbral: verdict.umbral ?? null,
      valor: verdict.valor ?? null,
      pendiente_manual: verdict.pendiente ?? null
    };
  });
}

export interface AuditSummary {
  total: number;
  porEstado: Record<Estado, number>;
  medibles: number;
  mediblesQueNoCumplen: string[];
  metricas: Record<string, number | string | null>;
}

export function summarize(results: RuleResult[], facts: SiteFacts): AuditSummary {
  const porEstado: Record<Estado, number> = { CUMPLE: 0, PARCIAL: 0, "NO CUMPLE": 0, MANUAL: 0 };
  for (const result of results) porEstado[result.estado] += 1;
  const measurable = results.filter((result) => MEASURABLE.includes(result.tipo));
  const totals = originalTotals(facts);
  const share = copiedShare(facts);
  const browser = facts.browser ?? [];
  const serverWords = browser.reduce((sum, entry) => sum + entry.serverWords, 0);
  const missingWords = browser.reduce((sum, entry) => sum + entry.missingWords.length, 0);
  const privacy = facts.pages.find((page) => page.kind === "privacy");
  const legal = facts.pages.find((page) => page.kind === "legal-privacidad");
  const privacyPair = privacy && legal ? ([privacy, legal] as const) : null;
  const textWords = facts.pages.filter((page) => TEXT_PAGE_KINDS.includes(page.kind)).map((page) => page.rawWords);
  const ineligible = facts.pages.filter((page) => [...EMPTY_SCREENS, ...EMPTY_STATES, ...NAVIGATION_SCREENS, ...THIRD_PARTY_JOBS].includes(page.kind));
  return {
    total: results.length,
    porEstado,
    medibles: measurable.length,
    mediblesQueNoCumplen: measurable.filter((result) => result.estado !== "CUMPLE").map((result) => result.id),
    metricas: {
      original_pages: totals.pages,
      original_words: totals.words,
      copied_indexable_share: share === null ? null : Number(share.toFixed(3)),
      ads_on_ineligible_routes: ineligible.filter((page) => page.adMarker || browser.some((entry) => entry.path === page.path && entry.adsRequested)).length,
      ssr_hydration_parity: serverWords === 0 ? null : Number(((serverWords - missingWords) / serverWords).toFixed(3)),
      broken_internal_links: facts.brokenLinks.length,
      duplicate_policy_pages: privacyPair && contradictsPayments(privacyPair[0], privacyPair[1]) ? 1 : 0,
      raw_html_words_min_text_pages: textWords.length ? Math.min(...textWords) : null,
      requests: facts.requests
    }
  };
}

/** Exit code: 0 only when every measurable rule is CUMPLE. */
export function exitCodeFor(results: RuleResult[]): number {
  return results.some((result) => MEASURABLE.includes(result.tipo) && result.estado !== "CUMPLE") ? 1 : 0;
}

/** Compare against a committed matrix (`--expect`): ids whose state changed. */
export function diffAgainst(results: RuleResult[], expected: Record<string, Estado>): { id: string; esperado: Estado | null; obtenido: Estado }[] {
  const ids = new Set([...Object.keys(expected), ...results.map((result) => result.id)]);
  return [...ids]
    .map((id) => ({ id, esperado: expected[id] ?? null, obtenido: results.find((result) => result.id === id)?.estado ?? ("NO CUMPLE" as Estado) }))
    .filter((entry) => entry.esperado !== entry.obtenido);
}

export function renderSummary(results: RuleResult[], summary: AuditSummary, header: string): string {
  const lines = [header, ""];
  for (const group of ["A", "B", "C", "D", "E", "F", "G"]) {
    for (const result of results.filter((entry) => entry.grupo === group)) {
      lines.push(`${result.id.padEnd(6)} ${result.estado.padEnd(9)} ${result.regla}`);
      lines.push(`       ${result.evidencia}`);
      if (result.pendiente_manual) lines.push(`       pendiente: ${result.pendiente_manual}`);
    }
  }
  lines.push("");
  lines.push(
    `Total ${summary.total}: ${summary.porEstado.CUMPLE} CUMPLE · ${summary.porEstado.PARCIAL} PARCIAL · ${summary.porEstado["NO CUMPLE"]} NO CUMPLE · ${summary.porEstado.MANUAL} MANUAL`
  );
  lines.push(`Medibles que no cumplen (${summary.mediblesQueNoCumplen.length}/${summary.medibles}): ${summary.mediblesQueNoCumplen.join(", ") || "ninguna"}`);
  lines.push(`Métricas: ${Object.entries(summary.metricas).map(([key, value]) => `${key}=${value ?? "—"}`).join(" · ")}`);
  return lines.join("\n");
}
