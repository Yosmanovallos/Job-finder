import { z } from "zod";
import { htmlToText, isoDate, safeJson, text } from "../text.js";
import type { BoardListing, HttpGet, RawAtsPosting } from "../types.js";
import { allowedUrl, readRobots } from "./site.js";

/** TP's public careers widget, linked from tp.com/es-co/ubicaciones/colombia/carreras/. */
const ORIGIN = "https://www.tp.com";
const SEARCH_PATH = "/Umbraco/Api/Careers/GetCareersBase";
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

const Row = z.object({
  date: z.string().nullable(),
  country: z.string(),
  location: z.string().nullable(),
  category: z.string().nullable(),
  title: z.string(),
  workFromHome: z.string().nullable(),
  description: z.string().nullable(),
  url: z.string(),
  externalId: z.number().int(),
  source: z.enum(["Umbraco", "iCIMS"]),
  opportunityType: z.string().nullable(),
  nodeId: z.number().int()
});
const Page = z.object({
  paginaAtual: z.number().int(),
  registrosPorPagina: z.number().int(),
  totalRegistros: z.number().int().nonnegative(),
  resultado: z.array(Row)
});

function pageUrl(page: number): string {
  const query = new URLSearchParams({ node: "1780", country: "Colombia", culture: "en-US", pageSize: String(PAGE_SIZE), page: String(page) });
  return `${ORIGIN}${SEARCH_PATH}?${query}`;
}

function tpDate(value: string | null): string | null {
  if (!value) return null;
  // TP omits the timezone. Preserve only its stated calendar day; claiming
  // the hour in UTC would invent an offset and vary relative-time labels.
  const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.exec(value);
  if (!match) return null;
  const date = isoDate(`${match[1]}T00:00:00Z`);
  return date?.startsWith(match[1]) ? date : null;
}

function posting(row: z.infer<typeof Row>): RawAtsPosting | null {
  if (row.country !== "Colombia" || !text(row.title)) return null;
  let url: URL;
  try { url = new URL(row.url, ORIGIN); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (row.source === "Umbraco") {
    if (url.host !== "www.tp.com" || !url.pathname.startsWith("/es-co/job-opportunities/colombia/") || row.nodeId <= 0) return null;
  } else if (!/^careers(?:co|spa)-teleperformance\.icims\.com$/.test(url.host) || !/^\/jobs\/\d+\//.test(url.pathname)) {
    return null;
  }
  const id = row.source === "Umbraco" ? `umbraco-${row.nodeId}` : `icims-${url.host.split(".")[0]}-${row.externalId}`;
  return {
    externalId: id,
    title: row.title.trim(),
    applyUrl: url.toString(),
    locationTexts: [row.location?.trim() || "Colombia"],
    countryCodes: ["CO"],
    structuredCity: null,
    workplace: /^(yes|true|1)$/i.test(row.workFromHome ?? "") ? "remote" : null,
    descriptionText: row.description ? htmlToText(row.description) || null : null,
    department: text(row.category),
    employmentType: text(row.opportunityType),
    publishedAt: tpDate(row.date),
    validThrough: null,
    companyName: "TP"
  };
}

export async function listTp(ref: string, http: HttpGet): Promise<BoardListing> {
  if (ref !== "colombia") return { kind: "error", detail: "referencia TP inválida" };
  const robots = await readRobots(ORIGIN, http);
  if (!allowedUrl(robots, pageUrl(0))) return { kind: "error", detail: "robots.txt no permite el listado TP" };
  const postings: RawAtsPosting[] = [];
  let total: number | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await http(pageUrl(page));
    if (response.status !== 200) return { kind: "error", detail: `HTTP ${response.status} en la página ${page}` };
    const parsed = Page.safeParse(safeJson(response.body));
    if (!parsed.success || parsed.data.paginaAtual !== page || parsed.data.registrosPorPagina !== PAGE_SIZE) {
      return { kind: "error", detail: `forma inesperada en la página ${page}` };
    }
    if (total !== null && parsed.data.totalRegistros !== total) return { kind: "error", detail: "total cambió entre páginas" };
    total = parsed.data.totalRegistros;
    if (parsed.data.resultado.length === 0 && total > 0) return { kind: "error", detail: "listado incompleto" };
    if (parsed.data.resultado.length > PAGE_SIZE) return { kind: "error", detail: "página excede el tamaño solicitado" };
    for (const row of parsed.data.resultado) {
      const mapped = posting(row);
      if (!mapped) return { kind: "error", detail: "vacante TP con país, id o URL inesperados" };
      if (row.date && mapped.publishedAt === null) return { kind: "error", detail: "fecha TP inválida" };
      postings.push(mapped);
    }
    if (total === 0) break;
    if (postings.length === total && parsed.data.resultado.length < PAGE_SIZE) break;
    if (postings.length >= total && total > 0) break;
  }
  if (total === null || postings.length !== total || new Set(postings.map((row) => row.externalId)).size !== total) {
    return { kind: "error", detail: `listado incompleto o ids repetidos: ${postings.length}/${total ?? "?"}` };
  }
  return { kind: "complete", boardTotal: total, postings };
}
