// Editorial guides (/guias) — openspec/changes/adsense-readiness, phase F3,
// requirement ADS-040. Pure module: parsing, validation, rendering and the
// "is this guide published?" rule. No fs here, so the client can import the
// payload types; src/server/guides-store.ts reads content/guias/*.md.
//
// The quality rules are what separates a guide from scaled content abuse
// (Google spam policies, SP-11):
//   - every paragraph with a figure or a legal norm cites an official source;
//   - each guide carries a BuscoTrabajo corpus fact with a cut-off date;
//   - >= 800 useful words; no >40-word paragraph shared with another guide;
//   - the owner's review fields exist, and only an approved guide publishes.
// An invalid or unapproved guide fails closed: no route, no sitemap, no link.

export const MIN_USEFUL_WORDS = 800;
export const MAX_SHARED_PARAGRAPH_WORDS = 40;
import { GUIDES_BASE_PATH, MAX_RELATED_GUIDES, SLUG_RE, guidePath, type GuideSummary } from "./guide-links.js";

export { GUIDES_BASE_PATH, MAX_RELATED_GUIDES, guidePath, isGuideSummaryList, readSsrGuideLinks } from "./guide-links.js";
export type { GuideSummary, SsrGuideLinks } from "./guide-links.js";

/** Official sources a figure or norm may rest on (Colombian state + SENA). */
export function isOfficialSourceUrl(url: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  return host.endsWith(".gov.co") || host === "sena.edu.co" || host.endsWith(".sena.edu.co");
}

export function isCorpusSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "buscotrabajo.co";
  } catch {
    return false;
  }
}

export interface GuideSource {
  id: string;
  label: string;
  url: string;
  /** Free text after the link, e.g. "consultada el 2026-11-14". */
  note: string;
  official: boolean;
  corpus: boolean;
  /** "corte AAAA-MM-DD" on a corpus source. */
  cutoff: string | null;
}

export type GuideBlock =
  | { type: "h2" | "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul" | "ol"; items: string[] };

export interface GuideFrontmatter {
  slug: string;
  titulo: string;
  descripcion: string;
  autor: string;
  autor_tipo: string;
  publicada: string;
  actualizada: string;
  etiquetas: string[];
  revision_propietario: string;
  revisado_por: string;
  fecha_revision: string;
  raw: Record<string, string>;
}

export interface Guide {
  file: string;
  meta: GuideFrontmatter;
  blocks: GuideBlock[];
  sources: GuideSource[];
  body: string;
}

export interface GuideValidation {
  file: string;
  slug: string;
  errors: string[];
}

const REQUIRED_KEYS = [
  "slug",
  "titulo",
  "descripcion",
  "autor",
  "autor_tipo",
  "publicada",
  "actualizada",
  "etiquetas",
  "revision_propietario",
  "revisado_por",
  "fecha_revision"
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FOOTNOTE_DEF_RE = /^\[\^([a-z0-9-]+)\]:\s*\[([^\]]+)\]\((https:\/\/[^)\s]+)\)\s*(.*)$/i;
const FOOTNOTE_REF_RE = /\[\^([a-z0-9-]+)\]/gi;
// A figure (any digit, %, $) or a legal norm needs an official source.
const FIGURE_RE = /\d|%|\$/;
const NORM_RE = /\b(art[íi]culos?|ley|leyes|decretos?|resoluci[óo]n(es)?|c[óo]digo sustantivo|cst|sentencias?|circular(es)?)\b/i;

export class GuideParseError extends Error {}

