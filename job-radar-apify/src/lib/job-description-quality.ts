/**
 * Deterministic quality check for a stored, source-derived job description
 * (docs/JOB-DETAIL-ENRICHMENT.md §3). Pure: no I/O, no AI, same input -> same
 * verdict. Deliberately NOT a word-count score — 150 specific words pass and
 * 900 words of website navigation fail. Every failure carries a reason code so
 * "why isn't this job ready?" is always answerable.
 *
 * Input is the NORMALIZED storage form, never source HTML: `description` is
 * plain text with "\n" line breaks and `requirements` is the list-item array
 * (both produced by extractStructuredFromHtml()).
 */

export type DescriptionReason =
  | "MISSING_DESCRIPTION"
  | "DESCRIPTION_SNIPPET"
  | "DESCRIPTION_TOO_THIN"
  | "DESCRIPTION_IS_METADATA"
  | "DESCRIPTION_DUPLICATED_TEMPLATE"
  | "DESCRIPTION_ERROR_PAGE"
  | "DESCRIPTION_NAVIGATION_JUNK"
  | "DESCRIPTION_DUPLICATED_BLOCKS"
  | "DESCRIPTION_TRUNCATED"
  | "DESCRIPTION_APPLICATION_ONLY";

export interface DescriptionInput {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  description?: string | null;
  requirements?: string[] | null;
  /** Declared by the adapter: a teaser field (Torre tagline, Jooble snippet) is never complete. */
  descriptionKind?: string | null;
}

export interface DescriptionSignals {
  letters: number;
  words: number;
  lines: number;
  listItems: number;
  sentences: number;
  phoneLines: number;
  menuLabelHits: number;
  shortLineRatio: number;
  duplicatedItems: number;
}

export interface DescriptionAssessment {
  ok: boolean;
  reasons: DescriptionReason[];
  signals: DescriptionSignals;
}

/** Calibrated floors. A floor, not a quality score: below it there is no job to describe. */
export const DESCRIPTION_THRESHOLDS = {
  minLetters: 120,
  minSentences: 2,
  minListItemsWithOneSentence: 3,
  maxMenuLabelHits: 1,
  maxPhoneLines: 1,
  shortLineMinLines: 6,
  maxShortLineRatio: 0.5,
  maxDuplicatedItems: 2,
  applicationOnlyMaxWords: 40
} as const;

// Our own template phrases (job-seo.ts buildJobDescription/meta). If one of
// these is ever stored as a "description", it is BuscoTrabajo text, not the source's.
const OWN_BOILERPLATE = [/vacante agregada de/i, /aplica directamente en la p[aá]gina de/i, /\ben buscotrabajo\b/i];

const ERROR_PAGE = [
  /captcha/i,
  /verify (that )?you are (a )?human/i,
  /verifica que eres humano/i,
  /access denied/i,
  /acceso denegado/i,
  /enable javascript/i,
  /habilita javascript/i,
  /just a moment\.\.\./i,
  /attention required/i,
  /cloudflare ray id/i,
  /403 forbidden/i,
  /page not found/i,
  /p[aá]gina no encontrada/i,
  /this job (is )?no longer available/i,
  /esta (oferta|vacante) (ya )?no est[aá] disponible/i
];

const COOKIE_BANNER = [/usamos cookies/i, /we use cookies/i, /aceptar (todas las )?cookies/i, /accept (all )?cookies/i, /pol[ií]tica de cookies/i];

// Whole-line website navigation labels (a job text never consists of these
// alone). Matched against the full, folded line — never as substrings.
const MENU_LABELS = new Set(
  [
    "inicio",
    "home",
    "acceso",
    "menu",
    "menú",
    "contacto",
    "contactenos",
    "contáctenos",
    "mapa del sitio",
    "iniciar sesion",
    "iniciar sesión",
    "login",
    "sign in",
    "registrate",
    "regístrate",
    "terminos y condiciones",
    "términos y condiciones",
    "politica de privacidad",
    "política de privacidad",
    "transparencia activa",
    "gobierno transparente",
    "ley de transparencia",
    "ley del lobby",
    "noticias",
    "compartir",
    "share"
  ].map((label) => label.normalize("NFD").replace(/[̀-ͯ]/g, ""))
);

