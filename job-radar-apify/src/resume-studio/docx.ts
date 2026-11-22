import { formatResumeMonth, formatResumeRange, type ResumeFacts, type ResumeTemplateId } from "../lib/resume-studio.js";

// AI Resume Studio R4: clean DOCX for pass holders (doc 06 §6). Built on the
// server with no new dependency (R2 blocked native modules): a STORED zip
// (no compression) holding the three parts Word needs. Every user string is
// XML-escaped and stripped of characters XML 1.0 forbids, so CV text can
// never inject markup. Same sections and order as ResumeTemplate.tsx.

const FONTS: Record<ResumeTemplateId, { font: string; size: number }> = {
  clasica: { font: "Georgia", size: 22 },
  moderna: { font: "Arial", size: 21 },
  compacta: { font: "Arial", size: 19 }
};

// eslint-disable-next-line no-control-regex
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function xmlEscape(value: string): string {
  return value
    .replace(XML_FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Run {
  text: string;
  bold?: boolean;
  size?: number;
  color?: string;
}

function run(r: Run): string {
  const props = `${r.bold ? "<w:b/>" : ""}${r.color ? `<w:color w:val="${r.color}"/>` : ""}${r.size ? `<w:sz w:val="${r.size}"/>` : ""}`;
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEscape(r.text)}</w:t></w:r>`;
}

function paragraph(runs: Run[], opts: { center?: boolean; indent?: number; before?: number; after?: number; rule?: boolean } = {}): string {
  const ppr = [
    opts.rule ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="1D1F1E"/></w:pBdr>` : "",
    `<w:spacing w:before="${opts.before ?? 0}" w:after="${opts.after ?? 40}"/>`,
    opts.indent ? `<w:ind w:left="${opts.indent}" w:hanging="200"/>` : "",
    opts.center ? `<w:jc w:val="center"/>` : ""
  ].join("");
  return `<w:p><w:pPr>${ppr}</w:pPr>${runs.filter((r) => r.text).map(run).join("")}</w:p>`;
}

const joined = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(" · ");

export function buildResumeDocumentXml(facts: ResumeFacts, templateId: ResumeTemplateId): string {
  const { size } = FONTS[templateId];
  const center = templateId === "clasica";
  const accent = templateId === "moderna" ? "1F7A4D" : undefined;
  const body: string[] = [];
  const section = (title: string) => body.push(paragraph([{ text: title.toUpperCase(), bold: true, color: accent }], { before: 240, after: 80, rule: templateId === "clasica" }));

  const b = facts.basics;
  body.push(paragraph([{ text: b.fullName || "Tu nombre", bold: true, size: size + 30 }], { center }));
  if (b.headline.trim()) body.push(paragraph([{ text: b.headline, color: accent }], { center }));
  const contact = joined(b.email, b.phone, b.city, ...b.links);
  if (contact) body.push(paragraph([{ text: contact, size: size - 2 }], { center }));

  if (facts.summary.trim()) {
    section("Perfil");
    for (const line of facts.summary.split(/\r?\n/).filter((l) => l.trim())) body.push(paragraph([{ text: line }]));
  }
  if (facts.experience.length) {
    section("Experiencia");
    for (const item of facts.experience) {
      body.push(paragraph([{ text: item.role || "Cargo", bold: true }, { text: item.company ? ` · ${item.company}` : "" }], { before: 80 }));
      const meta = joined(formatResumeRange(item.startDate, item.endDate, item.current), item.city);
      if (meta) body.push(paragraph([{ text: meta, size: size - 2 }]));
      for (const bullet of item.bullets.filter((x) => x.text.trim())) body.push(paragraph([{ text: `•  ${bullet.text}` }], { indent: 360 }));
    }
  }
  if (facts.education.length) {
    section("Formación");
    for (const item of facts.education) {
      body.push(paragraph([{ text: item.degree || "Título", bold: true }, { text: item.institution ? ` · ${item.institution}` : "" }], { before: 60 }));
      const meta = joined(formatResumeRange(item.startDate, item.endDate), item.city);
      if (meta) body.push(paragraph([{ text: meta, size: size - 2 }]));
    }
  }
  if (facts.certifications.length) {
    section("Cursos y certificaciones");
    for (const item of facts.certifications) {
      const meta = joined(item.issuer, formatResumeMonth(item.date));
      body.push(paragraph([{ text: item.name, bold: true }, { text: meta ? ` · ${meta}` : "", size: size - 2 }]));
    }
  }
  const skills = facts.skills.map((s) => s.name.trim()).filter(Boolean);
  if (skills.length) {
    section("Habilidades");
    body.push(paragraph([{ text: skills.join(" · ") }]));
  }
  const languages = facts.languages.filter((l) => l.name.trim());
  if (languages.length) {
    section("Idiomas");
    body.push(paragraph([{ text: languages.map((l) => joined(l.name, l.level)).join(" — ") }]));
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    body.join("") +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`
  );
}

function stylesXml(templateId: ResumeTemplateId): string {
  const { font, size } = FONTS[templateId];
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="${size}"/><w:lang w:val="es-CO"/></w:rPr></w:rPrDefault></w:docDefaults>` +
    `</w:styles>`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const DOCUMENT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal STORED zip (method 0), fixed DOS date 1980-01-01 so output is deterministic. */
export function storedZip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + file.data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function buildResumeDocx(facts: ResumeFacts, templateId: ResumeTemplateId): Buffer {
  return storedZip([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS, "utf8") },
    { name: "word/document.xml", data: Buffer.from(buildResumeDocumentXml(facts, templateId), "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(DOCUMENT_RELS, "utf8") },
    { name: "word/styles.xml", data: Buffer.from(stylesXml(templateId), "utf8") }
  ]);
}