/** Splits "---\nfrontmatter\n---\nbody". Frontmatter is flat `key: value`. */
export function parseGuide(file: string, source: string): Guide {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new GuideParseError(`${file}: falta el bloque de metadatos entre '---'`);
  const raw: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const kv = /^([a-z_]+):\s?(.*)$/.exec(line);
    if (!kv) throw new GuideParseError(`${file}: línea de metadatos no válida: ${line}`);
    raw[kv[1]!] = kv[2]!.trim().replace(/^"(.*)"$/, "$1");
  }
  const meta: GuideFrontmatter = {
    slug: raw.slug ?? "",
    titulo: raw.titulo ?? "",
    descripcion: raw.descripcion ?? "",
    autor: raw.autor ?? "",
    autor_tipo: raw.autor_tipo ?? "",
    publicada: raw.publicada ?? "",
    actualizada: raw.actualizada ?? "",
    etiquetas: (raw.etiquetas ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
    revision_propietario: raw.revision_propietario ?? "",
    revisado_por: raw.revisado_por ?? "",
    fecha_revision: raw.fecha_revision ?? "",
    raw
  };
  const body = match[2]!;
  const { blocks, sources } = parseBody(file, body);
  return { file, meta, blocks, sources, body };
}

function parseBody(file: string, body: string): { blocks: GuideBlock[]; sources: GuideSource[] } {
  const blocks: GuideBlock[] = [];
  const sources: GuideSource[] = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "p", text: paragraph.join(" ") });
    paragraph = [];
    if (list) blocks.push(list);
    list = null;
  };
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const footnote = FOOTNOTE_DEF_RE.exec(line.trim());
    if (footnote) {
      flush();
      const url = footnote[3]!;
      const note = footnote[4]!.replace(/^[—–-]\s*/, "").trim();
      const cutoff = /corte (\d{4}-\d{2}-\d{2})/i.exec(note)?.[1] ?? null;
      sources.push({
        id: footnote[1]!.toLowerCase(),
        label: footnote[2]!,
        url,
        note,
        official: isOfficialSourceUrl(url),
        corpus: isCorpusSourceUrl(url),
        cutoff
      });
      continue;
    }
    if (/^\[\^/.test(line.trim())) throw new GuideParseError(`${file}: fuente mal escrita (usa [^id]: [Nombre](https://...) nota): ${line}`);
    if (/^#\s/.test(line)) throw new GuideParseError(`${file}: el título va en 'titulo', no como '# ' en el cuerpo`);
    if (/^####/.test(line)) throw new GuideParseError(`${file}: solo se admiten '##' y '###'`);
    if (/<[a-z!/]/i.test(line)) throw new GuideParseError(`${file}: HTML no admitido: ${line}`);
    if (/!\[/.test(line)) throw new GuideParseError(`${file}: imágenes no admitidas: ${line}`);
    if (/^\s*\|/.test(line)) throw new GuideParseError(`${file}: tablas no admitidas: ${line}`);
    const heading = /^(##|###)\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: heading[1] === "##" ? "h2" : "h3", text: heading[2]!.trim() });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (bullet || ordered) {
      const type = bullet ? "ul" : "ol";
      if (paragraph.length) {
        blocks.push({ type: "p", text: paragraph.join(" ") });
        paragraph = [];
      }
      if (!list || list.type !== type) {
        if (list) blocks.push(list);
        list = { type, items: [] };
      }
      list.items.push((bullet ?? ordered)![1]!.trim());
      continue;
    }
    if (list && /^\s{2,}\S/.test(rawLine)) {
      // Continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list) {
      blocks.push(list);
      list = null;
    }
    paragraph.push(line.trim());
  }
  flush();
  return { blocks, sources };
}

/** Plain text of an inline string: links become their label, refs vanish. */
export function inlineToText(text: string): string {
  return text
    .replace(FOOTNOTE_REF_RE, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Words in paragraphs and list items; headings and the source list don't count. */
export function usefulWordCount(guide: Guide): number {
  let total = 0;
  for (const block of guide.blocks) {
    if (block.type === "p") total += countWords(inlineToText(block.text));
    else if (block.type === "ul" || block.type === "ol") total += block.items.reduce((sum, item) => sum + countWords(inlineToText(item)), 0);
  }
  return total;
}

/** Text units a figure/norm check and the duplicate check look at. */
function textUnits(guide: Guide): string[] {
  const units: string[] = [];
  for (const block of guide.blocks) {
    if (block.type === "p") units.push(block.text);
    else if (block.type === "ul" || block.type === "ol") units.push(...block.items);
  }
  return units;
}

function refsIn(text: string): string[] {
  return [...text.matchAll(FOOTNOTE_REF_RE)].map((match) => match[1]!.toLowerCase());
}

export function normalizeParagraph(text: string): string {
  return inlineToText(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isOwnerApproved(meta: GuideFrontmatter): boolean {
  return meta.revision_propietario === "aprobada" && meta.revisado_por.trim().length > 0 && DATE_RE.test(meta.fecha_revision);
}

/** Checks one guide on its own (everything except cross-guide duplicates). */
export function validateGuide(guide: Guide): string[] {
  const errors: string[] = [];
  const { meta } = guide;
  for (const key of REQUIRED_KEYS) {
    if (!(key in meta.raw)) errors.push(`falta el campo '${key}'`);
  }
  if (!SLUG_RE.test(meta.slug)) errors.push(`slug no válido: '${meta.slug}'`);
  if (`${meta.slug}.md` !== guide.file.split(/[\\/]/).pop()) errors.push(`el archivo debe llamarse ${meta.slug}.md`);
  if (meta.titulo.length < 10 || meta.titulo.length > 110) errors.push("'titulo' debe tener entre 10 y 110 caracteres");
  if (meta.descripcion.length < 50 || meta.descripcion.length > 170) errors.push("'descripcion' debe tener entre 50 y 170 caracteres");
  if (!meta.autor.trim()) errors.push("falta 'autor'");
  if (meta.autor_tipo !== "Person" && meta.autor_tipo !== "Organization") errors.push("'autor_tipo' debe ser Person u Organization");
  if (meta.etiquetas.length === 0) errors.push("falta al menos una etiqueta");
  if (!["pendiente", "aprobada"].includes(meta.revision_propietario)) errors.push("'revision_propietario' debe ser 'pendiente' o 'aprobada'");
  if (meta.revision_propietario === "aprobada") {
    if (!meta.revisado_por.trim()) errors.push("guía aprobada sin 'revisado_por'");
    if (!DATE_RE.test(meta.fecha_revision)) errors.push("guía aprobada sin 'fecha_revision' AAAA-MM-DD");
    if (!DATE_RE.test(meta.publicada)) errors.push("guía aprobada sin fecha 'publicada' AAAA-MM-DD");
  }
  if (meta.publicada && !DATE_RE.test(meta.publicada)) errors.push("'publicada' debe ser AAAA-MM-DD");
  if (meta.actualizada && !DATE_RE.test(meta.actualizada)) errors.push("'actualizada' debe ser AAAA-MM-DD");
  if (meta.publicada && meta.actualizada && meta.actualizada < meta.publicada) errors.push("'actualizada' es anterior a 'publicada'");

  const words = usefulWordCount(guide);
  if (words < MIN_USEFUL_WORDS) errors.push(`tiene ${words} palabras útiles; el mínimo es ${MIN_USEFUL_WORDS}`);

  const byId = new Map<string, GuideSource>();
  for (const source of guide.sources) {
    if (byId.has(source.id)) errors.push(`fuente [^${source.id}] definida dos veces`);
    byId.set(source.id, source);
  }
  const cited = new Set<string>();
  for (const unit of textUnits(guide)) {
    const refs = refsIn(unit);
    refs.forEach((ref) => cited.add(ref));
    for (const ref of refs) if (!byId.has(ref)) errors.push(`cita [^${ref}] sin fuente definida`);
    const plain = inlineToText(unit);
    const cites = refs.map((ref) => byId.get(ref)).filter((source): source is GuideSource => Boolean(source));
    const official = cites.some((source) => source.official);
    // A norm always needs the official text; our own corpus can only back a figure.
    if (NORM_RE.test(plain) && !official) {
      errors.push(`norma sin fuente oficial enlazada: «${plain.slice(0, 90)}…»`);
    } else if (FIGURE_RE.test(plain) && !official && !cites.some((source) => source.corpus && source.cutoff)) {
      errors.push(`cifra sin fuente oficial enlazada: «${plain.slice(0, 90)}…»`);
    }
  }
  for (const source of guide.sources) {
    if (!cited.has(source.id)) errors.push(`fuente [^${source.id}] definida pero no citada`);
    if (source.corpus && !source.cutoff) errors.push(`dato del corpus [^${source.id}] sin 'corte AAAA-MM-DD'`);
  }
  if (!guide.sources.some((source) => source.corpus && source.cutoff)) {
    errors.push("falta el dato propio del corpus de BuscoTrabajo con fecha de corte");
  }
  if (!guide.sources.some((source) => source.official)) errors.push("no cita ninguna fuente oficial");
  return errors;
}

/** Validates every guide, including the cross-guide duplicate-paragraph rule. */
export function validateGuides(guides: Guide[]): GuideValidation[] {
  const results = guides.map((guide) => ({ file: guide.file, slug: guide.meta.slug, errors: validateGuide(guide) }));
  const seen = new Map<string, string>();
  const slugs = new Map<string, string>();
  guides.forEach((guide, index) => {
    const previous = slugs.get(guide.meta.slug);
    if (previous) results[index]!.errors.push(`slug repetido con ${previous}`);
    slugs.set(guide.meta.slug, guide.file);
    const own = new Set<string>();
    for (const unit of textUnits(guide)) {
      const normalized = normalizeParagraph(unit);
      if (normalized.split(" ").length <= MAX_SHARED_PARAGRAPH_WORDS || own.has(normalized)) continue;
      own.add(normalized);
      const other = seen.get(normalized);
      if (other && other !== guide.file) {
        results[index]!.errors.push(`párrafo de más de ${MAX_SHARED_PARAGRAPH_WORDS} palabras repetido en ${other}`);
      } else {
        seen.set(normalized, guide.file);
      }
    }
  });
  return results;
}

/** Only valid, owner-approved guides are published. */
export function publishedGuides(guides: Guide[]): Guide[] {
  const validation = validateGuides(guides);
  return guides
    .filter((guide, index) => validation[index]!.errors.length === 0 && isOwnerApproved(guide.meta))
    .sort((a, b) => (a.meta.publicada < b.meta.publicada ? 1 : a.meta.publicada > b.meta.publicada ? -1 : a.meta.slug.localeCompare(b.meta.slug)));
}

// ---------------------------------------------------------------- rendering

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeHref(url: string): string | null {
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function renderInline(text: string, sourceNumber: Map<string, number>): string {
  // Tokenise first, escape the plain runs: no raw HTML can reach the page.
  const out: string[] = [];
  const pattern = /\[\^([a-z0-9-]+)\]|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/gi;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    out.push(escapeHtml(text.slice(last, match.index)));
    last = match.index! + match[0].length;
    if (match[1]) {
      const n = sourceNumber.get(match[1].toLowerCase());
      if (n) out.push(`<sup><a href="#fuente-${n}" aria-label="Fuente ${n}">[${n}]</a></sup>`);
    } else if (match[2]) {
      const href = safeHref(match[3]!);
      const label = escapeHtml(match[2]);
      if (!href) out.push(label);
      else if (href.startsWith("/")) out.push(`<a href="${escapeHtml(href)}">${label}</a>`);
      else out.push(`<a href="${escapeHtml(href)}" rel="noopener" target="_blank">${label}</a>`);
    } else if (match[4]) {
      out.push(`<strong>${escapeHtml(match[4])}</strong>`);
    }
  }
  out.push(escapeHtml(text.slice(last)));
  return out.join("");
}

function sourceNumbers(guide: Guide): Map<string, number> {
  const numbers = new Map<string, number>();
  guide.sources.forEach((source, index) => numbers.set(source.id, index + 1));
  return numbers;
}

export function formatSpanishDate(date: string): string {
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return `${d} de ${months[m - 1]} de ${y}`;
}

/** Inner HTML of the guide body, the byline and the numbered source list. */
export function renderGuideBodyHtml(guide: Guide): string {
  const numbers = sourceNumbers(guide);
  const body = guide.blocks.map((block) => {
    if (!("items" in block)) return `<${block.type}>${renderInline(block.text, numbers)}</${block.type}>`;
    return `<${block.type}>${block.items.map((item) => `<li>${renderInline(item, numbers)}</li>`).join("")}</${block.type}>`;
  }).join("\n");
  const sources = guide.sources.map((source, index) => {
    const note = source.note ? ` — ${escapeHtml(source.note)}` : "";
    return `<li id="fuente-${index + 1}"><a href="${escapeHtml(source.url)}" rel="noopener" target="_blank">${escapeHtml(source.label)}</a>${note}</li>`;
  }).join("");
  return `${body}\n<section aria-labelledby="guia-fuentes"><h2 id="guia-fuentes">Fuentes</h2><ol>${sources}</ol></section>`;
}



export interface GuidePayload extends GuideSummary {
  author: string;
  authorType: "Person" | "Organization";
  reviewedBy: string;
  reviewDate: string;
  /** Rendered, escaped HTML from renderGuideBodyHtml. */
  html: string;
  sources: Array<{ label: string; url: string }>;
}

export function guideSummary(guide: Guide): GuideSummary {
  return {
    slug: guide.meta.slug,
    path: guidePath(guide.meta.slug),
    title: guide.meta.titulo,
    description: guide.meta.descripcion,
    datePublished: guide.meta.publicada,
    dateModified: guide.meta.actualizada || guide.meta.publicada
  };
}

export function guidePayload(guide: Guide): GuidePayload {
  return {
    ...guideSummary(guide),
    author: guide.meta.autor,
    authorType: guide.meta.autor_tipo === "Person" ? "Person" : "Organization",
    reviewedBy: guide.meta.revisado_por,
    reviewDate: guide.meta.fecha_revision,
    html: renderGuideBodyHtml(guide),
    sources: guide.sources.map((source) => ({ label: source.label, url: source.url }))
  };
}

export function isGuidePayload(value: unknown): value is GuidePayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.slug === "string" && SLUG_RE.test(v.slug) && typeof v.title === "string" && typeof v.html === "string" &&
    typeof v.author === "string" && typeof v.datePublished === "string" && Array.isArray(v.sources);
}


export function guideArticleJsonLd(guide: Guide, origin: string): Record<string, unknown> {
  const url = `${origin}${guidePath(guide.meta.slug)}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.meta.titulo,
    description: guide.meta.descripcion,
    inLanguage: "es-CO",
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished: guide.meta.publicada,
    dateModified: guide.meta.actualizada || guide.meta.publicada,
    author: guide.meta.autor_tipo === "Person"
      ? { "@type": "Person", name: guide.meta.autor }
      : { "@type": "Organization", name: guide.meta.autor, url: origin },
    publisher: { "@type": "Organization", name: "BuscoTrabajo", url: origin },
    citation: guide.sources.map((source) => ({ "@type": "CreativeWork", name: source.label, url: source.url })),
    wordCount: usefulWordCount(guide)
  };
}

export function renderGuideMarkdown(guide: Guide): string {
  const byline = `Por ${guide.meta.autor} · Publicada el ${guide.meta.publicada} · Revisada el ${guide.meta.actualizada || guide.meta.publicada}`;
  return `# ${guide.meta.titulo}\n\n${byline}\n\n${guide.body.trim()}\n`;
}

export function renderGuideIndexMarkdown(guides: Guide[]): string {
  const items = guides.map((guide) => `- [${guide.meta.titulo}](${guidePath(guide.meta.slug)}): ${guide.meta.descripcion}`).join("\n");
  return `# ${GUIDES_INDEX_HEADING}\n\n${GUIDES_INDEX_INTRO}\n\n${items}\n`;
}

export const GUIDES_INDEX_TITLE = "Guías para buscar empleo en Colombia | BuscoTrabajo";
export const GUIDES_INDEX_HEADING = "Guías para buscar empleo en Colombia";
export const GUIDES_INDEX_DESCRIPTION = "Guías prácticas para buscar trabajo en Colombia, con fuentes oficiales enlazadas y datos propios de las vacantes que reúne BuscoTrabajo.";
export const GUIDES_INDEX_INTRO = "Cada guía cita la norma o la entidad oficial de la que sale cada dato, incluye una cifra calculada con las vacantes que reúne BuscoTrabajo con su fecha de corte, y la revisa una persona antes de publicarse.";

/** Up to three published guides sharing a tag, in the order of the tags asked for. */
export function relatedGuides(guides: Guide[], tags: string[], exclude?: string): GuideSummary[] {
  const picked: GuideSummary[] = [];
  for (const tag of tags) {
    for (const guide of guides) {
      if (picked.length >= MAX_RELATED_GUIDES) return picked;
      if (guide.meta.slug === exclude || picked.some((item) => item.slug === guide.meta.slug)) continue;
      if (guide.meta.etiquetas.includes(tag)) picked.push(guideSummary(guide));
    }
  }
  return picked;
}

export function renderRelatedGuidesHtml(links: GuideSummary[]): string {
  if (links.length === 0) return "";
  const items = links.map((link) => `<li><a href="${escapeHtml(link.path)}">${escapeHtml(link.title)}</a></li>`).join("");
  return `<nav aria-label="Guías relacionadas" data-related-guides><h2>Guías relacionadas</h2><ul>${items}</ul></nav>`;
}

// Tags a hub or a job page asks guides for, most specific first. Guides
// declare these in `etiquetas`; a tag no published guide carries just yields
// fewer links. Static mapping: no query, no change to the hub/job data.
export const GUIDE_TAGS = {
  search: "buscar-empleo",
  resume: "hoja-de-vida",
  interview: "entrevista",
  scams: "ofertas-falsas",
  contracts: "contratos",
  benefits: "prestaciones",
  firstJob: "sin-experiencia",
  remote: "remoto",
  publicService: "servicio-publico-de-empleo"
} as const;

const INTENT_GUIDE_TAGS: Record<string, string[]> = {
  "sin-experiencia": [GUIDE_TAGS.firstJob, GUIDE_TAGS.resume, GUIDE_TAGS.publicService],
  remoto: [GUIDE_TAGS.remote, GUIDE_TAGS.scams, GUIDE_TAGS.contracts],
  "medio-tiempo": [GUIDE_TAGS.contracts, GUIDE_TAGS.benefits, GUIDE_TAGS.search],
  "fines-de-semana": [GUIDE_TAGS.contracts, GUIDE_TAGS.benefits, GUIDE_TAGS.search],
  temporada: [GUIDE_TAGS.contracts, GUIDE_TAGS.benefits, GUIDE_TAGS.firstJob]
};

export function guideTagsForHub(hub: { kind: string; intent?: string }): string[] {
  if (hub.intent && INTENT_GUIDE_TAGS[hub.intent]) return INTENT_GUIDE_TAGS[hub.intent]!;
  if (hub.kind === "rol") return [GUIDE_TAGS.resume, GUIDE_TAGS.interview, GUIDE_TAGS.contracts];
  return [GUIDE_TAGS.search, GUIDE_TAGS.publicService, GUIDE_TAGS.resume];
}

export function guideTagsForJob(job: { modality?: string | null; remote?: boolean | null }): string[] {
  const remote = job.remote === true || /remot/i.test(job.modality ?? "");
  return remote
    ? [GUIDE_TAGS.remote, GUIDE_TAGS.scams, GUIDE_TAGS.interview]
    : [GUIDE_TAGS.scams, GUIDE_TAGS.interview, GUIDE_TAGS.resume];
}


