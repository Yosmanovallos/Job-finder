import { decodeEntities, htmlToText } from "../text.js";
import type { BoardListing, HttpGet, RawAtsPosting } from "../types.js";
import { allowedUrl, readRobots } from "./site.js";

/**
 * Google Careers (docs/source-catalog/google.md). No public jobs API, no
 * sitemap of postings, no JSON-LD: the results page carries its data in an
 * undocumented positional block (AF_initDataCallback key 'ds:1' =
 * [jobs[], _, total, pageSize]). Google's terms forbid automated access only
 * against its robots.txt, which allows the results page but NOT its
 * paginator (`?page=`): a listing is complete only while the Colombian total
 * fits on page 1. Every field is shape-checked; anything unexpected makes
 * the listing incomplete, never a guess.
 *
 * Dates: the block holds three unlabeled timestamps and none is declared as
 * the posting date, so publishedAt stays null (the 30-day rule then counts
 * from first sight, ADR 0006 §2). ats_ref = "google" (one board).
 */

const ORIGIN = "https://www.google.com";
const RESULTS = `${ORIGIN}/about/careers/applications/jobs/results`;

/** The JSON array literal that follows `data:` in the ds:1 callback, strings respected. */
export function ds1Data(html: string): unknown {
  const at = html.indexOf("AF_initDataCallback({key: 'ds:1'");
  if (at < 0) return undefined;
  const dataAt = html.indexOf("data:", at);
  const start = html.indexOf("[", dataAt);
  if (dataAt < 0 || start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (inString) {
      if (char === "\\") index++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1)) as unknown;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Second slot of a [null, "html"] text pair. */
function htmlPair(value: unknown): string | null {
  return Array.isArray(value) ? str(value[1]) : null;
}

export function parseGoogleResults(html: string): { total: number; pageSize: number; postings: RawAtsPosting[] } | null {
  const data = ds1Data(html);
  if (!Array.isArray(data) || !Array.isArray(data[0]) || typeof data[2] !== "number" || typeof data[3] !== "number") return null;
  const postings: RawAtsPosting[] = [];
  for (const job of data[0] as unknown[]) {
    if (!Array.isArray(job)) return null;
    const id = str(job[0]);
    const title = str(job[1]);
    const locations = job[9];
    if (!id || !/^\d{6,30}$/.test(id) || !title || !Array.isArray(locations)) return null;
    const segments: { text: string; city: string | null; country: string | null }[] = [];
    for (const location of locations) {
      if (!Array.isArray(location) || !str(location[0])) return null;
      segments.push({ text: str(location[0])!, city: str(location[2]), country: str(location[5]) });
    }
    const descriptionHtml = [htmlPair(job[10]), htmlPair(job[19]), htmlPair(job[15])].filter((part): part is string => part !== null).join("\n");
    const countries = segments.map((segment) => segment.country);
    const colombian = segments.find((segment) => segment.country?.toUpperCase() === "CO");
    postings.push({
      externalId: id,
      title: decodeEntities(title),
      applyUrl: `${RESULTS}/${id}`,
      locationTexts: segments.map((segment) => segment.text),
      // Only when every location states its country (multi-country postings are evaluated per segment).
      countryCodes: countries.every((code) => code) ? [...new Set(countries as string[])] : [],
      structuredCity: colombian?.city ?? null,
      workplace: null,
      descriptionText: descriptionHtml ? htmlToText(descriptionHtml) || null : null,
      department: null,
      employmentType: null,
      publishedAt: null,
      validThrough: null,
      companyName: str(job[7])
    });
  }
  return { total: data[2] as number, pageSize: data[3] as number, postings };
}

export async function listGoogle(ref: string, http: HttpGet): Promise<BoardListing> {
  if (ref !== "google") return { kind: "error", detail: "ats_ref con formato inválido" };
  const url = `${RESULTS}?location=Colombia`;
  const robots = await readRobots(ORIGIN, http);
  if (!allowedUrl(robots, url)) return { kind: "error", detail: "robots.txt no permite la búsqueda de empleos" };
  const response = await http(url, { accept: "text/html" });
  if (response.status !== 200) return { kind: "error", detail: `HTTP ${response.status}` };
  const page = parseGoogleResults(response.body);
  if (!page) return { kind: "error", detail: "forma inesperada en la página de resultados" };
  // robots.txt forbids ?page=: more than one page can never be read completely.
  if (page.total > page.postings.length || page.total > page.pageSize) {
    return { kind: "error", detail: `${page.total} vacantes y solo se puede leer la página 1 (${page.postings.length}): listado incompleto` };
  }
  return { kind: "complete", boardTotal: page.total, postings: page.postings };
}
