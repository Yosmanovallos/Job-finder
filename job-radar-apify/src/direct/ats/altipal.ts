import { decodeEntities, htmlToText } from "../text.js";
import type { BoardListing, HttpGet, ListOptions, RawAtsPosting } from "../types.js";
import { allowedUrl, innerHtmlAt, readRobots } from "./site.js";

const ORIGIN = "https://creeser.hr-suite.app";
const LIST_URL = `${ORIGIN}/vacantes.php`;
const CARD = /<div\s+class="vacante"\s*>/gi;
const LINK = /<a\s+href="(https:\/\/creeser\.hr-suite\.app\/vacante\/log\.php\?v=(\d{1,12}))"[^>]*>/i;
const CITIES = new Set([
  "bogota d c", "bucaramanga", "cali", "funza", "fusagasuga", "girardota", "jamundi",
  "medellin", "monteria", "neiva", "palmira", "pereira", "villavicencio", "yopal", "yumbo"
]);

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function localPublishedAt(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  // The Colombia-only portal uses local wall time (observed against its live
  // "Publicado en" values). Keep its stated hour rather than inventing UTC.
  const [, year, month, day, hour, minute, second] = match;
  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const utc = new Date(`${local}-05:00`);
  if (!Number.isFinite(utc.getTime()) || new Date(utc.getTime() - 5 * 3_600_000).toISOString().slice(0, 19) !== local) return null;
  return utc.toISOString();
}

function localEndOfDay(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const midnight = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== value) return null;
  // "Fecha Fin de Postulación" states a calendar day in Colombia. The
  // posting remains eligible through that local day, without a made-up hour.
  return new Date(midnight.getTime() + 29 * 3_600_000 - 1).toISOString();
}

function field(body: string, label: string): string | null {
  const match = new RegExp(`${label}:\\s*<b>([\\s\\S]*?)<\\/b>`, "i").exec(body);
  return match ? htmlToText(match[1]) || null : null;
}

export function parseAltipalPage(html: string): BoardListing {
  if (!/<title>Altipal - Vacantes Públicas<\/title>/i.test(html) ||
      !html.includes("Vacantes Públicas Altipal") ||
      /(?:rel=["']next["']|[?&](?:page|pagina|p)=\d+|\bpagination\b)/i.test(html)) {
    return { kind: "error", detail: "listado Altipal no reconocible o paginado" };
  }
  const cards = [...html.matchAll(CARD)];
  const links = [...html.matchAll(/https:\/\/creeser\.hr-suite\.app\/vacante\/log\.php\?v=\d+/gi)];
  if (cards.length === 0 || cards.length > 500 || cards.length !== links.length) {
    return { kind: "error", detail: "listado Altipal vacío, truncado o inconsistente" };
  }
  const postings: RawAtsPosting[] = [];
  for (const card of cards) {
    const body = innerHtmlAt(html, card.index, "div", 20_000);
    const title = body ? htmlToText(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(body)?.[1] ?? "") : "";
    const city = body ? field(body, "Ciudad") : null;
    const published = body ? field(body, "Publicado en") : null;
    const end = body ? field(body, "Fecha Fin de Postulación") : null;
    const link = body ? LINK.exec(body) : null;
    const publishedAt = published ? localPublishedAt(published) : null;
    const validThrough = end ? localEndOfDay(end) : null;
    if (!body || !body.includes("Vacante Disponible") || !title || !city || !CITIES.has(fold(city)) ||
        !publishedAt || !validThrough || !link) {
      return { kind: "error", detail: "vacante Altipal con forma, fecha o ciudad inesperada" };
    }
    postings.push({
      externalId: link[2],
      title,
      applyUrl: link[1],
      locationTexts: [city],
      countryCodes: ["CO"],
      structuredCity: city,
      workplace: null,
      descriptionText: null,
      department: field(body, "Área de Trabajo"),
      employmentType: null,
      publishedAt,
      validThrough,
      companyName: null,
      partial: true
    });
  }
  if (new Set(postings.map((posting) => posting.externalId)).size !== postings.length) {
    return { kind: "error", detail: "ids repetidos en Altipal" };
  }
  return { kind: "complete", boardTotal: postings.length, postings };
}

export function altipalDescription(html: string, posting: RawAtsPosting): string | null {
  if (!html.includes("Vacante Disponible")) return null;
  const title = htmlToText(/<div\s+class="card-header-interna"[^>]*>[\s\S]*?<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1] ?? "");
  const published = field(html, "Publicado en");
  if (title !== posting.title || !published || localPublishedAt(published) !== posting.publishedAt) return null;
  const start = /<h4\s+class="subtitle">Descripción del Cargo<\/h4>/i.exec(html);
  if (!start) return null;
  const end = html.indexOf("<!-- Formularios -->", start.index);
  if (end < 0 || end - start.index > 20_000) return null;
  return htmlToText(decodeEntities(html.slice(start.index, end))) || null;
}

export async function listAltipal(ref: string, http: HttpGet, options: ListOptions): Promise<BoardListing> {
  if (ref !== "creeser") return { kind: "error", detail: "referencia Altipal inválida" };
  const robots = await readRobots(ORIGIN, http);
  if (!allowedUrl(robots, LIST_URL)) return { kind: "error", detail: "robots.txt no permite el listado Altipal" };
  const response = await http(LIST_URL, { accept: "text/html" });
  if (response.status !== 200) return { kind: "error", detail: `HTTP ${response.status}` };
  const listing = parseAltipalPage(response.body);
  if (listing.kind !== "complete") return listing;
  const known = options.knownIds ?? new Set<string>();
  let budget = options.detailBudget ?? 0;
  let deferred = 0;
  const postings: RawAtsPosting[] = [];
  for (const posting of listing.postings) {
    if (!allowedUrl(robots, posting.applyUrl)) return { kind: "error", detail: "robots.txt no permite el detalle Altipal" };
    if (known.has(posting.externalId)) {
      postings.push(posting);
      continue;
    }
    if (budget <= 0) {
      deferred++;
      continue;
    }
    budget--;
    const detail = await http(posting.applyUrl, { accept: "text/html" });
    if (detail.status !== 200) return { kind: "error", detail: `HTTP ${detail.status} en detalle Altipal` };
    const description = altipalDescription(detail.body, posting);
    if (!description) return { kind: "error", detail: "detalle Altipal no reconocible" };
    postings.push({ ...posting, descriptionText: description, partial: false });
  }
  return { kind: "complete", boardTotal: listing.boardTotal, postings, deferred };
}
