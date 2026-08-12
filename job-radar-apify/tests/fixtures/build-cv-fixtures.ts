import zlib from "node:zlib";

/**
 * Builders for FICTIONAL CV fixtures used only by
 * tests/validate-cv-profile-upload.ts (Fase 2a). The name, employer and
 * dates below are invented for this test — they do not belong to any real
 * person (docs/CV-GENERATION-PLAN.md exit criteria for Fase 2 requires an
 * explicitly-marked fictional fixture, never a real CV committed to the
 * repo). Both builders hand-roll the minimal valid file format (a bare
 * WordprocessingML zip / a bare PDF with one content stream) instead of
 * pulling in an authoring dependency just for tests.
 */

export const FICTIONAL_CV_LINES = [
  "Nombre Ficticio Apellido Ficticio - CV DE PRUEBA (dato inventado para tests, no una persona real)",
  "Desarrollador de Software Ficticio",
  "Empresa Inventada S.A.S. (2020-2023)",
  "Construyo sistemas de prueba que no existen."
];

/** Minimal store-mode (uncompressed) ZIP writer — just enough for a
 * one-entry `word/document.xml` docx that mammoth can read (its reader
 * falls back to that fixed path when no `_rels/.rels`/`[Content_Types].xml`
 * are present, verified against node_modules/mammoth/lib/docx/docx-reader.js). */
function buildMinimalZip(entries: { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  }

  const centralStart = offset;
  const central = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, eocd]);
}

export function buildFictionalCvDocx(lines: string[] = FICTIONAL_CV_LINES): Buffer {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = lines.map((line) => `<w:p><w:r><w:t>${escape(line)}</w:t></w:r></w:p>`).join("");
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${paragraphs}</w:body></w:document>`;
  return buildMinimalZip([{ name: "word/document.xml", data: Buffer.from(documentXml, "utf8") }]);
}

/** Minimal single-page PDF (one Type1/Helvetica content stream) — enough
 * for pdf-parse's text extraction, no images/fonts subsetting involved. */
export function buildFictionalCvPdf(lines: string[] = FICTIONAL_CV_LINES): Buffer {
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const contentStream = lines
    .map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 20} Td (${escape(line)}) Tj ET`)
    .join("\n");

  const objects: Record<number, string> = {
    1: `<< /Type /Catalog /Pages 2 0 R >>`,
    2: `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    3: `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>`,
    4: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    5: `<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream`
  };

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf, "utf8");
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}
