import type http from "node:http";
import {
  NOT_FOUND_HTML,
  NOT_FOUND_MARKDOWN,
  SITE_ORIGIN,
  injectPublicContent,
  renderContentHtml,
  wantsMarkdown,
  type PublicContent
} from "../../lib/agent-readiness.js";
import { markAdEligible } from "../../lib/ad-eligibility.js";
import { escapeJsonForScriptTag } from "../../lib/job-seo.js";
import {
  GUIDES_BASE_PATH,
  GUIDES_INDEX_DESCRIPTION,
  GUIDES_INDEX_HEADING,
  GUIDES_INDEX_INTRO,
  GUIDES_INDEX_TITLE,
  formatSpanishDate,
  guideArticleJsonLd,
  guidePath,
  guidePayload,
  guideSummary,
  renderGuideBodyHtml,
  renderGuideIndexMarkdown,
  renderGuideMarkdown,
  renderRelatedGuidesHtml,
  relatedGuides,
  type Guide,
  type SsrGuideLinks
} from "../../lib/guides.js";
import type { SendBody } from "./agent-readiness.js";

// /guias, /guias/:slug, /api/guias[/:slug] and /sitemap-guides.xml
// (adsense-readiness F3, ADS-040). Kept out of server.ts's dashboard paths:
// no database, no job cache, only the guides that ship with the deploy.

export const GUIDES_SITEMAP_PATH = "/sitemap-guides.xml";

export interface GuidesRouteContext {
  pathname: string;
  method: string;
  guides: Guide[];
  loadIndexHtml: () => Promise<string>;
  sendBody: SendBody;
}

