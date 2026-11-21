// AI Resume Studio R2 — shared types and limits for CV file import
// (doc 06 §5, doc 08 «Archivo malicioso», doc 09 F1–F8). Server only.

export const CV_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const CV_FILE_MAX_PAGES = 4;
export const CV_PARSE_TIMEOUT_MS = 5_000;
/** Longest text returned to the client; a 4-page CV is far below this. */
export const CV_TEXT_MAX_CHARS = 30_000;
/** Below this many letters a PDF is treated as scanned (F8). */
export const CV_MIN_TEXT_LETTERS = 40;

// ZIP limits (doc 08: «límite de descompresión (p. ej. 20 MB) y de entradas»).
export const ZIP_MAX_ENTRIES = 200;
export const ZIP_MAX_TOTAL_UNCOMPRESSED = 20 * 1024 * 1024;
export const ZIP_MAX_ENTRY_UNCOMPRESSED = 10 * 1024 * 1024;

export type CvFileKind = "pdf" | "docx";

export type CvFileRejection =
  | "too_large"
  | "unsupported_type"
  | "encrypted"
  | "active_content"
  | "macros"
  | "embedded_objects"
  | "external_relations"
  | "xml_entities"
  | "too_many_pages"
  | "zip_bomb"
  | "no_text"
  | "malformed"
  | "timeout"
  | "busy";

// Plain class fields only: the parse worker loads this file with Node's
// built-in type stripping (no tsx), which rejects parameter properties.
export class CvFileError extends Error {
  readonly code: CvFileRejection;
  constructor(code: CvFileRejection) {
    super(code);
    this.code = code;
    this.name = "CvFileError";
  }
}

export interface CvFileText {
  kind: CvFileKind;
  /** Pages when the file states them (PDF always; DOCX only if docProps says). */
  pages: number | null;
  text: string;
  truncated: boolean;
}

/** Messages shown to the user: clear, no internals, always offering «pegar texto». */
export const CV_FILE_MESSAGES: Record<CvFileRejection, string> = {
  too_large: "El archivo pesa más de 2 MB. Sube uno más liviano o pega el texto.",
  unsupported_type: "Solo aceptamos PDF o Word (.docx). También puedes pegar el texto.",
  encrypted: "El PDF tiene contraseña. Quítala o pega el texto de tu hoja de vida.",
  active_content: "El PDF trae contenido activo (JavaScript, acciones o adjuntos) y no lo abrimos. Exporta uno nuevo o pega el texto.",
  macros: "El Word trae macros y no lo abrimos. Guárdalo como .docx normal o pega el texto.",
  embedded_objects: "El Word trae objetos incrustados y no lo abrimos. Quítalos o pega el texto.",
  external_relations: "El Word enlaza contenido externo y no lo abrimos. Pega el texto de tu hoja de vida.",
  xml_entities: "El Word tiene una estructura no permitida. Guárdalo de nuevo o pega el texto.",
  too_many_pages: "La hoja de vida tiene más de 4 páginas. Resúmela o pega el texto.",
  zip_bomb: "El Word está dañado o es demasiado grande al abrirlo. Pega el texto.",
  no_text: "No encontramos texto: parece un documento escaneado. Pega el texto de tu hoja de vida.",
  malformed: "No pudimos leer el archivo. Pega el texto de tu hoja de vida.",
  timeout: "El archivo tardó demasiado en leerse. Pega el texto de tu hoja de vida.",
  busy: "Estamos leyendo otro archivo. Intenta de nuevo en unos segundos."
};

/** Type by magic bytes only (extension and Content-Type decide nothing). */
export function sniffCvFile(bytes: Uint8Array): CvFileKind | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "pdf"; // %PDF-
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "docx"; // PK\x03\x04 — confirmed as DOCX only once word/document.xml is found
  }
  return null;
}

/** Collapses whitespace, drops control characters, caps the length. */
export function normalizeExtractedText(raw: string): { text: string; truncated: boolean } {
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= CV_TEXT_MAX_CHARS) return { text: cleaned, truncated: false };
  return { text: cleaned.slice(0, CV_TEXT_MAX_CHARS), truncated: true };
}

export function countLetters(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}
