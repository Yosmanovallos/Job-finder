// Pure HTML readers for the AdSense auditor (openspec/changes/adsense-readiness,
// F0). Regex-based on purpose: the auditor reads the raw server response the
// way a crawler without JavaScript does, and never keeps the HTML itself —
// only the indicators below go into a report.

/** The full tag the server writes on ad-eligible pages (src/lib/ad-eligibility.ts). */
export const AD_MARKER = '<meta name="bt-ads" content="on" />';

const ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'"
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
    const lower = name.toLowerCase();
    if (ENTITY[lower] !== undefined) return ENTITY[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16) || 32);
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10) || 32);
    return " ";
  });
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Inner HTML of `<div id="app">` (SSR output), or "" when the shell is empty. */
export function appHtml(html: string): string {
  const start = html.search(/<div id="app"[^>]*>/);
  if (start < 0) return "";
  const open = html.indexOf(">", start) + 1;
  // In the shell (index.html) #app is the last element of <body>.
  const bodyEnd = html.lastIndexOf("</body>");
  const end = html.lastIndexOf("</div>", bodyEnd >= 0 ? bodyEnd : html.length);
  return end >= open ? html.slice(open, end) : "";
}

function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    // The site menu and footer are client-only; an SSR <nav> is page content
    // (e.g. the /empresas directory), so only header/footer are dropped.
    .replace(/<(header|footer)\b[\s\S]*?<\/\1>/gi, " ");
}

/** Visible-to-a-crawler text of the main content: no scripts, menu or footer. */
export function mainText(html: string): string {
  const content = appHtml(html) || html.replace(/^[\s\S]*?<body[^>]*>/i, "");
  return decodeEntities(stripNonContent(content).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const BLOCK = /<\/?(p|li|h[1-6]|dt|dd|td|th|blockquote|figcaption|summary|section|article|div|ul|ol|table|tr|br)\b[^>]*>/gi;

/**
 * Text blocks of the SSR content (paragraphs, list items, headings) with at
 * least `minWords` words. Used for the SSR ↔ hydrated parity check (SP-1).
 */
export function textSegments(html: string, minWords = 4): string[] {
  const content = stripNonContent(appHtml(html));
  const seen = new Set<string>();
  const segments: string[] = [];
  for (const part of content.replace(BLOCK, "\n").split("\n")) {
    const text = decodeEntities(part.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (countWords(text) < minWords || seen.has(text)) continue;
    seen.add(text);
    segments.push(text);
  }
  return segments;
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? decodeEntities(match[2] ?? match[3] ?? "") : null;
}

export function metaContent(html: string, name: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if ((attr(tag, "name") ?? attr(tag, "property"))?.toLowerCase() === name.toLowerCase()) return attr(tag, "content");
  }
  return null;
}

export function canonicalHref(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (attr(tag, "rel")?.toLowerCase() === "canonical") return attr(tag, "href");
  }
  return null;
}

export function htmlLang(html: string): string | null {
  const tag = /<html\b[^>]*>/i.exec(html)?.[0];
  return tag ? attr(tag, "lang") : null;
}

export interface LinkInfo {
  href: string;
  text: string;
}

export function links(html: string): LinkInfo[] {
  const found: LinkInfo[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(`<a ${match[1]}>`, "href");
    if (!href) continue;
    found.push({ href, text: decodeEntities(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() });
  }
  return found;
}

export interface JsonLdInfo {
  valid: boolean;
  types: string[];
}

export function jsonLd(html: string): JsonLdInfo[] {
  const blocks: JsonLdInfo[] = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1]) as unknown;
      const types = new Set<string>();
      const walk = (node: unknown) => {
        if (Array.isArray(node)) node.forEach(walk);
        else if (node && typeof node === "object") {
          const type = (node as Record<string, unknown>)["@type"];
          if (typeof type === "string") types.add(type);
          if (Array.isArray(type)) type.forEach((entry) => typeof entry === "string" && types.add(entry));
          const graph = (node as Record<string, unknown>)["@graph"];
          if (graph) walk(graph);
        }
      };
      walk(value);
      blocks.push({ valid: true, types: [...types] });
    } catch {
      blocks.push({ valid: false, types: [] });
    }
  }
  return blocks;
}

/** window.__SSR_JOB__ source label, when the page embeds it (anonymous job pages). */
export function ssrJobSource(html: string): string | null {
  const raw = /window\.__SSR_JOB__=([\s\S]*?);<\/script>/.exec(html)?.[1];
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as { job?: { source?: unknown } };
    return typeof payload.job?.source === "string" ? payload.job.source : null;
  } catch {
    return null;
  }
}

/** `<ins class="adsbygoogle">` manual ad slots (none are placed before approval). */
export function manualAdSlots(html: string): number {
  return (html.match(/<ins\b[^>]*class=["'][^"']*adsbygoogle/gi) ?? []).length;
}

export function hasMetaRefresh(html: string): boolean {
  return (html.match(/<meta\b[^>]*>/gi) ?? []).some((tag) => attr(tag, "http-equiv")?.toLowerCase() === "refresh");
}

/** Inline scripts that navigate away on load (deceptive redirect). The SPA router never assigns location on load. */
export function hasScriptRedirect(html: string): boolean {
  for (const match of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    // Case-sensitive and anchored: `safeLocation =` or `location.search` are not navigations.
    if (/(?:^|[^\w.$])(?:window\.|document\.)?location(?:\.href)?\s*=(?!=)|location\.(?:replace|assign)\(/.test(match[1])) return true;
  }
  return false;
}

/** Blocks that only enumerate links: ≥ 8 links and < 20 % of their words outside the anchors (SP-6). */
export function bareLinkLists(html: string): { links: number; words: number; linkWords: number }[] {
  const content = appHtml(html);
  const lists: { links: number; words: number; linkWords: number }[] = [];
  for (const match of content.matchAll(/<(ul|ol|nav)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const inner = match[2];
    const anchors = links(inner);
    if (anchors.length < 8) continue;
    const words = countWords(decodeEntities(inner.replace(/<[^>]+>/g, " ")));
    const linkWords = anchors.reduce((sum, link) => sum + countWords(link.text), 0);
    if (words > 0 && (words - linkWords) / words < 0.2) lists.push({ links: anchors.length, words, linkWords });
  }
  return lists;
}

export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => decodeEntities(match[1]));
}

/** robots.txt: true when `agent` (or `*`) is told `Disallow: /` for the whole site. */
export function robotsBlocksSite(robots: string, agent: string): boolean {
  const groups: { agents: string[]; rules: string[] }[] = [];
  let current: { agents: string[]; rules: string[] } | null = null;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (key === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(match[2].toLowerCase());
    } else if (current && (key === "disallow" || key === "allow")) {
      current.rules.push(`${key}:${match[2]}`);
    }
  }
  const named = groups.filter((group) => group.agents.includes(agent.toLowerCase()));
  const applicable = named.length > 0 ? named : groups.filter((group) => group.agents.includes("*"));
  return applicable.some((group) => group.rules.includes("disallow:/"));
}
