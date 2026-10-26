import { z } from "zod";
import { htmlToText, safeJson, text } from "../text.js";
import type { BoardListing, HttpGet, ListOptions, RawAtsPosting } from "../types.js";
import { allowedUrl, readRobots } from "./site.js";

/** Public WordPress collections on the career site linked by nexaBPO.com. */
const ORIGIN = "https://workeando.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const Offer = z.object({
  id: z.number().int().positive(),
  date_gmt: z.string(),
  status: z.literal("publish"),
  type: z.literal("ofertas"),
  link: z.string(),
  title: z.object({ rendered: z.string() }),
  content: z.object({ rendered: z.string() }),
  ciudad: z.array(z.number().int().positive())
});
const City = z.object({ id: z.number().int().positive(), name: z.string().min(1) });
type CollectionResult<T> = { kind: "ok"; rows: T[] } | { kind: "error"; detail: string };

function collectionUrl(collection: "ofertas" | "ciudad", page: number): string {
  return `${ORIGIN}/wp-json/wp/v2/${collection}?per_page=${PAGE_SIZE}&page=${page}`;
}

function count(value: string | undefined): number | null {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

async function readCollection<T>(
  collection: "ofertas" | "ciudad",
  schema: z.ZodType<T>,
  http: HttpGet,
  allowed: (url: string) => boolean
): Promise<CollectionResult<T>> {
  const rows: T[] = [];
  let total: number | null = null;
  let pages: number | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = collectionUrl(collection, page);
    if (!allowed(url)) return { kind: "error", detail: `${collection} página ${page}: robots.txt no permite la lectura` };
    // Supplying accept also disables redirect following in boundedGet; the
    // fixed public origin is the only host this connector may read.
    const response = await http(url, { accept: "application/json" });
    if (response.status !== 200) return { kind: "error", detail: `${collection} página ${page}: HTTP ${response.status}` };
    const nextTotal = count(response.headers?.["x-wp-total"]);
    const nextPages = count(response.headers?.["x-wp-totalpages"]);
    if (nextTotal === null || nextPages === null || nextPages < 1 || nextPages > MAX_PAGES ||
        nextPages !== Math.max(1, Math.ceil(nextTotal / PAGE_SIZE)) ||
        (total !== null && (nextTotal !== total || nextPages !== pages))) {
      return { kind: "error", detail: `${collection} página ${page}: cabeceras de paginación ausentes o inconsistentes` };
    }
    total = nextTotal;
    pages = nextPages;
    const parsed = z.array(schema).safeParse(safeJson(response.body));
    if (!parsed.success) return { kind: "error", detail: `${collection} página ${page}: forma JSON inesperada` };
    if (parsed.data.length > PAGE_SIZE || parsed.data.length !== Math.min(PAGE_SIZE, total - rows.length)) {
      return { kind: "error", detail: `${collection} página ${page}: cantidad de filas inesperada` };
    }
    rows.push(...parsed.data);
    if (page === pages) return rows.length === total
      ? { kind: "ok", rows }
      : { kind: "error", detail: `${collection}: listado incompleto` };
  }
  return { kind: "error", detail: `${collection}: se excedió el límite de páginas` };
}

function wpDate(value: string): string | null {
  // WordPress date_gmt explicitly states UTC; never substitute modified_gmt
  // or the time this board was read.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}Z`);
  return Number.isFinite(date.getTime()) && date.toISOString() === `${value}.000Z` ? date.toISOString() : null;
}

function posting(row: z.infer<typeof Offer>, cities: Map<number, string>): RawAtsPosting | null {
  let url: URL;
  try { url = new URL(row.link); } catch { return null; }
  if (url.origin !== ORIGIN || !/^\/ofertas\/[a-z0-9-]+\/$/.test(url.pathname) || url.search || url.hash) return null;
  const title = text(htmlToText(row.title.rendered));
  const description = text(htmlToText(row.content.rendered));
  const publishedAt = wpDate(row.date_gmt);
  if (!title || !description || !publishedAt || row.ciudad.some((id) => !cities.has(id))) return null;
  return {
    externalId: String(row.id),
    title,
    applyUrl: url.toString(),
    locationTexts: row.ciudad.map((id) => cities.get(id)!),
    countryCodes: [],
    structuredCity: null,
    workplace: null,
    descriptionText: description,
    department: null,
    employmentType: null,
    publishedAt,
    validThrough: null,
    // The site is linked by NEXA, but its individual postings do not all
    // identify an employer. Association belongs to the reviewed seed.
    companyName: null
  };
}

export async function listWorkeando(ref: string, http: HttpGet, options: ListOptions = {}): Promise<BoardListing> {
  if (ref !== "nexa-bpo") return { kind: "error", detail: "referencia Workeando inválida" };
  const robots = await readRobots(ORIGIN, http);
  const allowed = (url: string) => allowedUrl(robots, url);
  const offers = await readCollection("ofertas", Offer, http, allowed);
  if (offers.kind === "error") return { kind: "error", detail: offers.detail };
  if (new Set(offers.rows.map((row) => row.id)).size !== offers.rows.length) return { kind: "error", detail: "ofertas: IDs repetidos" };
  const cityRows = await readCollection("ciudad", City, http, allowed);
  if (cityRows.kind === "error") return { kind: "error", detail: cityRows.detail };
  if (new Set(cityRows.rows.map((row) => row.id)).size !== cityRows.rows.length) return { kind: "error", detail: "ciudad: IDs repetidos" };
  const cities = new Map(cityRows.rows.map((row) => [row.id, row.name]));
  const postings: RawAtsPosting[] = [];
  for (const offer of offers.rows) {
    // An unrelated old entry even points to /ofertas/__trashed/ while its
    // WordPress status is publish. It is not a NEXA posting. A previously
    // stored NEXA id losing its attribution is an error, never a closure.
    if (!/\bnexa(?:\s+bpo)?\b/i.test(htmlToText(offer.content.rendered))) {
      if (options.knownIds?.has(String(offer.id))) return { kind: "error", detail: `vacante NEXA ${offer.id} perdió atribución` };
      continue;
    }
    const mapped = posting(offer, cities);
    if (!mapped) return { kind: "error", detail: `vacante Workeando ${offer.id} incompleta o inválida` };
    postings.push(mapped);
  }
  return { kind: "complete", boardTotal: offers.rows.length, postings };
}
