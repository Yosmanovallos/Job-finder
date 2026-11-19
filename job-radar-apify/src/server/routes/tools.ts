import type http from "node:http";
import {
  NOT_FOUND_HTML,
  NOT_FOUND_MARKDOWN,
  SITE_ORIGIN,
  injectPublicContent,
  renderContentMarkdown,
  wantsMarkdown
} from "../../lib/agent-readiness.js";
import { markAdEligible } from "../../lib/ad-eligibility.js";
import { escapeJsonForScriptTag } from "../../lib/job-seo.js";
import type { Guide } from "../../lib/guides.js";
import {
  TOOLS_BASE_PATH,
  toolBySlug,
  toolJsonLd,
  toolPublicContent,
  toolsBreadcrumbJsonLd,
  toolsIndexPublicContent,
  toolsItemListJsonLd,
  type ToolPage
} from "../../lib/tools-content.js";
import { relatedGuidesSnippet } from "./guides.js";
import type { SendBody } from "./agent-readiness.js";

// /herramientas and /herramientas/:slug (adsense-readiness F5, ADS-060).
// Static, deterministic pages: no database, no job cache. The full
// explanation is in the raw HTML; the interactive calculator is the React
// page, which computes in the browser and sends nothing anywhere.

export interface ToolsRouteContext {
  pathname: string;
  method: string;
  guides: Guide[];
  loadIndexHtml: () => Promise<string>;
  sendBody: SendBody;
}

export function isToolsRoute(pathname: string): boolean {
  return pathname === TOOLS_BASE_PATH || pathname.startsWith(`${TOOLS_BASE_PATH}/`);
}

const NOSCRIPT_NOTE =
  "<p data-tool-noscript>La calculadora interactiva aparece al cargar la página y necesita JavaScript. Sin él, el texto de esta página explica la fórmula completa para hacer la cuenta a mano.</p>";

function appendToHead(html: string, snippet: string): string {
  return html.replace("</head>", () => `${snippet}</head>`);
}

export function renderToolPageHtml(indexHtml: string, tool: ToolPage, guides: Guide[]): string {
  const content = toolPublicContent(tool);
  const related = relatedGuidesSnippet(guides, tool.guideTags, tool.path);
  let html = injectPublicContent(indexHtml, content);
  // The noscript note and «Guías relacionadas» go inside the article, after the explanation.
  html = html.replace(/<\/article><\/div>/, () => `${NOSCRIPT_NOTE}${related.html}</article></div>`);
  html = appendToHead(html,
    `  <script type="application/ld+json">${escapeJsonForScriptTag(toolJsonLd(tool, SITE_ORIGIN))}</script>\n` +
    `  <script type="application/ld+json">${escapeJsonForScriptTag(toolsBreadcrumbJsonLd(tool, SITE_ORIGIN))}</script>\n` +
    related.head);
  // Original publisher content with a working tool: ads allowed (PP-1…PP-5).
  return markAdEligible(html);
}

export function renderToolsIndexHtml(indexHtml: string): string {
  const html = injectPublicContent(indexHtml, toolsIndexPublicContent());
  // A list of links is a navigation screen (PP-3): no ad marker here.
  return appendToHead(html,
    `  <script type="application/ld+json">${escapeJsonForScriptTag(toolsItemListJsonLd(SITE_ORIGIN))}</script>\n` +
    `  <script type="application/ld+json">${escapeJsonForScriptTag(toolsBreadcrumbJsonLd(null, SITE_ORIGIN))}</script>\n`);
}

/** Handles every /herramientas path. Returns false only for non-matching paths. */
export async function handleToolsRoute(req: http.IncomingMessage, res: http.ServerResponse, context: ToolsRouteContext): Promise<boolean> {
  const { pathname, method, sendBody } = context;
  if (!isToolsRoute(pathname)) return false;
  const markdown = wantsMarkdown(req.headers.accept);
  const vary = "Accept";
  const notFound = async () => {
    await sendBody(req, res, 404, {
      "Content-Type": markdown ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      Vary: vary
    }, markdown ? NOT_FOUND_MARKDOWN : NOT_FOUND_HTML);
    return true;
  };
  if (method !== "GET" && method !== "HEAD") return notFound();
  const htmlHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", Vary: vary };
  const markdownHeaders = { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "private, no-store", Vary: vary };

  if (pathname === TOOLS_BASE_PATH) {
    if (markdown) await sendBody(req, res, 200, markdownHeaders, renderContentMarkdown(toolsIndexPublicContent()));
    else await sendBody(req, res, 200, htmlHeaders, renderToolsIndexHtml(await context.loadIndexHtml()));
    return true;
  }
  const tool = toolBySlug(pathname.slice(TOOLS_BASE_PATH.length + 1));
  if (!tool) return notFound();
  if (markdown) await sendBody(req, res, 200, markdownHeaders, renderContentMarkdown(toolPublicContent(tool)));
  else await sendBody(req, res, 200, htmlHeaders, renderToolPageHtml(await context.loadIndexHtml(), tool, context.guides));
  return true;
}
