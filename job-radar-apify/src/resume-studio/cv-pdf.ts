import {
  CV_FILE_MAX_PAGES,
  CV_MIN_TEXT_LETTERS,
  CvFileError,
  countLetters,
  normalizeExtractedText,
  type CvFileText
} from "./cv-file-types.ts";

// PDF text with pdf.js (pdfjs-dist, Mozilla, Apache-2.0; audit in
// openspec/changes/resume-studio-r2/validation.md). Runs ONLY inside the
// parse worker (cv-parse-worker.ts), never in the server's main thread.
//
// Two layers of active-content checks: a raw-byte scan (names normalized
// for #xx escapes) catches the plain cases cheaply before pdf.js runs, and
// pdf.js's own catalog API sees dictionaries hidden inside compressed object
// streams, which a byte scan can't.

// Names that mean the document can run something or carries a file.
// /OpenAction alone is NOT here: Word and LibreOffice exports use it to set
// the initial view; an open action that is an *action* is caught below.
const ACTIVE_NAMES = /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|SubmitForm|ImportData|GoToE|XFA|AA)(?![A-Za-z0-9])/;

function normalizedLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .toString("latin1")
    .replace(/#([0-9a-fA-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Cheap structural checks before any parsing. Exported for tests. */
export function precheckPdf(bytes: Uint8Array): void {
  const raw = normalizedLatin1(bytes);
  if (/\/Encrypt(?![A-Za-z0-9])/.test(raw)) throw new CvFileError("encrypted");
  if (ACTIVE_NAMES.test(raw)) throw new CvFileError("active_content");
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