export function isGuidesRoute(pathname: string): boolean {
  return pathname === GUIDES_BASE_PATH || pathname.startsWith(`${GUIDES_BASE_PATH}/`) ||
    pathname === "/api/guias" || pathname.startsWith("/api/guias/") || pathname === GUIDES_SITEMAP_PATH;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function withApp(indexHtml: string, content: PublicContent, appHtml: string): string {
  const html = injectPublicContent(indexHtml, content);
  return html.replace(`<div id="app">${renderContentHtml(content)}</div>`, () => `<div id="app">${appHtml}</div>`);
}

function appendToHead(html: string, snippet: string): string {
  return html.replace("</head>", () => `${snippet}</head>`);
}

export function renderGuidePageHtml(indexHtml: string, guide: Guide): string {
  const { meta } = guide;
  const content: PublicContent = { pathname: guidePath(meta.slug), title: `${meta.titulo} | BuscoTrabajo`, description: meta.descripcion, heading: meta.titulo, introduction: [], sections: [] };
  const modified = meta.actualizada || meta.publicada;
  const byline = `<p data-guide-byline>Por ${escapeHtml(meta.autor)} · Publicada el <time datetime="${meta.publicada}">${formatSpanishDate(meta.publicada)}</time>` +
    ` · Actualizada el <time datetime="${modified}">${formatSpanishDate(modified)}</time>` +
    ` · Revisada por ${escapeHtml(meta.revisado_por)} el ${formatSpanishDate(meta.fecha_revision)}</p>`;
  const appHtml = `<article data-guide="${escapeHtml(meta.slug)}"><nav aria-label="Ruta"><a href="${GUIDES_BASE_PATH}">Guías</a></nav>` +
    `<h1>${escapeHtml(meta.titulo)}</h1>\n${byline}\n${renderGuideBodyHtml(guide)}</article>`;
  let html = withApp(indexHtml, content, appHtml);
  html = html.replace(/<meta[^>]*property=["']og:type["'][^>]*>/, () => `<meta property="og:type" content="article" />`);
  html = appendToHead(html,
    `  <script type="application/ld+json">${escapeJsonForScriptTag(guideArticleJsonLd(guide, SITE_ORIGIN))}</script>\n` +
    `  <script>window.__SSR_GUIDE__=${escapeJsonForScriptTag(guidePayload(guide))};</script>\n`);
  // Original, reviewed publisher content: the one place in /guias with ads.
  return markAdEligible(html);
}

export function renderGuidesIndexHtml(indexHtml: string, guides: Guide[]): string {
  const content: PublicContent = { pathname: GUIDES_BASE_PATH, title: GUIDES_INDEX_TITLE, description: GUIDES_INDEX_DESCRIPTION, heading: GUIDES_INDEX_HEADING, introduction: [GUIDES_INDEX_INTRO], sections: [] };
  const items = guides.map((guide) => {
    const date = guide.meta.actualizada || guide.meta.publicada;
    return `<li><a href="${guidePath(guide.meta.slug)}">${escapeHtml(guide.meta.titulo)}</a><p>${escapeHtml(guide.meta.descripcion)}</p>` +
      `<p>Actualizada el <time datetime="${date}">${formatSpanishDate(date)}</time></p></li>`;
  }).join("");
  const appHtml = `<article data-guides-index><h1>${escapeHtml(GUIDES_INDEX_HEADING)}</h1>\n<p>${escapeHtml(GUIDES_INDEX_INTRO)}</p>\n<ul>${items}</ul></article>`;
  const html = withApp(indexHtml, content, appHtml);
  // A list of links is a navigation screen (PP-3): no ad marker here.
  return appendToHead(html, `  <script>window.__SSR_GUIDES__=${escapeJsonForScriptTag(guides.map(guideSummary))};</script>\n`);
}

export function buildGuidesSitemapXml(guides: Guide[]): string {
  const urls = [
    `  <url>\n    <loc>${SITE_ORIGIN}${GUIDES_BASE_PATH}</loc>\n  </url>`,
    ...guides.map((guide) => `  <url>\n    <loc>${SITE_ORIGIN}${guidePath(guide.meta.slug)}</loc>\n    <lastmod>${guide.meta.actualizada || guide.meta.publicada}</lastmod>\n  </url>`)
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/** Sub-sitemaps the /sitemap.xml index lists: the guides one only when there is a guide to list. */
export function guidesSitemapEntries(guides: Guide[]): string[] {
  return guides.length > 0 ? [`${SITE_ORIGIN}${GUIDES_SITEMAP_PATH}`] : [];
}

/** Handles every /guias-family path. Returns false only for non-matching paths. */
export async function handleGuidesRoute(req: http.IncomingMessage, res: http.ServerResponse, context: GuidesRouteContext): Promise<boolean> {
  const { pathname, method, guides, sendBody } = context;
  if (!isGuidesRoute(pathname)) return false;
  const markdown = wantsMarkdown(req.headers.accept);
  const notFound = async () => {
    const isApi = pathname.startsWith("/api/");
    await sendBody(req, res, 404, {
      "Content-Type": isApi ? "application/json; charset=utf-8" : markdown ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      Vary: "Accept"
    }, isApi ? JSON.stringify({ error: { code: "not_found", message: "Guía no encontrada." } }) : markdown ? NOT_FOUND_MARKDOWN : NOT_FOUND_HTML);
    return true;
  };
  if (method !== "GET" && method !== "HEAD") return notFound();
  // Switch off or nothing approved yet: every /guias path is a real 404.
  if (guides.length === 0) return notFound();

  const htmlHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Accept" };
  const markdownHeaders = { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Accept" };
  const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" };

  if (pathname === GUIDES_SITEMAP_PATH) {
    await sendBody(req, res, 200, { "Content-Type": "application/xml; charset=utf-8" }, buildGuidesSitemapXml(guides));
    return true;
  }
  if (pathname === "/api/guias") {
    await sendBody(req, res, 200, jsonHeaders, JSON.stringify(guides.map(guideSummary)));
    return true;
  }
  if (pathname.startsWith("/api/guias/")) {
    const guide = guides.find((item) => item.meta.slug === pathname.slice("/api/guias/".length));
    if (!guide) return notFound();
    await sendBody(req, res, 200, jsonHeaders, JSON.stringify(guidePayload(guide)));
    return true;
  }
  if (pathname === GUIDES_BASE_PATH) {
    if (markdown) await sendBody(req, res, 200, markdownHeaders, renderGuideIndexMarkdown(guides));
    else await sendBody(req, res, 200, htmlHeaders, renderGuidesIndexHtml(await context.loadIndexHtml(), guides));
    return true;
  }
  const slug = pathname.slice(GUIDES_BASE_PATH.length + 1);
  const guide = guides.find((item) => item.meta.slug === slug);
  if (!guide) return notFound();
  if (markdown) await sendBody(req, res, 200, markdownHeaders, renderGuideMarkdown(guide));
  else await sendBody(req, res, 200, htmlHeaders, renderGuidePageHtml(await context.loadIndexHtml(), guide));
  return true;
}

/**
 * «Guías relacionadas» for a hub or job page: body HTML plus the head
 * payload React reads (window.__SSR_GUIDE_LINKS__), both empty when no
 * published guide matches — and always while /guias is switched off.
 */
export function relatedGuidesSnippet(guides: Guide[], tags: string[], pathname: string): { html: string; head: string } {
  const links = relatedGuides(guides, tags);
  if (links.length === 0) return { html: "", head: "" };
  const payload: SsrGuideLinks = { path: pathname, links };
  return {
    html: renderRelatedGuidesHtml(links),
    head: `  <script>window.__SSR_GUIDE_LINKS__=${escapeJsonForScriptTag(payload)};</script>\n`
  };
}
