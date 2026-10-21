import { DISALLOW_ALL, ALLOW_ALL, isAllowed, parseRobots, type RobotsPolicy } from "../discovery/robots.js";
import type { HttpGet } from "../types.js";

/**
 * Helpers for connectors that read an employer's career SITE instead of a
 * documented JSON API (SuccessFactors, Magneto). robots.txt is read on every
 * board read, per RFC 9309 (docs/source-catalog/site-probe-ats-links.md §1.1):
 * 4xx = everything allowed, 5xx / network error = nothing allowed.
 */

// A public hostname with an optional single path segment (a site within a
// shared host: empleo.grupobancolombia.com/bancolombia). Never an IP literal
// or a port: the ref is built into a URL and must not reach internal hosts.
export const SITE_REF = /^(?!\d+\.\d+\.\d+\.\d+(\/|$))[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+(?:\/[A-Za-z0-9_-]{1,60})?$/;

export function splitSiteRef(ref: string): { origin: string; sitePath: string } {
  const slash = ref.indexOf("/");
  return slash < 0 ? { origin: `https://${ref}`, sitePath: "" } : { origin: `https://${ref.slice(0, slash)}`, sitePath: ref.slice(slash) };
}

export async function readRobots(origin: string, http: HttpGet): Promise<RobotsPolicy> {
  try {
    const response = await http(`${origin}/robots.txt`, { accept: "text/plain" });
    if (response.status === 200) return parseRobots(response.body);
    if (response.status >= 400 && response.status < 500) return ALLOW_ALL;
    return DISALLOW_ALL;
  } catch {
    return DISALLOW_ALL;
  }
}

export function allowedUrl(policy: RobotsPolicy, url: string): boolean {
  const parsed = new URL(url);
  return isAllowed(policy, parsed.pathname + parsed.search);
}

/** Inner HTML of the first element opened at `start` (index of its "<tag"), balancing nested same-name tags. */
export function innerHtmlAt(html: string, start: number, tag: string, maxLength = 200_000): string | null {
  const openEnd = html.indexOf(">", start);
  if (openEnd < 0) return null;
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  pattern.lastIndex = openEnd + 1;
  let depth = 1;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    if (match.index - openEnd > maxLength) return null;
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(openEnd + 1, match.index);
  }
  return null;
}
