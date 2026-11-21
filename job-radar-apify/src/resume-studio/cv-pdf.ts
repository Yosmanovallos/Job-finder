import { constants as zlibConstants, inflateSync } from "node:zlib";
import {
  CV_FILE_MAX_PAGES,
  CV_MIN_TEXT_LETTERS,
  CvFileError,
  countLetters,
  normalizeExtractedText,
  type CvFileText
} from "./cv-file-types.ts";

// PDF text with pdf.js (pdfjs-dist, Mozilla, Apache-2.0; audit in
// openspec/changes/archive/resume-studio-r2/validation.md). Runs ONLY inside
// the parse worker (cv-parse-worker.ts), never in the server's main thread.
//
// Before pdf.js runs:
// - Decompression bomb: pdf.js inflates /FlateDecode streams into typed
//   arrays, which the worker's heap limit does NOT cap (a 400 KB PDF reached
//   +867 MB RSS before the 5 s kill). Every non-image Flate stream is inflated
//   here first against a 20 MB total budget (doc 08), and the file is
//   rejected if it goes over. Images are skipped: text extraction never
//   decodes them.
// - Active content: a byte scan (names normalized for #xx escapes) over the
//   file AND over the inflated object streams (/ObjStm), where a JavaScript
//   action can hide compressed. Then pdf.js's own catalog API checks again.

// Names that mean the document can run something or carries a file.
// /OpenAction alone is NOT here: Word and LibreOffice exports use it to set
// the initial view; an open action that is an *action* is caught below.
const ACTIVE_NAMES = /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|SubmitForm|ImportData|GoToE|XFA|AA)(?![A-Za-z0-9])/;

/** Total inflated bytes allowed across a PDF's non-image Flate streams. */
export const PDF_MAX_INFLATED_BYTES = 20 * 1024 * 1024;

function unescapeNames(text: string): string {
  return text.replace(/#([0-9a-fA-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function normalizedLatin1(bytes: Uint8Array): string {
  return unescapeNames(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1"));
}

function inspectStreams(buf: Buffer): void {
  const raw = buf.toString("latin1");
  let budget = PDF_MAX_INFLATED_BYTES;
  const marker = /stream\r?\n/g;
  for (let m = marker.exec(raw); m; m = marker.exec(raw)) {
    if (raw.slice(Math.max(0, m.index - 3), m.index) === "end") continue; // "endstream"
    const dictStart = raw.lastIndexOf("obj", m.index);
    const dict = unescapeNames(raw.slice(dictStart < 0 ? Math.max(0, m.index - 2048) : dictStart, m.index));
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    marker.lastIndex = end + "endstream".length;
    if (!/\/(FlateDecode|Fl)(?![A-Za-z])/.test(dict) || /\/Subtype\s*\/Image(?![A-Za-z])/.test(dict)) continue;
    let out: Buffer;
    try {
      out = inflateSync(buf.subarray(start, end), { maxOutputLength: Math.max(1, budget), finishFlush: zlibConstants.Z_SYNC_FLUSH });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (error instanceof RangeError || code === "ERR_BUFFER_TOO_LARGE") throw new CvFileError("zip_bomb");
      continue; // a damaged stream: pdf.js tolerates those, and so do we
    }
    budget -= out.length;
    if (budget <= 0) throw new CvFileError("zip_bomb");
    if (/\/ObjStm(?![A-Za-z])/.test(dict) && ACTIVE_NAMES.test(unescapeNames(out.toString("latin1")))) {
      throw new CvFileError("active_content");
    }
  }
}

/** Structural checks before any parsing (encryption, active content, bombs). Exported for tests. */
export function precheckPdf(bytes: Uint8Array): void {
  const raw = normalizedLatin1(bytes);
  if (/\/Encrypt(?![A-Za-z0-9])/.test(raw)) throw new CvFileError("encrypted");
  if (ACTIVE_NAMES.test(raw)) throw new CvFileError("active_content");
  inspectStreams(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

export async function extractPdfText(bytes: Uint8Array): Promise<CvFileText> {
  precheckPdf(bytes);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === "PasswordException") throw new CvFileError("encrypted");
    throw new CvFileError("malformed");
  }
  try {
    if (doc.numPages > CV_FILE_MAX_PAGES) throw new CvFileError("too_many_pages");
    if (doc.numPages < 1) throw new CvFileError("malformed");
    const [jsActions, attachments, openAction] = await Promise.all([doc.getJSActions(), doc.getAttachments(), doc.getOpenAction()]);
    if (jsActions || attachments || (openAction && (openAction as unknown as { action?: unknown }).action)) {
      throw new CvFileError("active_content");
    }
    const lines: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      if (await page.getJSActions()) throw new CvFileError("active_content");
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      if (line) lines.push(line);
      lines.push("");
    }
    const { text, truncated } = normalizeExtractedText(lines.join("\n"));
    // F8: a scanned CV has pages but no text layer. OCR is out of scope.
    if (countLetters(text) < CV_MIN_TEXT_LETTERS) throw new CvFileError("no_text");
    return { kind: "pdf", pages: doc.numPages, text, truncated };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
