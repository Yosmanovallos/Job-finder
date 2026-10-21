import { z } from "zod";
import { decodeEntities, htmlToText, isoDate, safeJson, text } from "../text.js";
import type { BoardListing, HttpGet, ListOptions, RawAtsPosting } from "../types.js";
import { allowedUrl, readRobots } from "./site.js";
import { flightStream, objectAfter } from "../../lib/next-flight.js";

/**
 * A company's own Magneto page as its official portal — owner decision
 * (2026-10-20): only when the company's OWN site links to
 * magneto365.com/co/empresas/{slug} (discovery's site probe). Magneto's
 * other vacancies stay a job board, as today. docs/source-catalog/
 * magneto-official.md.
 *
 * No public API: the page `/co/empresas/{slug}/empleos` (allowed by
 * robots.txt; every URL with "?" is not) carries the search in its Next.js
 * flight data. The server returns only the first 20 rows and ignores the
 * paginator, so a listing is complete ONLY when every count agrees: rows ==
 * totalRows == totalHits == the company_show_slug facet == the page's
 * ItemList. A bigger company is reported as incomplete — nothing is stored
 * or closed for it until Magneto offers a feed.
 */

export const MAGNETO_REF = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const ORIGIN = "https://www.magneto365.com";

const Row = z
  .object({
    id: z.number(),
    title: z.string(),
    jobSlug: z.string(),
    status: z.string().nullable().optional(),
    cities: z.array(z.string()).nullable().optional(),
    countryIds: z.array(z.number()).nullable().optional(),
    publishDate: z.string().nullable().optional(),
    expirationDate: z.string().nullable().optional(),
    isRemote: z.boolean().nullable().optional(),
    companyName: z.string().nullable().optional(),
    companySlug: z.string().nullable().optional(),
    contractOrder: z.object({ name: z.string().nullable().optional() }).partial().nullable().optional(),
    confidential: z.boolean().nullable().optional()
  })
  .passthrough();

const Search = z.object({
  totalRows: z.number(),
  totalHits: z.number(),
  counters: z.array(z.object({ field: z.string(), counts: z.array(z.object({ id: z.unknown(), total: z.number() })) })).optional(),
  rows: z.array(Row)
});

/** Magneto's country id for Colombia (its own config: {id: 47, country: "Colombia"}). */
const COLOMBIA_ID = 47;

export { flightStream, objectAfter };

function itemListLength(html: string): number | null {
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    const data = safeJson(match[1]) as { "@type"?: unknown; itemListElement?: unknown } | undefined;
    if (data?.["@type"] === "ItemList" && Array.isArray(data.itemListElement)) return data.itemListElement.length;
  }
  return null;
}

export type MagnetoPage = { total: number; rows: z.infer<typeof Row>[] } | { error: string };

/** Reads one company listing page; anything short of all counts agreeing is an error. */
export function parseCompanyPage(html: string, slug: string): MagnetoPage {
  const stream = flightStream(html);
  const search = Search.safeParse(objectAfter(stream, "searchResponse"));
  if (!search.success) return { error: "no se halló searchResponse en la página" };
  const filters = objectAfter(stream, "filtersApplied") as { filters?: { company_show_slug?: unknown } } | undefined;
  const slugs = filters?.filters?.company_show_slug;
  if (!Array.isArray(slugs) || !slugs.includes(slug)) return { error: "la página no está filtrada por esta empresa" };
  const { totalRows, totalHits, rows, counters } = search.data;
  const facet = counters?.find((counter) => counter.field === "company_show_slug")?.counts.find((count) => count.id === slug)?.total;
  const itemList = itemListLength(html);
  if (rows.length !== totalRows || totalRows !== totalHits || facet !== totalHits || itemList !== rows.length) {
    return {
      error: `listado incompleto: filas ${rows.length}, totalRows ${totalRows}, totalHits ${totalHits}, faceta ${facet ?? "—"}, ItemList ${itemList ?? "—"} (Magneto solo sirve 20 filas)`
    };
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return { error: "ids repetidos en el listado" };
  return { total: totalHits, rows };
}

/** JobPosting description from a posting page's JSON-LD. */
export function magnetoDescription(html: string): string | null {
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    const data = safeJson(match[1]) as { "@type"?: unknown; description?: unknown } | undefined;
    if (data?.["@type"] === "JobPosting" && typeof data.description === "string") return htmlToText(decodeEntities(data.description)) || null;
  }
  return null;
}

export async function listMagneto(ref: string, http: HttpGet, options: ListOptions): Promise<BoardListing> {
  const robots = await readRobots(ORIGIN, http);
  const url = `${ORIGIN}/co/empresas/${ref}/empleos`;
  if (!allowedUrl(robots, url)) return { kind: "error", detail: "robots.txt no permite la página de la empresa" };
  const response = await http(url, { accept: "text/html" });
  // Magneto answers 500 (not 404) for a company that doesn't exist: never proof of anything.
  if (response.status !== 200) return { kind: "error", detail: `HTTP ${response.status}` };
  const page = parseCompanyPage(response.body, ref);
  if ("error" in page) return { kind: "error", detail: page.error };

  const known = options.knownIds ?? new Set<string>();
  let budget = options.detailBudget ?? 0;
  let deferred = 0;
  const postings: RawAtsPosting[] = [];
  for (const row of page.rows) {
    if (!/^[a-z0-9-]{1,200}$/.test(row.jobSlug) || row.status !== "published") continue;
    const cities = (row.cities ?? []).map((city) => city.trim()).filter(Boolean);
    const posting: RawAtsPosting = {
      externalId: String(row.id),
      title: row.title.trim(),
      applyUrl: `${ORIGIN}/co/empresas/${ref}/empleos/${row.jobSlug}`,
      locationTexts: cities,
      countryCodes: row.countryIds?.length ? row.countryIds.map((id) => (id === COLOMBIA_ID ? "CO" : `MAGNETO-${id}`)) : [],
      structuredCity: cities.length === 1 ? cities[0] : null,
      // isRemote:false does not mean on-site (the modality is per company, not per row).
      workplace: row.isRemote === true ? "remote" : null,
      descriptionText: null,
      department: null,
      employmentType: text(row.contractOrder?.name),
      publishedAt: isoDate(row.publishDate),
      validThrough: isoDate(row.expirationDate),
      companyName: row.confidential ? null : text(row.companyName),
      partial: true
    };
    if (known.has(posting.externalId) || !allowedUrl(robots, posting.applyUrl)) {
      postings.push(posting);
      continue;
    }
    if (budget <= 0) {
      deferred++;
      continue;
    }
    budget--;
    const detail = await http(posting.applyUrl, { accept: "text/html" }).catch(() => null);
    const description = detail?.status === 200 ? magnetoDescription(detail.body) : null;
    postings.push({ ...posting, descriptionText: description, partial: description === null });
  }
  return { kind: "complete", boardTotal: page.total, postings, deferred };
}
