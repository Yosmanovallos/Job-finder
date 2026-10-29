import { decodeEntities, htmlToText, text } from "../text.js";
import type { BoardListing, HttpGet, ListOptions, RawAtsPosting } from "../types.js";
import { allowedUrl, innerHtmlAt, readRobots, splitSiteRef } from "./site.js";

/**
 * SAP SuccessFactors Recruiting Marketing career sites (RMK / Career Site
 * Builder), docs/source-catalog/successfactors.md. There is no public JSON
 * API: the site's own job search (`/search/`, allowed by its robots.txt)
 * lists title, requisition id, department, location ("COL, CO") and usually
 * a date, with the total ("de 43") that proves the listing complete. The
 * posting page (microdata, not JSON-LD) adds the description, the exact
 * datePosted and validThrough — read only for new Colombian postings.
 *
 * ats_ref = host plus the site segment when the host serves several brands
 * (`empleo.grupobancolombia.com/bancolombia`, `jobs.avianca.com`).
 */

const MAX_PAGES = 40;
// Above this many postings the board is global (EY: 8,944): read only the
// site's own Colombia search instead of paging the world.
const MAX_FULL_LISTING = 400;

const MONTHS: Record<string, number> = {
  ene: 0, jan: 0, feb: 1, mar: 2, abr: 3, apr: 3, may: 4, jun: 5, jul: 6, ago: 7, aug: 7,
  sep: 8, sept: 8, oct: 9, nov: 10, dic: 11, dec: 11
};

/** "16 oct 2026", "24 sept 2026", "Oct 16, 2026" → ISO at 00:00 UTC; null otherwise. */
export function parseListingDate(value: string | null): string | null {
  if (!value) return null;
  const folded = value.trim().toLowerCase().replace(/\./g, "");
  const dayFirst = /^(\d{1,2}) ([a-z]{3,4})[a-z]* (\d{4})$/.exec(folded);
  const monthFirst = /^([a-z]{3,4})[a-z]* (\d{1,2}),? (\d{4})$/.exec(folded);
  const [day, month, year] = dayFirst
    ? [Number(dayFirst[1]), MONTHS[dayFirst[2]] ?? MONTHS[dayFirst[2].slice(0, 3)], Number(dayFirst[3])]
    : monthFirst
      ? [Number(monthFirst[2]), MONTHS[monthFirst[1]] ?? MONTHS[monthFirst[1].slice(0, 3)], Number(monthFirst[3])]
      : [NaN, undefined, NaN];
  if (month === undefined || !(day >= 1 && day <= 31) || !(year >= 2000)) return null;
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCDate() === day ? date.toISOString() : null;
}

