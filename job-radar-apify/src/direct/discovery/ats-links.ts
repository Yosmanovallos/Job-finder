/**
 * ATS boards named by links on an employer's own site
 * (docs/source-catalog/site-probe-ats-links.md §2). Deterministic: a URL
 * either matches one known host pattern or yields nothing. The HTML is
 * untrusted data — only href/src attribute values are read, never text.
 */

/** ATS types discovery can recognise; only some have a connector (src/direct/types.ts). */
export const DETECTABLE_ATS_TYPES = [
  "greenhouse", "lever", "ashby", "smartrecruiters",
  "workday", "successfactors", "gupy", "buk", "teamtailor", "eightfold", "icims", "magneto", "phenom", "google", "tp"
] as const;
export type DetectableAtsType = (typeof DETECTABLE_ATS_TYPES)[number];

export interface AtsLink {
  atsType: DetectableAtsType;
  atsRef: string;
  /** The URL as found (trimmed), for the evidence record. */
  url: string;
}

const REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// Path segments that are a page of the ATS itself, never a company.
const NOT_A_COMPANY = new Set(["embed", "jobs", "job", "careers", "api", "www", "static", "assets", "cdn", "v1", "v0", "search"]);

function firstSegment(url: URL): string | null {
  const segment = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
  return REF.test(segment) && !NOT_A_COMPANY.has(segment.toLowerCase()) ? segment : null;
}

function subdomain(host: string, suffix: string): string | null {
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(label) && !NOT_A_COMPANY.has(label) ? label : null;
}

/** The ATS board a single URL points at, or null. */
export function atsLinkFromUrl(raw: string): AtsLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const found = (atsType: DetectableAtsType, atsRef: string | null): AtsLink | null =>
    atsRef ? { atsType, atsRef, url: raw.trim().slice(0, 500) } : null;

  if (/^(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(host)) {
    // Embed forms: /embed/job_board?for=X and /embed/job_board/js?for=X.
    if (url.pathname.startsWith("/embed/")) {
      const forRef = url.searchParams.get("for");
      return found("greenhouse", forRef && REF.test(forRef) ? forRef.toLowerCase() : null);
    }
    return found("greenhouse", firstSegment(url)?.toLowerCase() ?? null);
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") return found("lever", firstSegment(url)?.toLowerCase() ?? null);
  if (host === "jobs.ashbyhq.com") return found("ashby", firstSegment(url));
  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") return found("smartrecruiters", firstSegment(url));
  const workday = /^([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/.exec(host);
  if (workday) {
    // /{locale}/{site} or /{site}; the locale ("es", "en-US") is optional.
    const segments = url.pathname.split("/").filter(Boolean);
    const site = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(segments[0] ?? "") ? segments[1] : segments[0];
    return found("workday", site && REF.test(site) ? `${workday[1]}/${workday[2]}/${site}` : null);
  }
  if (/^career\d*\.successfactors\.(com|eu)$/.test(host)) {
    const company = url.searchParams.get("company");
    return found("successfactors", company && REF.test(company) ? company : null);
  }
  if (host === "magneto365.com" || host === "www.magneto365.com") {
    const match = /^\/co\/empresas\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})/.exec(url.pathname);
    return found("magneto", match?.[1] ?? null);
  }
  if (host === "www.tp.com" && /^\/es-co\/ubicaciones\/colombia\/carreras\/?$/.test(url.pathname)) {
    return found("tp", "colombia");
  }
  const bySubdomain: [string, DetectableAtsType][] = [
    [".gupy.io", "gupy"],
    [".buk.co", "buk"],
    [".teamtailor.com", "teamtailor"],
    [".eightfold.ai", "eightfold"]
  ];
  for (const [suffix, atsType] of bySubdomain) {
    const label = subdomain(host, suffix);
    if (label) return found(atsType, label);
  }
  const icims = /^careers-([a-z0-9-]+)\.icims\.com$/.exec(host) ?? /^([a-z0-9-]+)\.icims\.com$/.exec(host);
  if (icims && !NOT_A_COMPANY.has(icims[1])) return found("icims", icims[1]);
  return null;
}

/** href / src values of an HTML document, entity-decoded, resolved against `base`. */
export function linksInHtml(html: string, base: string): string[] {
  const links: string[] = [];
  const attribute = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const match of html.matchAll(attribute)) {
    const value = (match[1] ?? match[2] ?? "").replace(/&amp;/g, "&").trim();
    if (!value || /^(javascript|mailto|tel|data):/i.test(value)) continue;
    try {
      links.push(new URL(value, base).toString());
    } catch {
      // Not a URL: ignored.
    }
  }
  return links;
}

/** Every distinct ATS board linked from the document. */
export function atsLinksInHtml(html: string, base: string): AtsLink[] {
  const boards = new Map<string, AtsLink>();
  for (const link of linksInHtml(html, base)) {
    const ats = atsLinkFromUrl(link);
    if (ats) boards.set(`${ats.atsType}:${ats.atsRef.toLowerCase()}`, boards.get(`${ats.atsType}:${ats.atsRef.toLowerCase()}`) ?? ats);
  }
  return [...boards.values()];
}

// Link text or path of a careers page ("Trabaja con nosotros", /empleos…).
const CAREERS_HINT = /trabaj|empleo|career|carrera|vacante|talento|jobs|unete|únete/i;

/**
 * Same-site pages that look like the careers page, in document order,
 * at most `limit`. `sameSite` decides what counts as the employer's own site.
 */
export function careersPagesInHtml(html: string, base: string, sameSite: (url: URL) => boolean, limit: number): string[] {
  const pages: string[] = [];
  const anchor = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]{0,300}?)<\/a>/gi;
  for (const match of html.matchAll(anchor)) {
    const href = (match[1] ?? match[2] ?? "").replace(/&amp;/g, "&").trim();
    const label = (match[3] ?? "").replace(/<[^>]+>/g, " ");
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || !sameSite(url)) continue;
    if (!CAREERS_HINT.test(url.pathname) && !CAREERS_HINT.test(label)) continue;
    url.hash = "";
    const value = url.toString();
    if (!pages.includes(value)) pages.push(value);
    if (pages.length >= limit) break;
  }
  return pages;
}
