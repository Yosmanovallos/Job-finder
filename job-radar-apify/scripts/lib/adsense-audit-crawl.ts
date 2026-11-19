// Crawler of the AdSense auditor (F0). GET only, bounded, paced. Collects the
// facts that scripts/lib/adsense-audit-rules.ts evaluates; HTML bodies stay
// in memory and are never written anywhere.
import { setTimeout as delay } from "node:timers/promises";
import {
  AD_MARKER,
  bareLinkLists,
  canonicalHref,
  countWords,
  hasMetaRefresh,
  hasScriptRedirect,
  htmlLang,
  jsonLd,
  links,
  mainText,
  manualAdSlots,
  metaContent,
  sitemapLocs,
  ssrJobSource,
  textSegments
} from "./adsense-audit-html.js";
import { isOriginalPath, type BrowserFact, type PageFact, type PageKind, type SiteFacts } from "./adsense-audit-rules.js";

export const LIVE_ORIGIN = "https://buscotrabajo.co";
export const GENERIC_USER_AGENT = "Mozilla/5.0 (compatible; site-audit/1.0)";
export const LIVE_DEFAULT_MAX_URLS = 40;
export const LIVE_HARD_MAX_URLS = 120;
export const LIVE_MIN_DELAY_MS = 1000;

export interface FetcherOptions {
  base: string;
  maxUrls: number;
  delayMs: number;
  userAgent: string;
  /** Live mode: only buscotrabajo.co; local mode: only loopback. */
  live: boolean;
}

export interface FetchedPage {
  url: string;
  status: number;
  headers: Headers;
  body: string;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

/** Throws on anything the auditor must never do (ADS-001 «sin escrituras»). */
export function validateFetcherOptions(options: FetcherOptions): void {
  const url = new URL(options.base);
  if (options.live) {
    if (url.origin !== LIVE_ORIGIN) throw new Error(`[adsense-audit] --live solo admite ${LIVE_ORIGIN}`);
    if (options.delayMs < LIVE_MIN_DELAY_MS) throw new Error(`[adsense-audit] la pausa mínima en --live es ${LIVE_MIN_DELAY_MS} ms`);
    if (options.maxUrls > LIVE_HARD_MAX_URLS) throw new Error(`[adsense-audit] --max-urls no puede superar ${LIVE_HARD_MAX_URLS}`);
  } else if (!isLoopback(url.hostname)) {
    throw new Error("[adsense-audit] sin --live solo se audita un servidor local (127.0.0.1/localhost)");
  }
  if (!Number.isInteger(options.maxUrls) || options.maxUrls < 1) throw new Error("[adsense-audit] --max-urls inválido");
}

export class GetFetcher {
  readonly methods = new Set<string>();
  count = 0;
  private last = 0;
  private readonly cache = new Map<string, FetchedPage>();

  constructor(private readonly options: FetcherOptions) {
    validateFetcherOptions(options);
  }

  get remaining(): number {
    return this.options.maxUrls - this.count;
  }

  get base(): string {
    return this.options.base;
  }

