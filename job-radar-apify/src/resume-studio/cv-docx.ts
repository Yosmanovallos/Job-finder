import { inflateRawSync } from "node:zlib";
import {
  CV_FILE_MAX_PAGES,
  CvFileError,
  ZIP_MAX_ENTRIES,
  ZIP_MAX_ENTRY_UNCOMPRESSED,
  ZIP_MAX_TOTAL_UNCOMPRESSED,
  countLetters,
  normalizeExtractedText,
  type CvFileText
} from "./cv-file-types.ts";

// DOCX without a library (doc 06 §5, doc 08): a DOCX is a ZIP of XML parts.
// We read the ZIP central directory ourselves so every limit is ours
// (entries, per-entry and total uncompressed size, no ZIP64, no encryption),
// and we never run an XML parser: any DOCTYPE/ENTITY declaration rejects the
// file (F6, XXE), and text is pulled from <w:t> runs with a tokenizer that
// only knows the five predefined entities and numeric references.

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function readEntries(buf: Buffer): ZipEntry[] {
  // End of central directory: last 22 bytes + up to 64 KB of comment.
  const minStart = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new CvFileError("malformed");
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new CvFileError("zip_bomb"); // ZIP64
  if (total > ZIP_MAX_ENTRIES) throw new CvFileError("zip_bomb");
  if (cdOffset + cdSize > buf.length) throw new CvFileError("malformed");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) throw new CvFileError("malformed");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (flags & 0x1) throw new CvFileError("encrypted");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new CvFileError("zip_bomb");
    if (method !== 0 && method !== 8) throw new CvFileError("malformed");
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

class Inflater {
  private used = 0;
  private readonly buf: Buffer;
  constructor(buf: Buffer) {
    this.buf = buf;
  }

  read(entry: ZipEntry): Buffer {
    const p = entry.localOffset;
    if (p + 30 > this.buf.length || this.buf.readUInt32LE(p) !== LOC_SIG) throw new CvFileError("malformed");
    const start = p + 30 + this.buf.readUInt16LE(p + 26) + this.buf.readUInt16LE(p + 28);
    const end = start + entry.compressedSize;
    if (end > this.buf.length) throw new CvFileError("malformed");
    const budget = Math.min(ZIP_MAX_ENTRY_UNCOMPRESSED, ZIP_MAX_TOTAL_UNCOMPRESSED - this.used);
    // The declared size is a claim, not a limit: the inflater gets the budget
    // as a hard ceiling and the result must match the claim exactly.
    if (entry.uncompressedSize > budget) throw new CvFileError("zip_bomb");
    let out: Buffer;
    if (entry.method === 0) {
      out = this.buf.subarray(start, end);
    } else {
      try {
        out = inflateRawSync(this.buf.subarray(start, end), { maxOutputLength: Math.max(1, budget) });
      } catch (error) {
        if (error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new CvFileError("zip_bomb");
        throw new CvFileError("malformed");
      }
    }
    if (out.length !== entry.uncompressedSize) throw new CvFileError("zip_bomb");
    this.used += out.length;
    return out;
  }
}

const XML_ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return XML_ENTITY[entity.toLowerCase()] ?? match;
  });
}

/** Plain text of word/document.xml: one line per paragraph, tabs and breaks kept. */
export function documentXmlToText(xml: string): string {
  const out: string[] = [];
  const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>|<\/w:p>/g;
  let line = "";
  for (let m = token.exec(xml); m; m = token.exec(xml)) {
    const tag = m[0];
    if (m[1] !== undefined) line += decodeXmlText(m[1]);
    else if (tag.startsWith("<w:tab")) line += "\t";
    else if (tag.startsWith("<w:br") || tag.startsWith("<w:cr")) line += "\n";
    else {
      out.push(line);
      line = "";
    }
  }
  if (line) out.push(line);
  return out.join("\n");
}

const MACRO_PART = /(^|\/)vbaProject\.bin$|(^|\/)vbaData\.xml$/i;
const EMBEDDED_PART = /^word\/(embeddings|activeX)\//i;
const OLE_NAME = /(^|\/)oleObject[^/]*$/i;

export function extractDocxText(bytes: Uint8Array): CvFileText {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readEntries(buf);
  const names = new Set(entries.map((entry) => entry.name));
  if (!names.has("word/document.xml")) throw new CvFileError("unsupported_type");
  if (entries.some((entry) => entry.name.includes("..") || entry.name.startsWith("/"))) throw new CvFileError("malformed");
  if (entries.some((entry) => MACRO_PART.test(entry.name))) throw new CvFileError("macros");
  if (entries.some((entry) => EMBEDDED_PART.test(entry.name) || OLE_NAME.test(entry.name))) throw new CvFileError("embedded_objects");

  const inflater = new Inflater(buf);
  const xmlParts = new Map<string, string>();
  for (const entry of entries) {
    if (!/\.(xml|rels)$/i.test(entry.name)) continue;
    const xml = inflater.read(entry).toString("utf8");
    // F6: no DTDs at all, so there is nothing to expand or resolve.
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new CvFileError("xml_entities");
    if (entry.name.endsWith(".rels") && /TargetMode\s*=\s*["']External["']/i.test(xml)) throw new CvFileError("external_relations");
    xmlParts.set(entry.name, xml);
  }

  const contentTypes = xmlParts.get("[Content_Types].xml") ?? "";
  if (/macroEnabled|vbaProject/i.test(contentTypes)) throw new CvFileError("macros");
  const documentXml = xmlParts.get("word/document.xml") ?? "";
  if (/<w:object[\s>]|<o:OLEObject[\s>]|<w:altChunk[\s>]|<w:control[\s>]/i.test(documentXml)) throw new CvFileError("embedded_objects");

  const pagesMatch = /<Pages>\s*(\d+)\s*<\/Pages>/i.exec(xmlParts.get("docProps/app.xml") ?? "");
  const pages = pagesMatch ? Number(pagesMatch[1]) : null;
  if (pages !== null && pages > CV_FILE_MAX_PAGES) throw new CvFileError("too_many_pages");

  const { text, truncated } = normalizeExtractedText(documentXmlToText(documentXml));
  if (countLetters(text) === 0) throw new CvFileError("no_text");
  return { kind: "docx", pages, text, truncated };
}
