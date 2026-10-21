import { decodeEntities, htmlToText, isoDate, text } from "../text.js";
import type { BoardListing, HttpGet, RawAtsPosting, Workplace } from "../types.js";

/**
 * Teamtailor public RSS feed (docs/source-catalog/teamtailor.md): documented
 * by the vendor, allowed by robots.txt. `GET https://{ref}.teamtailor.com/
 * jobs.rss?per_page=100&offset=N`; without per_page it stops at 100 and looks
 * complete when it isn't. The feed has no total: complete = every page 200
 * with a valid channel, paged until a short page, no repeated id.
 *
 * `tt:city` is the configured office, not the posting's city (all 70
 * Colombian postings of one board say Bogotá, titles say Medellín…): only the
 * country is used, the city stays null.
 */

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

const WORKPLACE: Record<string, Workplace> = { onsite: "onsite", hybrid: "hybrid", remote: "remote" };

function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? text(decodeEntities(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, ""))) : null;
}

export function parseTeamtailorFeed(xml: string): { company: string | null; postings: RawAtsPosting[] } | null {
  if (!/<rss[\s>]/.test(xml) || !/<channel>/.test(xml)) return null;
  const channel = xml.slice(0, xml.search(/<item>|<\/channel>/));
  const postings: RawAtsPosting[] = [];
  for (const item of xml.split("<item>").slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("</item>")))) {
    const link = tag(item, "link");
    const id = link ? /\/jobs\/(\d{1,20})(?:-|$)/.exec(link)?.[1] : undefined;
    const title = tag(item, "title");
    if (!link || !id || !title || !/^https:\/\//.test(link)) return null;
    const countries = [...item.matchAll(/<tt:country>([\s\S]*?)<\/tt:country>/g)]
      .map((match) => text(decodeEntities(match[1])))
      .filter((value): value is string => value !== null);
    const description = tag(item, "description");
    postings.push({
      externalId: id,
      title,
      applyUrl: link,
      locationTexts: [...new Set(countries)],
      countryCodes: [...new Set(countries)],
      structuredCity: null,
      // "none" means not stated.
      workplace: WORKPLACE[(tag(item, "remoteStatus") ?? "").toLowerCase()] ?? null,
      descriptionText: description ? htmlToText(description) || null : null,
      department: tag(item, "tt:department"),
      employmentType: null,
      publishedAt: isoDate(tag(item, "pubDate")),
      validThrough: null,
      companyName: tag(channel, "title")
    });
  }
  return { company: tag(channel, "title"), postings };
}

export async function listTeamtailor(ref: string, http: HttpGet): Promise<BoardListing> {
  const postings: RawAtsPosting[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await http(`https://${ref}.teamtailor.com/jobs.rss?per_page=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, {
      accept: "application/rss+xml"
    });
    if (response.status === 404 && page === 0) return { kind: "not_found", detail: "Teamtailor respondió 404 para este tablero" };
    if (response.status !== 200) return { kind: "error", detail: `HTTP ${response.status} en la página ${page + 1}` };
    const feed = parseTeamtailorFeed(response.body);
    if (!feed) return { kind: "error", detail: `forma inesperada en la página ${page + 1}` };
    for (const posting of feed.postings) {
      // A posting published while paging shifts the offsets: a repeat means
      // the pages overlap and another may have been skipped.
      if (seen.has(posting.externalId)) return { kind: "error", detail: "el feed se movió durante el paginado: listado inconsistente" };
      seen.add(posting.externalId);
      postings.push(posting);
    }
    if (feed.postings.length < PAGE_SIZE) return { kind: "complete", boardTotal: postings.length, postings };
  }
  return { kind: "error", detail: `más de ${MAX_PAGES} páginas: listado incompleto` };
}
