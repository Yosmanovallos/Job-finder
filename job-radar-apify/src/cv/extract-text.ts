import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

/**
 * Untrusted-input text extraction for uploaded CVs (docs/CV-GENERATION-PLAN.md
 * §7, AGENTS.md regla 6 — a second untrusted source alongside scraped job
 * text). Every check here runs BEFORE the parser touches the bytes, or
 * bounds how long the parser is allowed to run — a malformed file must
 * degrade to a clean rejection, never take down the process (same class of
 * failure as the OOM incident documented in BACKLOG.md).
 */

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB, §7
export const MAX_EXTRACTED_TEXT_CHARS = 6000; // matches cv_profiles.raw_text CHECK, §7

export const PDF_MIME = "application/pdf";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ALLOWED_MIME_TYPES = new Set([PDF_MIME, DOCX_MIME]);

export class UnsupportedFileTypeError extends Error {}
export class TextExtractionError extends Error {}

const EXTRACTION_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TextExtractionError(`${label} tardó más de ${ms}ms`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/** Cheap sanity check on the actual bytes — a declared Content-Type is
 * never trusted on its own for a parser this security-sensitive. */
function validateMagicBytes(buffer: Buffer, mimeType: string): void {
  if (mimeType === PDF_MIME) {
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new UnsupportedFileTypeError("El archivo no es un PDF válido.");
    }
    return;
  }
  // .docx is a ZIP archive — local file header signature "PK\x03\x04".
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    throw new UnsupportedFileTypeError("El archivo no es un DOCX válido.");
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

export interface ExtractedText {
  text: string;
  /** True when the real extracted text was longer than the 6.000-char cap
   * and had to be cut — surfaced so the UI can tell the user, never silent. */
  truncated: boolean;
}

export async function extractTextFromUpload(buffer: Buffer, mimeType: string): Promise<ExtractedText> {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new UnsupportedFileTypeError(`Tipo de archivo no soportado: ${mimeType}. Solo se aceptan PDF y DOCX.`);
  }
  validateMagicBytes(buffer, mimeType);

  let rawText: string;
  try {
    if (mimeType === PDF_MIME) {
      rawText = await withTimeout(extractPdfText(buffer), EXTRACTION_TIMEOUT_MS, "Extracción de PDF");
    } else {
      const result = await withTimeout(
        mammoth.extractRawText({ buffer }),
        EXTRACTION_TIMEOUT_MS,
        "Extracción de DOCX"
      );
      rawText = result.value;
    }
  } catch (err) {
    if (err instanceof TextExtractionError) throw err;
    throw new TextExtractionError(err instanceof Error ? err.message : String(err));
  }

  const normalized = rawText.trim().replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  if (normalized.length === 0) {
    throw new TextExtractionError("No se pudo extraer texto del archivo.");
  }

  const truncated = normalized.length > MAX_EXTRACTED_TEXT_CHARS;
  const text = truncated ? normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS) : normalized;
  return { text, truncated };
}