// A phone line: an international number ("+56 72 2 335100"), or 7+ digits next
// to an explicit phone keyword. Never bare digit runs — "Salario: 3.500.000"
// is a salary, not website chrome.
const INTERNATIONAL_PHONE = /\+\d{1,3}[\s-]?\(?\d{1,4}\)?([\s-]?\d{2,4}){2,4}/;
const PHONE_KEYWORD = /\b(tel[eé]fono|tel\.?|cel(ular)?|whatsapp|emergencias?|fax|ll[aá]manos|call us)\b/i;
function isPhoneLine(line: string): boolean {
  if (INTERNATIONAL_PHONE.test(line)) return true;
  return PHONE_KEYWORD.test(line) && (line.match(/\d/g) || []).length >= 7;
}
const TRUNCATED_END = /(…|\.\.\.|ver m[aá]s|leer m[aá]s|see more|show more|read more)\s*$/i;
const APPLY_WORDS = /\b(post[uú]late|postularse|aplica|aplicar|apply|env[ií]a tu (hv|cv|hoja de vida))\b/i;

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function countLetters(text: string): number {
  return (text.match(/\p{L}/gu) || []).length;
}

function countSentences(text: string): number {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.split(/\s+/).filter(Boolean).length >= 4).length;
}

export function assessDescription(input: DescriptionInput): DescriptionAssessment {
  const description = (input.description || "").trim();
  const items = (input.requirements || []).map((item) => (item || "").trim()).filter(Boolean);
  const lines = description.split("\n").map((line) => line.trim()).filter(Boolean);
  const combined = [description, ...items].join("\n");

  const letters = countLetters(combined);
  const words = combined.split(/\s+/).filter(Boolean).length;
  const sentences = countSentences(combined);
  const phoneLines = [...lines, ...items].filter((line) => isPhoneLine(line) && countLetters(line) < 40).length;
  const menuLabelHits = [...lines, ...items].filter((line) => MENU_LABELS.has(fold(line).replace(/[:.]$/, ""))).length;
  const shortLines = lines.filter((line) => line.split(/\s+/).length <= 3 && !/[:.!?]$/.test(line)).length;
  const shortLineRatio = lines.length > 0 ? shortLines / lines.length : 0;
  const seen = new Map<string, number>();
  for (const block of [...items, ...lines.filter((line) => line.length > 20)]) {
    const key = fold(block);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicatedItems = [...seen.values()].filter((count) => count > 1).length;

  const signals: DescriptionSignals = {
    letters,
    words,
    lines: lines.length,
    listItems: items.length,
    sentences,
    phoneLines,
    menuLabelHits,
    shortLineRatio: Math.round(shortLineRatio * 100) / 100,
    duplicatedItems
  };

  const reasons: DescriptionReason[] = [];
  if (letters === 0) {
    return { ok: false, reasons: ["MISSING_DESCRIPTION"], signals };
  }
  const t = DESCRIPTION_THRESHOLDS;

  if (input.descriptionKind === "snippet") reasons.push("DESCRIPTION_SNIPPET");

  const identity = [input.title, input.company, input.location].filter(Boolean).map((v) => fold(String(v)));
  let residual = fold(combined);
  for (const part of identity) residual = residual.split(part).join(" ");
  if (identity.includes(fold(combined)) || countLetters(residual) < 20) reasons.push("DESCRIPTION_IS_METADATA");

  if (OWN_BOILERPLATE.some((pattern) => pattern.test(combined))) reasons.push("DESCRIPTION_DUPLICATED_TEMPLATE");
  if (ERROR_PAGE.some((pattern) => pattern.test(combined))) reasons.push("DESCRIPTION_ERROR_PAGE");

  const cookieBanner = COOKIE_BANNER.some((pattern) => pattern.test(combined));
  const chrome =
    menuLabelHits > t.maxMenuLabelHits ||
    phoneLines > t.maxPhoneLines ||
    (lines.length >= t.shortLineMinLines && shortLineRatio > t.maxShortLineRatio);
  if (cookieBanner || chrome) reasons.push("DESCRIPTION_NAVIGATION_JUNK");

  if (duplicatedItems > t.maxDuplicatedItems) reasons.push("DESCRIPTION_DUPLICATED_BLOCKS");
  if (TRUNCATED_END.test(description)) reasons.push("DESCRIPTION_TRUNCATED");
  if (words <= t.applicationOnlyMaxWords && APPLY_WORDS.test(combined) && sentences < t.minSentences) {
    reasons.push("DESCRIPTION_APPLICATION_ONLY");
  }

  const enoughStructure =
    sentences >= t.minSentences || (sentences >= 1 && items.length >= t.minListItemsWithOneSentence);
  if (letters < t.minLetters || !enoughStructure) reasons.push("DESCRIPTION_TOO_THIN");

  return { ok: reasons.length === 0, reasons, signals };
}
