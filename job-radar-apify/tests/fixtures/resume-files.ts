import { crc32, deflateRawSync } from "node:zlib";

// Synthetic CV files for T-FILE (doc 09 F1–F8). Built in memory by each
// test run: no binary fixtures in the repo, no downloads, no real people.

export const SAMPLE_CV_LINES = [
  "Laura Prueba Sintetica",
  "Analista de datos en Bogota",
  "Experiencia: 3 anos con SQL, Python y Power BI en una empresa de logistica.",
  "Educacion: Ingenieria industrial, Universidad de Ejemplo."
];

function pdfString(text: string): string {
  return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

export interface PdfOptions {
  /** Text lines per page; an empty array makes a page with no text layer (scanned). */
  pages?: string[][];
  /** Extra entries for the catalog dictionary, e.g. "/OpenAction 9 0 R". */
  catalogExtra?: string;
  /** Extra objects appended as-is ("9 0 obj ... endobj"). */
  extraObjects?: string[];
  trailerExtra?: string;
}

/** A small, valid PDF 1.4 with a Helvetica text layer and a correct xref. */
export function makePdf(options: PdfOptions = {}): Buffer {
  const pages = options.pages ?? [SAMPLE_CV_LINES];
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 font, then (page, content) pairs.
  let next = 4;
  const pageObjects: string[] = [];
  for (const lines of pages) {
    const pageId = next++;
    const contentId = next++;
    pageIds.push(pageId);
    const stream = lines.length
      ? `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((line) => `${pdfString(line)} Tj T*`).join(" ")} ET`
      : "0 0 0 rg 72 72 400 600 re f"; // a filled box, like a scanned image: no text
    pageObjects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
      `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream\nendobj\n`
    );
  }
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${options.catalogExtra ?? ""}>>\nendobj\n`);
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>\nendobj\n`);
  objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`);
  objects.push(...pageObjects, ...(options.extraObjects ?? []).map((o) => `${o}\n`));

  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = new Map<number, number>();
  for (const object of objects) {
    const id = Number(/^(\d+) 0 obj/.exec(object)?.[1]);
    offsets.set(id, Buffer.byteLength(body, "latin1"));
    body += object;
  }
  const size = Math.max(...offsets.keys()) + 1;
  const xrefAt = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id++) {
    const offset = offsets.get(id);
    xref += offset === undefined ? "0000000000 65535 f \n" : `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `${xref}trailer\n<< /Size ${size} /Root 1 0 R ${options.trailerExtra ?? ""}>>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

export interface ZipFile {
  name: string;
  data: Buffer | string;
  /** Lie about the uncompressed size in the headers (ZIP-bomb variant). */
  declaredSize?: number;
  store?: boolean;
}

/** Minimal ZIP writer (deflate or store), enough for DOCX fixtures. */
export function makeZip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = typeof file.data === "string" ? Buffer.from(file.data, "utf8") : file.data;
    const compressed = file.store ? data : deflateRawSync(data);
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(data);
    const size = file.declaredSize ?? data.length;
    const method = file.store ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";
const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

export function documentXml(lines: string[], prolog = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'): string {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    prolog +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    lines.map((line) => `<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`).join("") +
    "</w:body></w:document>"
  );
}

export interface DocxOptions {
  lines?: string[];
  documentXml?: string;
  extra?: ZipFile[];
  documentRels?: string;
  contentTypes?: string;
  pages?: number;
}

export function makeDocx(options: DocxOptions = {}): Buffer {
  const files: ZipFile[] = [
    { name: "[Content_Types].xml", data: options.contentTypes ?? CONTENT_TYPES },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "word/document.xml", data: options.documentXml ?? documentXml(options.lines ?? SAMPLE_CV_LINES) }
  ];
  if (options.documentRels) files.push({ name: "word/_rels/document.xml.rels", data: options.documentRels });
  if (options.pages !== undefined) {
    files.push({ name: "docProps/app.xml", data: `<?xml version="1.0"?><Properties><Pages>${options.pages}</Pages></Properties>` });
  }
  files.push(...(options.extra ?? []));
  return makeZip(files);
}

/** Wraps one file in a multipart/form-data body. */
export function multipartBody(file: Buffer, boundary = "----rs-test-boundary", filename = "cv.pdf"): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
}

/**
 * A PDF whose page content stream is `inflatedBytes` of spaces compressed
 * with FlateDecode (a decompression bomb: tiny on disk, huge inflated).
 * Built by streaming through zlib so the test never holds the inflated data.
 */
export async function makePdfBomb(inflatedBytes: number): Promise<Buffer> {
  const { createDeflate } = await import("node:zlib");
  const deflate = createDeflate({ level: 9 });
  const parts: Buffer[] = [];
  deflate.on("data", (chunk: Buffer) => parts.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    deflate.on("end", resolve);
    deflate.on("error", reject);
  });
  const block = Buffer.alloc(1024 * 1024, 0x20);
  for (let written = 0; written < inflatedBytes; written += block.length) {
    if (!deflate.write(block)) await new Promise((resolve) => deflate.once("drain", resolve));
  }
  deflate.end();
  await done;
  const compressed = Buffer.concat(parts);
  const head = "%PDF-1.4\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n"
  ];
  const streamHead = `4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`;
  const streamTail = "\nendstream\nendobj\n";
  const offsets: number[] = [];
  let size = head.length;
  for (const object of objects) {
    offsets.push(size);
    size += object.length;
  }
  offsets.push(size);
  size += streamHead.length + compressed.length + streamTail.length;
  const xref = `xref\n0 5\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  const trailer = `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`;
  return Buffer.concat([Buffer.from(head + objects.join("") + streamHead, "latin1"), compressed, Buffer.from(streamTail + xref + trailer, "latin1")]);
}
