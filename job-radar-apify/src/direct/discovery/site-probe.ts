import { atsLinkFromUrl, atsLinksInHtml, careersPagesInHtml, linksInHtml, type AtsLink } from "./ats-links.js";
import { ALLOW_ALL, DISALLOW_ALL, isAllowed, parseRobots, type RobotsPolicy } from "./robots.js";
import type { SiteGet, SiteResponse } from "./html-http.js";

/**
 * Reads an employer's own site for links to its ATS
 * (docs/source-catalog/site-probe-ats-links.md): robots.txt first, then the
 * home page and at most MAX_CAREERS_PAGES same-site careers pages. Links to
 * other domains are never followed — only classified. A block (403, 429,
 * challenge) is recorded, never worked around. Never throws.
 */

const MAX_CAREERS_PAGES = 3;
const MAX_REDIRECTS = 5;
// Pause between two requests to the same host, raised to the robots
// Crawl-delay when the site declares one. A longer Crawl-delay skips the site.
const MIN_DELAY_MS = 1_000;
const MAX_CRAWL_DELAY_SECONDS = 30;
// Fallback careers paths, tried only when the home page links fewer pages.
const FALLBACK_PATHS = ["/trabaja-con-nosotros", "/trabaje-con-nosotros", "/careers", "/empleos"];

export interface FoundAtsLink extends AtsLink {
  pageUrl: string;
}

export type SiteProbeResult =
  | { status: "robots_blocked"; detail: string }
  | { status: "blocked"; detail: string }
  | { status: "unreachable"; detail: string }
  | { status: "redirect_offsite"; detail: string }
  | {
      status: "done";
      links: FoundAtsLink[];
      pagesRead: string[];
      /** Other-domain careers hosts named by careers pages (no ATS pattern), for review. */
      offsiteCareersHosts: string[];
    };

const SECOND_LEVEL = new Set(["com", "org", "edu", "gov", "gob", "net", "co", "mil", "ac"]);

/** eTLD+1 approximation: "www.empresa.com.co" -> "empresa.com.co". */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const take = SECOND_LEVEL.has(labels[labels.length - 2]) && labels[labels.length - 1].length === 2 ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Same site: same registrable domain, or the same brand under another TLD (rappi.com -> rappi.com.co). */
export function isSameSite(host: string, domain: string): boolean {
  const a = registrableDomain(host);
  const b = registrableDomain(domain);
  return a === b || a.split(".")[0] === b.split(".")[0];
}

function isBlocked(response: SiteResponse): boolean {
  if ([401, 403, 429].includes(response.status)) return true;
  if (response.headers["cf-mitigated"] === "challenge") return true;
  return response.status === 503 && /just a moment|cf-chl|captcha/i.test(response.body.slice(0, 5_000));
}

function isHtml(response: SiteResponse): boolean {
  return /text\/html|application\/xhtml/i.test(response.headers["content-type"] ?? "text/html");
}

export interface SiteProbeDeps {
  get: SiteGet;
  sleep(ms: number): Promise<void>;
}