  /** GET with manual redirects; null once the URL budget is spent. */
  async get(pathOrUrl: string, method = "GET"): Promise<FetchedPage | null> {
    if (method !== "GET") throw new Error("[adsense-audit] el auditor solo hace peticiones GET");
    const url = new URL(pathOrUrl, this.options.base);
    if (url.origin !== new URL(this.options.base).origin) throw new Error(`[adsense-audit] fuera del sitio auditado: ${url.origin}`);
    const key = url.toString();
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.count >= this.options.maxUrls) return null;
    const wait = this.last + this.options.delayMs - Date.now();
    if (wait > 0) await delay(wait);
    this.count += 1;
    this.methods.add(method);
    try {
      const response = await fetch(key, {
        method,
        redirect: "manual",
        headers: { "User-Agent": this.options.userAgent, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
        signal: AbortSignal.timeout(20000)
      });
      const body = (response.headers.get("content-type") || "").match(/html|xml|text/) ? await response.text() : "";
      const page = { url: key, status: response.status, headers: response.headers, body: body.slice(0, 8 * 1024 * 1024) };
      this.cache.set(key, page);
      return page;
    } catch {
      const page = { url: key, status: 0, headers: new Headers(), body: "" };
      this.cache.set(key, page);
      return page;
    } finally {
      this.last = Date.now();
    }
  }
}

const MARKERS = ["data-hub-comparison", "data-guide", "data-guides-index", "data-guide-byline", "data-related-guides", "data-category-stats", "data-intent-answer"];

export function toPageFact(kind: PageKind, path: string, fetched: FetchedPage, base: string): PageFact {
  const html = fetched.body;
  const origin = new URL(base).origin;
  const robots = [metaContent(html, "robots"), fetched.headers.get("x-robots-tag")].filter(Boolean).join(", ").toLowerCase();
  const internal = new Set<string>();
  const external: { href: string; text: string }[] = [];
  for (const link of links(html)) {
    if (/^(mailto|tel|javascript):|^#/i.test(link.href)) continue;
    let target: URL;
    try {
      target = new URL(link.href, fetched.url);
    } catch {
      continue;
    }
    if (target.origin === origin || target.origin === LIVE_ORIGIN) internal.add(target.pathname);
    else if (/^https?:$/.test(target.protocol)) external.push({ href: target.toString(), text: link.text });
  }
  const text = mainText(html);
  return {
    kind,
    path,
    status: fetched.status,
    location: fetched.headers.get("location"),
    contentType: fetched.headers.get("content-type") || "",
    robots,
    canonical: canonicalHref(html),
    lang: htmlLang(html),
    adMarker: html.includes(AD_MARKER),
    manualAdSlots: manualAdSlots(html),
    rawWords: countWords(text),
    text: text.toLowerCase(),
    segments: textSegments(html),
    jsonLd: jsonLd(html),
    internalLinks: [...internal],
    externalLinks: external,
    metaRefresh: hasMetaRefresh(html),
    scriptRedirect: hasScriptRedirect(html),
    attachment: /attachment/i.test(fetched.headers.get("content-disposition") || ""),
    bareLinkLists: bareLinkLists(html).length,
    jobSource: ssrJobSource(html),
    markers: MARKERS.filter((marker) => html.includes(marker))
  };
}

export interface SamplePlan {
  /** Fixed probes: kind → path. */
  pages: [PageKind, string][];
  /** Job pages known in advance (local mode); live mode discovers them from the sitemap. */
  jobs?: { official?: string; thirdParty?: string; sibling?: string; expired?: string };
  hubSmall?: string;
  /** Cap of internal links checked for 404 (each one is a GET). */
  linkChecks: number;
  /** Cap of job URLs read from the sitemap to estimate the copied share. */
  jobSampleSize: number;
}

export const FIXED_PAGES: [PageKind, string][] = [
  ["home-co", "/"],
  ["home-ve", "/ve"],
  ["empleos", "/empleos"],
  ["hub-grande", "/empleos/bogota"],
  ["hub-cargo", "/empleos/ingeniero-civil"],
  ["empresas", "/empresas"],
  ["no-existe", "/esta-pagina-no-existe"],
  ["legal-terminos", "/legal/terminos"],
  ["legal-privacidad", "/legal/privacidad"],
  ["legal-uso-aceptable", "/legal/uso-aceptable"],
  ["legal-cookies", "/legal/cookies"],
  ["privacy", "/privacy"],
  ["about", "/about"],
  ["contact", "/contact"],
  ["metodologia", "/metodologia"],
  ["preguntas", "/preguntas"],
  ["como-funciona", "/como-funciona"],
  ["fuentes", "/fuentes"],
  ["opiniones", "/opiniones"],
  ["login", "/login"],
  ["reset-password", "/reset-password"],
  ["cuenta", "/cuenta"],
  ["dashboard", "/dashboard"],
  ["dashboard-filtrado", "/dashboard?q=analista&ciudad=bogota"],
  ["guias", "/guias"],
  ["informes", "/informes"],
  ["herramientas", "/herramientas"]
];

export async function collectFacts(fetcher: GetFetcher, plan: SamplePlan, mode: SiteFacts["mode"]): Promise<SiteFacts> {
  const base = fetcher.base;
  const pages: PageFact[] = [];
  const add = async (kind: PageKind, path: string) => {
    const fetched = await fetcher.get(path);
    if (fetched) pages.push(toPageFact(kind, path, fetched, base));
    return fetched;
  };
  const text = async (path: string) => {
    const fetched = await fetcher.get(path);
    return fetched && fetched.status === 200 ? fetched.body : null;
  };

  const robotsTxt = await text("/robots.txt");
  const adsTxt = await text("/ads.txt");
  // Every child of the sitemap index except jobs and categories is a content
  // sitemap (sitemap-pages.xml, sitemap-guides.xml, …): what F3/F4/F5 publish
  // is discovered here, never assumed.
  const sitemapIndex = sitemapLocs((await text("/sitemap.xml")) || "").map((loc) => new URL(loc).pathname);
  const contentMaps = sitemapIndex.filter((path) => !/sitemap-(jobs|categories)/.test(path));
  const sitemapPages: string[] = [];
  for (const map of contentMaps.length > 0 ? contentMaps : ["/sitemap-pages.xml"]) {
    for (const loc of sitemapLocs((await text(map)) || "")) sitemapPages.push(new URL(loc).pathname);
  }
  const sitemapCategories = sitemapLocs((await text("/sitemap-categories.xml")) || "").map((loc) => new URL(loc).pathname);

  for (const [kind, path] of plan.pages) await add(kind, path);

  // Job pages: known in local mode, discovered from the sitemap in live mode.
  const jobs = { ...plan.jobs };
  const jobSample: SiteFacts["jobSample"] = [];
  if (!jobs.official || !jobs.thirdParty) {
    const jobMap = sitemapIndex.find((path) => /sitemap-jobs/.test(path));
    const jobUrls = jobMap ? sitemapLocs((await text(jobMap)) || "").map((loc) => new URL(loc).pathname) : [];
    for (const path of jobUrls.slice(0, plan.jobSampleSize)) {
      const fetched = await fetcher.get(path);
      if (!fetched || fetched.status !== 200) continue;
      const fact = toPageFact("vacante-terceros", path, fetched, base);
      jobSample.push({ path, source: fact.jobSource, indexable: !/noindex/.test(fact.robots) });
      if (fact.jobSource === "Portal oficial") jobs.official ??= path;
      else if (!jobs.thirdParty) jobs.thirdParty = path;
      else jobs.sibling ??= path;
    }
  }
  if (jobs.official) await add("vacante-oficial", jobs.official);
  if (jobs.thirdParty) await add("vacante-terceros", jobs.thirdParty);
  if (jobs.sibling) await add("vacante-terceros-hermana", jobs.sibling);
  if (jobs.expired) await add("vacante-vencida", jobs.expired);
  if (plan.hubSmall) await add("hub-pequeno", plan.hubSmall);
  for (const page of pages) {
    if (page.kind.startsWith("vacante-") && page.kind !== "vacante-vencida" && page.status === 200 && !jobSample.some((job) => job.path === page.path)) {
      jobSample.push({ path: page.path, source: page.jobSource, indexable: !/noindex/.test(page.robots) });
    }
  }

  // Original layer: every sitemap page of an original family (F3/F5 add to it).
  const originalPages: SiteFacts["originalPages"] = [];
  for (const path of [...new Set(sitemapPages)].filter(isOriginalPath)) {
    const known = pages.find((page) => page.path === path);
    const fact = known ?? (await (async () => {
      const fetched = await fetcher.get(path);
      return fetched ? toPageFact("original", path, fetched, base) : undefined;
    })());
    if (fact && fact.status === 200 && !/noindex/.test(fact.robots)) originalPages.push({ path, words: fact.rawWords });
  }

  // Internal links of the sample: each target fetched once, within budget.
  const brokenLinks: SiteFacts["brokenLinks"] = [];
  const targets = new Map<string, string>();
  for (const page of pages.filter((entry) => entry.status === 200)) {
    for (const href of page.internalLinks) if (!targets.has(href)) targets.set(href, page.path);
  }
  let checked = 0;
  for (const [href, from] of targets) {
    if (checked >= plan.linkChecks) break;
    if (/^\/(api|auth)\//.test(href)) continue;
    const fetched = await fetcher.get(href);
    if (!fetched) break;
    checked += 1;
    if (fetched.status === 404 || fetched.status === 410 || fetched.status >= 500 || fetched.status === 0) {
      brokenLinks.push({ from, to: href, status: fetched.status });
    }
  }

  const home = await fetcher.get("/");
  return {
    mode,
    base,
    pages,
    browser: null,
    robotsTxt,
    adsTxt,
    adsenseAccount: home ? metaContent(home.body, "google-adsense-account") : null,
    sitemapPages,
    sitemapCategories,
    originalPages,
    jobSample,
    brokenLinks,
    checkedLinks: checked,
    requests: fetcher.count,
    methods: [...fetcher.methods]
  };
}

/** Kinds whose server text is compared with the hydrated DOM (SP-1, SP-5) and ads observed. */
export const BROWSER_KINDS: PageKind[] = [
  "home-co",
  "hub-grande",
  "hub-pequeno",
  "vacante-oficial",
  "vacante-terceros",
  "vacante-vencida",
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
  "fuentes",
  "opiniones",
  "login",
  "cuenta",
  "dashboard",
  "no-existe"
];

interface ProbeResult {
  missing: string[];
  serverWords: number;
  missingWords: string[];
  hidden: string[];
  footer: string[];
  overlay: number;
  history: number;
  report: boolean;
  words: number;
  extraWords: string[];
}

/**
 * Runs in the page: parity, hidden text, footer, overlays, report link,
 * hydrated words. String.raw keeps the regex backslashes for the page.
 * Comparison ignores whitespace: textContent glues adjacent elements
 * ("92 vacantesBuscar") where the raw-HTML reader put a space.
 */
const BROWSER_PROBE = String.raw`function (segments) {
  var squash = function (value) { return value.replace(/\s+/g, "").toLowerCase(); };
  // Text nodes joined with spaces: textContent glues adjacent elements
  // ("fuentesFuentes"), which would merge words.
  var textOf = function (node) {
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    var parts = [];
    while (walker.nextNode()) {
      var parent = walker.currentNode.parentNode;
      if (parent && /^(SCRIPT|STYLE|NOSCRIPT)$/.test(parent.nodeName)) continue;
      parts.push(walker.currentNode.nodeValue);
    }
    return parts.join(" ");
  };
  var app = document.querySelector("#app") || document.body;
  var all = squash(textOf(app));
  var wanted = segments.map(squash);
  var missing = segments.filter(function (segment, index) { return all.indexOf(wanted[index]) < 0; });
  // Word level: distinct words of the server text absent from the hydrated text.
  var tokens = function (value) { return value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []; };
  var present = {};
  tokens(textOf(app)).forEach(function (word) { present[word] = true; });
  var serverWords = {};
  segments.forEach(function (segment) { tokens(segment).forEach(function (word) { serverWords[word] = true; }); });
  var serverList = Object.keys(serverWords);
  var missingWords = serverList.filter(function (word) { return !present[word]; });
  var hidden = [];
  app.querySelectorAll("p, li, h1, h2, h3, h4, dd, dt, td").forEach(function (element) {
    var raw = textOf(element).replace(/\s+/g, " ").trim();
    if (raw.split(" ").length < 4 || wanted.indexOf(squash(raw)) < 0) return;
    if (element.closest("details")) return; // accordions are allowed by the policy
    var style = getComputedStyle(element);
    var rect = element.getBoundingClientRect();
    var reason = element.getClientRects().length === 0 ? "display" :
      style.visibility === "hidden" ? "visibility" :
      parseFloat(style.fontSize) < 2 ? "font-size" :
      (rect.right < -500 || rect.bottom < -500 || rect.left > document.documentElement.scrollWidth + 500) ? "fuera de pantalla" : null;
    if (reason) hidden.push(reason + ": " + raw);
  });
  var footer = Array.prototype.map.call(document.querySelectorAll("footer a[href]"), function (link) { return link.getAttribute("href") || ""; });
  var overlay = 0;
  document.querySelectorAll("body *").forEach(function (element) {
    var style = getComputedStyle(element);
    if (style.position !== "fixed" || style.display === "none" || style.visibility === "hidden") return;
    var rect = element.getBoundingClientRect();
    var area = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) *
      Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    overlay = Math.max(overlay, area / (innerWidth * innerHeight));
  });
  var report = Array.prototype.some.call(document.querySelectorAll("a"), function (link) { return /reportar esta vacante/i.test(link.textContent || ""); });
  var clone = app.cloneNode(true);
  clone.querySelectorAll("header, footer, nav, script, style, button, svg").forEach(function (node) { node.remove(); });
  var words = textOf(clone).split(/\s+/).filter(function (word) { return /[\p{L}\p{N}]/u.test(word); }).length;
  // Reverse direction (TX-1): words the hydrated content adds to the server text.
  var extraWords = Object.keys(tokens(textOf(clone)).reduce(function (set, word) { if (!serverWords[word]) set[word] = true; return set; }, {}));
  return { missing: missing, serverWords: serverList.length, missingWords: missingWords, hidden: hidden, footer: footer, overlay: overlay, history: history.length, report: report, words: words, extraWords: extraWords };
}`;

/**
 * Hydration parity, hidden text, ad requests, footer and overlays in Chromium.
 * Only same-origin requests reach the server; Google requests are recorded and
 * aborted, so nothing is ever loaded from (or counted by) AdSense.
 */
export async function observeInBrowser(facts: SiteFacts, maxPages = BROWSER_KINDS.length): Promise<BrowserFact[]> {
  const { chromium } = await import("playwright");
  const origin = new URL(facts.base).origin;
  const browser = await chromium.launch({ headless: true });
  const observed: BrowserFact[] = [];
  try {
    const sample = facts.pages.filter((page) => BROWSER_KINDS.includes(page.kind) && page.contentType.includes("html")).slice(0, maxPages);
    for (const page of sample) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: "block" });
      let adsRequested = false;
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (/googlesyndication\.com$|doubleclick\.net$/.test(url.hostname) && /adsbygoogle/.test(url.pathname + url.search)) adsRequested = true;
        // Read-only: only GET/HEAD to the audited origin ever leaves the browser.
        const method = route.request().method();
        return url.origin === origin && (method === "GET" || method === "HEAD") ? route.continue() : route.abort();
      });
      const tab = await context.newPage();
      let pageErrors = 0;
      tab.on("pageerror", () => {
        pageErrors += 1;
      });
      try {
        await tab.goto(`${origin}${page.path}`, { waitUntil: "networkidle", timeout: 20000 });
        // The deferred loader fires on the first interaction (or after 4 s).
        await tab.evaluate(() => window.dispatchEvent(new Event("pointerdown")));
        await tab.waitForTimeout(400);
        // A string, not a function: tsx would wrap named inner functions in
        // helpers (__name) that do not exist in the page.
        const probe = `(${BROWSER_PROBE})(${JSON.stringify(page.segments)})`;
        const result = (await tab.evaluate(probe)) as ProbeResult;
        // Responsive layouts show different blocks per width: only text hidden
        // on desktop AND on a phone-sized viewport counts as hidden (SP-5).
        if (result.hidden.length > 0) {
          await tab.setViewportSize({ width: 390, height: 844 });
          await tab.waitForTimeout(200);
          const phone = (await tab.evaluate(probe)) as ProbeResult;
          const text = (entry: string) => entry.slice(entry.indexOf(": ") + 2);
          const hiddenOnPhone = new Set(phone.hidden.map(text));
          result.hidden = result.hidden.filter((entry) => hiddenOnPhone.has(text(entry)));
        }
        observed.push({
          path: page.path,
          kind: page.kind,
          adsRequested,
          segments: page.segments.length,
          missingSegments: result.missing,
          serverWords: result.serverWords,
          missingWords: result.missingWords,
          hiddenSegments: [...new Set(result.hidden)],
          footerLinks: [...new Set(result.footer.filter((href) => href.startsWith("/")))],
          overlayShare: Number(result.overlay.toFixed(3)),
          historyLength: result.history,
          hasReportLink: result.report,
          hydratedWords: result.words,
          hydratedOnlyWords: result.extraWords,
          pageErrors,
          error: null
        });
      } catch (error) {
        observed.push({
          path: page.path,
          kind: page.kind,
          adsRequested,
          segments: page.segments.length,
          missingSegments: page.segments,
          serverWords: 0,
          missingWords: [],
          hiddenSegments: [],
          footerLinks: [],
          overlayShare: 0,
          historyLength: 0,
          hasReportLink: false,
          hydratedWords: 0,
          hydratedOnlyWords: [],
          pageErrors: pageErrors + 1,
          error: (error instanceof Error ? error.message : "error").split(/\r?\n/)[0].slice(0, 160)
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return observed;
}
