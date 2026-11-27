import { decodeEntities, htmlToText } from "../../lib/ats-text.js";
import type { SnapshotDraft } from "./job-snapshot.js";

// AI Resume Studio R4d — last automatic step before asking the user to paste:
// the page's own VISIBLE text, for employer sites that publish the vacancy
// in plain HTML without schema.org data. Strict guards so a home page, a
// search page or a cookie wall is never taken for a vacancy:
//   - the text must read like a job posting (≥ 2 of the usual sections:
//     requisitos/requirements, funciones/responsibilities, perfil…);
//   - between 400 and 20 000 characters after removing navigation,
//     headers, footers, forms, scripts and styles;
//   - a title from <h1>, og:title or <title>.
// The text stays UNTRUSTED (it is fenced as data in every prompt) and the
// requirements the model reads from it must still be literal copies of it.
// Pages built only by JavaScript have no text here: they still go to paste.

const MAX_HTML = 2 * 1024 * 1024;
const MIN_CHARS = 400;
const MAX_CHARS = 20_000;

const SECTION_MARKERS: RegExp[] = [
  /\b(requisitos|requerimientos|requirements|qualifications|what you('|’)ll need|what we('|’)re looking for|lo que buscamos|perfil (requerido|del cargo|buscado))\b/i,
  /\b(responsabilidades|responsibilities|funciones|what you('|’)ll do|in this role|tus retos|day to day|purpose|prop[oó]sito del cargo)\b/i,
  /\b(experiencia|experience|years of|a[nñ]os de)\b/i,
  /\b(beneficios|benefits|what we offer|ofrecemos|salario|salary|apply|post[uú]late|aplica)\b/i,
  /\b(education|educaci[oó]n|formaci[oó]n|degree|t[ií]tulo profesional|bachelor)\b/i
];

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? "").trim() : null;
}

function metaContent(html: string, key: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if ((attr(tag, "property") ?? attr(tag, "name"))?.toLowerCase() === key) return attr(tag, "content");
  }
  return null;
}

/** The page without chrome: navigation, header, footer, aside, forms, scripts, styles, hidden blocks. */
function contentHtml(html: string): string {
  let body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  body = body.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of ["script", "style", "noscript", "template", "svg", "nav", "header", "footer", "aside", "form", "select", "button", "iframe"]) {
    body = body.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  }
  // Prefer the page's main content when it marks one.
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body)?.[2];
  return main && htmlToText(main).length >= MIN_CHARS ? main : body;
}

function cleanTitle(raw: string | null): string | null {
  if (!raw) return null;
  // «Cargo | Empresa», «Cargo - Empresa Careers», «Job Details | …» → the first part.
  const t = decodeEntities(raw)
    .replace(/\s+/g, " ")
    .split(/\s[|–—]\s|\s-\s/)[0]
    .replace(/^(title|t[ií]tulo|cargo)\s*:\s*/i, "")
    .replace(/\b(job details|detalle de la vacante|oferta de empleo)\b/i, "")
    .trim();
  return t.length >= 3 && t.length <= 200 ? t : null;
}

export function jobPostingFromPageText(html: string): Partial<SnapshotDraft> | null {
  if (!html || html.length > MAX_HTML) return null;
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const title = cleanTitle(h1 ? htmlToText(h1) : null) ?? cleanTitle(metaContent(html, "og:title")) ?? cleanTitle(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null);
  if (!title) return null;
  let lines = htmlToText(contentHtml(html))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(cookies?|aceptar|accept|share|compartir|iniciar sesi[oó]n|sign in|log in|men[uú]|-)$/i.test(l) && !/^(©|copyright\b)/i.test(l));
  // Menus not marked as <nav> come before the vacancy: start where its title is.
  const at = lines.findIndex((l) => l.toLowerCase().includes(title.toLowerCase()));
  if (at > 0) lines = lines.slice(at);
  const text = lines.join("\n");
  if (text.length < MIN_CHARS) return null;
  const markers = SECTION_MARKERS.filter((re) => re.test(text)).length;
  if (markers < 2) return null;
  return {
    title,
    description: text.slice(0, MAX_CHARS),
    company: metaContent(html, "og:site_name"),
    location: null,
    remote: null,
    employmentType: null,
    datePosted: null,
    validThrough: null,
    salary: null,
    applyUrl: null
  };
}