export async function probeSite(domain: string, deps: SiteProbeDeps): Promise<SiteProbeResult> {
  const robotsByHost = new Map<string, RobotsPolicy>();
  const blockedHosts = new Set<string>();
  const lastRequestAt = new Map<string, number>();
  let delayMs = MIN_DELAY_MS;

  async function politeGet(url: URL): Promise<SiteResponse> {
    const last = lastRequestAt.get(url.host);
    if (last !== undefined) {
      const wait = last + delayMs - Date.now();
      if (wait > 0) await deps.sleep(wait);
    }
    lastRequestAt.set(url.host, Date.now());
    return deps.get(url.toString());
  }

  async function robotsFor(url: URL): Promise<RobotsPolicy> {
    const cached = robotsByHost.get(url.host);
    if (cached) return cached;
    let policy: RobotsPolicy;
    try {
      let target = new URL("/robots.txt", url);
      let response = await politeGet(target);
      for (let hop = 0; hop < MAX_REDIRECTS && response.status >= 300 && response.status < 400 && response.headers.location; hop++) {
        target = new URL(response.headers.location, target);
        response = await politeGet(target);
      }
      if (response.status === 200) policy = parseRobots(response.body);
      else if (response.status === 401 || response.status === 403) {
        // A WAF answering robots.txt with 403 blocks the bot: not transient.
        blockedHosts.add(url.host);
        policy = DISALLOW_ALL;
      }
      else if (response.status >= 400 && response.status < 500 && response.status !== 429) policy = ALLOW_ALL;
      else policy = DISALLOW_ALL;
    } catch {
      policy = DISALLOW_ALL;
    }
    robotsByHost.set(url.host, policy);
    return policy;
  }

  type Fetched =
    | { kind: "page"; url: URL; response: SiteResponse }
    | { kind: "ats"; link: AtsLink }
    | { kind: "stop"; result: Exclude<SiteProbeResult, { status: "done" }> }
    | { kind: "skip" };

  /** One page with its same-site redirects, each hop checked against robots. */
  async function fetchPage(start: URL, isHome = false): Promise<Fetched> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const policy = await robotsFor(url);
      if (policy.kind === "none") {
        return blockedHosts.has(url.host)
          ? { kind: "stop", result: { status: "blocked", detail: `robots.txt de ${url.host} respondió 401/403` } }
          : { kind: "stop", result: { status: "unreachable", detail: `robots.txt de ${url.host} no disponible` } };
      }
      if (!isAllowed(policy, url.pathname + url.search)) return { kind: "skip" };
      if ((policy.crawlDelaySeconds ?? 0) > MAX_CRAWL_DELAY_SECONDS) {
        return { kind: "stop", result: { status: "robots_blocked", detail: `Crawl-delay ${policy.crawlDelaySeconds}s` } };
      }
      delayMs = Math.max(MIN_DELAY_MS, (policy.crawlDelaySeconds ?? 0) * 1000);
      const response = await politeGet(url);
      if (isBlocked(response)) return { kind: "stop", result: { status: "blocked", detail: `HTTP ${response.status} en ${url.host}` } };
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        const next = new URL(response.headers.location, url);
        const ats = atsLinkFromUrl(next.toString());
        if (ats) return { kind: "ats", link: ats };
        if (!/^https?:$/.test(next.protocol) || !isSameSite(next.hostname, domain)) {
          return isHome
            ? { kind: "stop", result: { status: "redirect_offsite", detail: `la home redirige a ${next.host}` } }
            : { kind: "skip" };
        }
        url = next;
        continue;
      }
      if (response.status !== 200 || !isHtml(response)) return { kind: "skip" };
      return { kind: "page", url, response };
    }
    return { kind: "skip" };
  }

  try {
    const home = new URL(`https://${domain}/`);
    const homePolicy = await robotsFor(home);
    if (homePolicy.kind === "none") {
      return blockedHosts.has(home.host)
        ? { status: "blocked", detail: "robots.txt respondió 401/403" }
        : { status: "unreachable", detail: "robots.txt no disponible (5xx o red)" };
    }
    if (!isAllowed(homePolicy, "/")) return { status: "robots_blocked", detail: "robots.txt prohíbe la home" };

    const links = new Map<string, FoundAtsLink>();
    const pagesRead: string[] = [];
    const offsite = new Set<string>();
    const addLinks = (found: AtsLink[], pageUrl: string) => {
      for (const link of found) {
        const key = `${link.atsType}:${link.atsRef.toLowerCase()}`;
        if (!links.has(key)) links.set(key, { ...link, pageUrl });
      }
    };

    const first = await fetchPage(home, true);
    if (first.kind === "stop") return first.result;
    if (first.kind === "ats") addLinks([first.link], home.toString());
    if (first.kind !== "page") {
      return { status: "done", links: [...links.values()], pagesRead, offsiteCareersHosts: [] };
    }
    pagesRead.push(first.url.toString());
    const html = first.response.body;
    addLinks(atsLinksInHtml(html, first.url.toString()), first.url.toString());

    const sameSite = (url: URL) => isSameSite(url.hostname, domain);
    const careers = careersPagesInHtml(html, first.url.toString(), sameSite, MAX_CAREERS_PAGES);
    for (const path of FALLBACK_PATHS) {
      if (careers.length >= MAX_CAREERS_PAGES) break;
      const fallback = new URL(path, first.url).toString();
      if (!careers.includes(fallback)) careers.push(fallback);
    }

    for (const page of careers.slice(0, MAX_CAREERS_PAGES)) {
      const fetched = await fetchPage(new URL(page));
      if (fetched.kind === "stop") {
        // A block after the home page keeps what was already found.
        if (fetched.result.status === "blocked") break;
        continue;
      }
      if (fetched.kind === "ats") {
        addLinks([fetched.link], page);
        continue;
      }
      if (fetched.kind !== "page") continue;
      const pageUrl = fetched.url.toString();
      pagesRead.push(pageUrl);
      addLinks(atsLinksInHtml(fetched.response.body, pageUrl), pageUrl);
      for (const link of linksInHtml(fetched.response.body, pageUrl)) {
        try {
          const url = new URL(link);
          if (!sameSite(url) && !atsLinkFromUrl(link) && /^(empleo|empleos|careers?|jobs|trabaj|talento|vacantes)/i.test(url.hostname)) {
            offsite.add(url.hostname.toLowerCase());
          }
        } catch {
          // Not a URL: ignored.
        }
      }
    }
    return { status: "done", links: [...links.values()], pagesRead, offsiteCareersHosts: [...offsite].slice(0, 5) };
  } catch (error) {
    return { status: "unreachable", detail: (error instanceof Error ? error.message : String(error)).slice(0, 200) };
  }
}