/** Java Date.toString as RMK writes it: "Fri Oct 16 00:00:00 UTC 2026". */
export function parseJavaDate(value: string | null): string | null {
  const match = value ? /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) UTC (\d{4})$/.exec(value.trim()) : null;
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (month === undefined) return null;
  const date = new Date(Date.UTC(Number(match[6]), month, Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Last two-letter upper-case token of "Bogotá D.C., Bogotá D.C., CO, 110111" → "CO". */
export function countryFromLocation(location: string | null): string | null {
  if (!location) return null;
  const parts = location.split(",").map((part) => part.trim());
  for (let index = parts.length - 1; index >= 0; index--) if (/^[A-Z]{2}$/.test(parts[index])) return parts[index];
  return null;
}

/** "Cali, VAC, CO" → "Cali"; "COL, CO" or "BOG, CO" (codes, not names) → null. */
function cityFromLocation(location: string | null): string | null {
  const first = location?.split(",")[0]?.trim() ?? "";
  return /\p{Ll}/u.test(first) ? first : null;
}

interface SearchRow {
  id: string;
  href: string;
  title: string;
  location: string | null;
  date: string | null;
  department: string | null;
}

function firstSpan(html: string, className: string): string | null {
  const match = new RegExp(`<span class="${className}"[^>]*>([\\s\\S]*?)</span>`).exec(html);
  if (!match) return null;
  return text(decodeEntities(match[1].replace(/<small[\s\S]*?<\/small>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " "));
}

export function parseSearchPage(html: string): { from: number; to: number; total: number; rows: SearchRow[] } | null {
  // Newer RMK sites render job tiles instead of the classic data-row table.
  // Never interpret an unfamiliar non-empty listing as zero: that would
  // eventually close every previously imported posting on the board.
  if (/<ul id="job-tile-list"/.test(html)) {
    const label = /id="tile-search-results-label"[^>]*>\s*(?:Showing\s+([\d,.]+)\s+to\s+([\d,.]+)\s+of\s+([\d,.]+)|Mostrando\s+([\d,.]+)\s+a\s+([\d,.]+)\s+de\s+([\d,.]+))/i.exec(html);
    if (!label) return null;
    const number = (value: string) => Number(value.replace(/[.,]/g, ""));
    const from = number(label[1] ?? label[4]);
    const shown = number(label[2] ?? label[5]);
    const total = number(label[3] ?? label[6]);
    const rows: SearchRow[] = [];
    for (const chunk of html.split(/<li class="job-tile\b/).slice(1)) {
      const tile = chunk.split("</li>", 1)[0];
      const link = /\bdata-url="([^"]*\/job\/[^"]*\/(\d{4,20})\/)"/.exec(tile);
      const title = /<a\b[^>]*\bclass="[^"]*\bjobTitle-link\b[^"]*"[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(tile);
      if (!link || !title || decodeEntities(link[1]) !== decodeEntities(title[1])) return null;
      const id = link[2];
      const titleText = text(decodeEntities(title[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " "));
      if (!titleText) return null;
      const field = (name: string): string | null => {
        const match = new RegExp(`id="job-${id}-desktop-section-${name}-value"[^>]*>([\\s\\S]*?)<\\/div>`).exec(tile);
        return match ? text(decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ")) : null;
      };
      rows.push({
        id,
        href: decodeEntities(link[1]),
        title: titleText,
        location: field("multilocation") ?? field("location"),
        date: field("date"),
        department: field("department")
      });
    }
    if (![from, shown, total].every(Number.isInteger)) return null;
    // Some templates print the page's row count where the last row belongs
    // ("Showing 11 to 10 of 351", Mota-Engil). Either reading must match the
    // tiles actually rendered; `to` is always returned as the last row.
    const to = total === 0 ? 0 : rows.length === shown - from + 1 ? shown : rows.length === shown && shown < from ? from + shown - 1 : -1;
    if (to < 0 || (total === 0 && rows.length !== 0) || to > total) return null;
    return { from, to, total, rows };
  }
  const rows: SearchRow[] = [];
  for (const chunk of html.split(/<tr class="data-row"/).slice(1)) {
    const link = /<a href="([^"]*\/job\/[^"]*\/(\d{4,20})\/)"[^>]*class="jobTitle-link"[^>]*>([\s\S]*?)<\/a>/.exec(chunk)
      ?? /<a class="jobTitle-link" href="([^"]*\/job\/[^"]*\/(\d{4,20})\/)"[^>]*>([\s\S]*?)<\/a>/.exec(chunk);
    if (!link) return null;
    rows.push({
      id: link[2],
      href: decodeEntities(link[1]),
      title: decodeEntities(link[3].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim(),
      location: firstSpan(chunk, "jobLocation"),
      date: firstSpan(chunk, "jobDate"),
      department: firstSpan(chunk, "jobDepartment")
    });
  }
  const label = /(?:Resultados|Results)\s*<b>\s*([\d.,]+)\s*[–-]\s*([\d.,]+)\s*<\/b>\s*(?:de|of)\s*<b>\s*([\d.,]+)\s*<\/b>/i.exec(html);
  const number = (value: string) => Number(value.replace(/[.,]/g, ""));
  if (rows.length === 0 && /jobTitle-link/.test(html)) return null;
  if (!label) return rows.length === 0 ? { from: 0, to: 0, total: 0, rows } : null;
  return { from: number(label[1]), to: number(label[2]), total: number(label[3]), rows };
}

export interface PostingDetail {
  publishedAt: string | null;
  validThrough: string | null;
  country: string | null;
  descriptionText: string | null;
}

export function parsePostingPage(html: string): PostingDetail | null {
  if (!/itemtype="https?:\/\/schema\.org\/JobPosting"/.test(html)) return null;
  const meta: Record<string, string> = {};
  for (const match of html.matchAll(/<meta itemprop="(\w+)" content="([^"]*)"/g)) meta[match[1]] ??= decodeEntities(match[2]);
  const descriptionAt = html.search(/itemprop="description"/);
  let descriptionText: string | null = null;
  if (descriptionAt >= 0) {
    const open = html.lastIndexOf("<", descriptionAt);
    const tag = /^<(\w+)/.exec(html.slice(open))?.[1];
    const inner = tag ? innerHtmlAt(html, open, tag) : null;
    descriptionText = inner ? htmlToText(inner) || null : null;
  }
  const country = /^[A-Za-z]{2}$/.test(meta.addressCountry ?? "") ? meta.addressCountry.toUpperCase() : countryFromLocation(meta.streetAddress ?? null);
  return { publishedAt: parseJavaDate(meta.datePosted ?? null), validThrough: parseJavaDate(meta.validThrough ?? null), country, descriptionText };
}

function searchUrl(origin: string, sitePath: string, startrow: number, colombiaOnly: boolean): string {
  return `${origin}${sitePath}/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=${startrow}${colombiaOnly ? "&locationsearch=Colombia" : ""}`;
}

async function readSearch(origin: string, sitePath: string, colombiaOnly: boolean, http: HttpGet): Promise<{ total: number; rows: SearchRow[] } | { error: string }> {
  const rows: SearchRow[] = [];
  let total = 0;
  for (let page = 0, start = 0; page < MAX_PAGES; page++) {
    const response = await http(searchUrl(origin, sitePath, start, colombiaOnly), { accept: "text/html" });
    if (response.status !== 200) return { error: `HTTP ${response.status} en la página ${page + 1}` };
    const parsed = parseSearchPage(response.body);
    if (!parsed) return { error: `forma inesperada en la página ${page + 1}` };
    if (page === 0 && !colombiaOnly && parsed.total > MAX_FULL_LISTING) return readSearch(origin, sitePath, true, http);
    // Tiles without any location (Mota-Engil: 351 worldwide) would cost one
    // posting page per row to find the Colombian ones; the site's own
    // Colombia search narrows them first.
    if (page === 0 && !colombiaOnly && parsed.rows.length > 0 && parsed.rows.every((row) => row.location === null)) {
      return readSearch(origin, sitePath, true, http);
    }
    if (page > 0 && parsed.total !== total) return { error: "el total cambió entre páginas: listado inconsistente" };
    total = parsed.total;
    rows.push(...parsed.rows);
    if (parsed.rows.length === 0 || parsed.to >= total) break;
    start = parsed.to;
  }
  if (rows.length !== total) return { error: `se leyeron ${rows.length} de ${total} vacantes: listado incompleto` };
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return { error: "ids repetidos en el listado" };
  return { total, rows };
}

export async function listSuccessFactors(ref: string, http: HttpGet, options: ListOptions): Promise<BoardListing> {
  const { origin, sitePath } = splitSiteRef(ref);
  const robots = await readRobots(origin, http);
  if (!allowedUrl(robots, searchUrl(origin, sitePath, 0, false))) return { kind: "error", detail: "robots.txt no permite /search/" };

  const search = await readSearch(origin, sitePath, false, http);
  if ("error" in search) return { kind: "error", detail: search.error };

  const known = options.knownIds ?? new Set<string>();
  let budget = options.detailBudget ?? 0;
  let deferred = 0;
  const postings: RawAtsPosting[] = [];
  for (const row of search.rows) {
    const applyUrl = new URL(row.href, origin);
    if (applyUrl.origin !== origin) continue;
    const listedCountry = countryFromLocation(row.location);
    const base: RawAtsPosting = {
      externalId: row.id,
      title: row.title,
      applyUrl: applyUrl.toString(),
      locationTexts: row.location ? [row.location] : [],
      countryCodes: listedCountry ? [listedCountry] : [],
      structuredCity: cityFromLocation(row.location),
      workplace: null,
      descriptionText: null,
      department: row.department,
      employmentType: null,
      publishedAt: parseListingDate(row.date),
      validThrough: null,
      companyName: null,
      partial: true
    };
    // Detail only for new postings that may be Colombian; everything else
    // goes out as listed (the Colombia filter drops the rest).
    // A listing date already past the 30-day window needs no page either.
    const stale = base.publishedAt !== null && Date.now() - Date.parse(base.publishedAt) > 30 * 86_400_000;
    if (known.has(row.id) || stale || (listedCountry !== null && listedCountry !== "CO")) {
      postings.push(base);
      continue;
    }
    if (budget <= 0 || !allowedUrl(robots, applyUrl.toString())) {
      deferred++;
      continue;
    }
    budget--;
    const page = await http(applyUrl.toString(), { accept: "text/html" }).catch(() => null);
    const detail = page?.status === 200 ? parsePostingPage(page.body) : null;
    if (!detail) {
      deferred++;
      continue;
    }
    postings.push({
      ...base,
      countryCodes: detail.country ? [detail.country] : base.countryCodes,
      descriptionText: detail.descriptionText,
      publishedAt: detail.publishedAt ?? base.publishedAt,
      validThrough: detail.validThrough,
      partial: false
    });
  }
  return { kind: "complete", boardTotal: search.total, postings, deferred };
}
