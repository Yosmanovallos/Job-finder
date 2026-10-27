import { createHash } from "node:crypto";
import { decodeEntities, htmlToText } from "../text.js";
import type { BoardListing, HttpGet, RawAtsPosting } from "../types.js";
import { allowedUrl, innerHtmlAt, readRobots } from "./site.js";

const ORIGIN = "https://frisby.info";
const LIST_URL = `${ORIGIN}/gente-frisby/`;
const CARD = /<div\b[^>]*class="[^"]*\bjob-section\b[^"]*"[^>]*>/gi;
const APPLICATION = /<a\b[^>]*href="([^"]+)"[^>]*>\s*Aplicar\s*<\/a>/i;
const DEPARTMENTS = new Set([
  "Amazonas", "Antioquia", "Arauca", "Atlántico", "Bolívar", "Boyacá", "Caldas", "Caquetá",
  "Casanare", "Cauca", "Cesar", "Chocó", "Córdoba", "Cundinamarca", "Guainía", "Guaviare",
  "Huila", "La Guajira", "Magdalena", "Meta", "Nariño", "Norte de Santander", "Putumayo",
  "Quindío", "Risaralda", "San Andrés y Providencia", "Santander", "Sucre", "Tolima",
  "Valle del Cauca", "Vaupés", "Vichada", "Bogotá, D.C."
]);

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}='([^']*)'`).exec(tag);
  return match?.[1] ?? null;
}

function oneValue(tag: string, name: string): string | null {
  const raw = attribute(tag, name);
  if (!raw) return null;
  try {
    const values = JSON.parse(raw) as unknown;
    return Array.isArray(values) && values.length === 1 && typeof values[0] === "string" && values[0].trim()
      ? values[0].trim() : null;
  } catch {
    return null;
  }
}

function parseCard(tag: string, body: string): RawAtsPosting | null {
  const state = oneValue(tag, "data-states");
  const city = oneValue(tag, "data-cities");
  const titleStart = /<div\b[^>]*class="[^"]*\bshort-text\b[^"]*"[^>]*>/i.exec(body);
  const titleHtml = titleStart ? innerHtmlAt(body, titleStart.index, "div", 5_000) : null;
  const titleMatch = titleHtml ? /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(titleHtml) : null;
  const title = titleMatch ? htmlToText(titleMatch[1]) : "";
  const applicationMatch = APPLICATION.exec(body);
  if (!state || !DEPARTMENTS.has(state) || !city || !title || !applicationMatch) return null;

  let url: URL;
  try { url = new URL(decodeEntities(applicationMatch[1])); } catch { return null; }
  const formId = url.searchParams.get("gfid");
  if (url.protocol !== "https:" || url.host !== "frisby.info" || url.pathname !== "/aplicar-frisby/" ||
      !formId || !/^\d{1,12}$/.test(formId) || url.searchParams.get("state") !== state ||
      url.searchParams.get("city") !== city) return null;

  const descriptionStart = /<div\b[^>]*class="[^"]*\blarge-text\b[^"]*"[^>]*>/i.exec(body);
  const descriptionHtml = descriptionStart ? innerHtmlAt(body, descriptionStart.index, "div", 20_000) : null;
  const description = descriptionHtml ? htmlToText(descriptionHtml) : "";
  if (!description) return null;

  return {
    externalId: createHash("sha256").update(`${formId}\n${state}\n${city}`).digest("hex"),
    title,
    applyUrl: url.toString(),
    locationTexts: [`${city}, ${state}`],
    countryCodes: ["CO"],
    structuredCity: city,
    workplace: null,
    descriptionText: description,
    department: null,
    employmentType: null,
    publishedAt: null,
    validThrough: null,
    companyName: null
  };
}

/** Static, unpaginated corporate listing. Any changed card shape fails closed. */
export function parseFrisbyPage(html: string): BoardListing {
  if (!html.includes("Tenemos estas vacantes disponibles para ti") ||
      /(?:rel=["']next["']|\/gente-frisby\/page\/\d+|[?&]paged=\d+)/i.test(html)) {
    return { kind: "error", detail: "listado Frisby no reconocible o paginado" };
  }
  const matches = [...html.matchAll(CARD)];
  const applicationLinks = [...html.matchAll(/href="[^"]*\/aplicar-frisby\/\?[^"]*"/gi)];
  if (matches.length === 0 || matches.length > 500 || matches.length !== applicationLinks.length) {
    return { kind: "error", detail: "listado Frisby vacío, truncado o inconsistente" };
  }
  const postings: RawAtsPosting[] = [];
  for (const match of matches) {
    const body = innerHtmlAt(html, match.index, "div", 30_000);
    const posting = body && parseCard(match[0], body);
    if (!posting) return { kind: "error", detail: "vacante Frisby con forma inesperada" };
    postings.push(posting);
  }
  if (new Set(postings.map((posting) => posting.externalId)).size !== postings.length) {
    return { kind: "error", detail: "ids repetidos en Frisby" };
  }
  return { kind: "complete", boardTotal: postings.length, postings };
}

export async function listFrisby(ref: string, http: HttpGet): Promise<BoardListing> {
  if (ref !== "colombia") return { kind: "error", detail: "referencia Frisby inválida" };
  const robots = await readRobots(ORIGIN, http);
  if (!allowedUrl(robots, LIST_URL)) return { kind: "error", detail: "robots.txt no permite Frisby" };
  const response = await http(LIST_URL, { accept: "text/html" });
  if (response.status !== 200) return { kind: "error", detail: `HTTP ${response.status}` };
  const parsed = parseFrisbyPage(response.body);
  if (parsed.kind !== "complete") return parsed;
  if (parsed.postings.some((posting) => !allowedUrl(robots, posting.applyUrl))) {
    return { kind: "error", detail: "robots.txt no permite un enlace de aplicación Frisby" };
  }
  return parsed;
}
