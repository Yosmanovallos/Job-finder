import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import type { CvFacts } from "./cv-facts-schema.js";
import type { CvDocument } from "./cv-document-schema.js";
import { resolveCvDocumentForRender } from "./resolve-document.js";

/**
 * Etapa F, DOCX (docs/CV-GENERATION-PLAN.md §4) — same content as
 * render-pdf.ts, same ATS-friendly constraints (single column, no
 * tables), built with the `docx` package instead of manual OOXML. Pure
 * function, zero LLM cost, on-demand.
 */

const GRAY = "444444";

export async function renderCvToDocx(document: CvDocument, facts: CvFacts): Promise<Buffer> {
  const cv = resolveCvDocumentForRender(document, facts);
  const isEn = cv.language === "en";
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({ children: [new TextRun({ text: cv.contact.name, bold: true, size: 32 })] })
  );
  const contactLine = [cv.contact.email, cv.contact.phone, cv.contact.location, cv.contact.linkedin]
    .filter((v): v is string => !!v)
    .join("  ·  ");
  if (contactLine) {
    children.push(new Paragraph({ children: [new TextRun({ text: contactLine, size: 18, color: GRAY })] }));
  }

  children.push(new Paragraph({ children: [new TextRun({ text: cv.headline, bold: true, size: 26 })], spacing: { before: 200 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: cv.summary, size: 20 })], spacing: { after: 200 } }));

  if (cv.experience.length > 0) {
    children.push(sectionHeading(isEn ? "EXPERIENCE" : "EXPERIENCIA"));
    for (const exp of cv.experience) {
      children.push(new Paragraph({ children: [new TextRun({ text: exp.title, bold: true, size: 22 })] }));
      const dateRange = `${exp.startDate ?? "?"} – ${exp.endDate ?? (isEn ? "Present" : "Actual")}`;
      children.push(new Paragraph({ children: [new TextRun({ text: `${exp.company}  ·  ${dateRange}`, size: 20 })] }));
      for (const bullet of exp.bullets) {
        children.push(new Paragraph({ children: [new TextRun({ text: `•  ${bullet}`, size: 20 })], indent: { left: 200 } }));
      }
      children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
    }
  }

  if (cv.skills.length > 0) {
    children.push(sectionHeading(isEn ? "SKILLS" : "HABILIDADES"));
    children.push(new Paragraph({ children: [new TextRun({ text: cv.skills.join(", "), size: 20 })], spacing: { after: 200 } }));
  }

  if (cv.education.length > 0) {
    children.push(sectionHeading(isEn ? "EDUCATION" : "EDUCACIÓN"));
    for (const edu of cv.education) {
      children.push(new Paragraph({ children: [new TextRun({ text: `${edu.institution} — ${edu.degree}`, bold: true, size: 20 })] }));
      if (edu.endDate) children.push(new Paragraph({ children: [new TextRun({ text: edu.endDate, size: 18, color: GRAY })] }));
    }
    children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
  }

  if (cv.certifications.length > 0) {
    children.push(sectionHeading(isEn ? "CERTIFICATIONS" : "CERTIFICACIONES"));
    for (const cert of cv.certifications) {
      const line = [cert.name, cert.issuer, cert.date].filter(Boolean).join(" — ");
      children.push(new Paragraph({ children: [new TextRun({ text: line, size: 20 })] }));
    }
    children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
  }

  if (cv.languages.length > 0) {
    children.push(sectionHeading(isEn ? "LANGUAGES" : "IDIOMAS"));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: cv.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(", "), size: 20 })]
      })
    );
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

function sectionHeading(title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    alignment: AlignmentType.LEFT,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text: title, bold: true, size: 22 })]
  });
}
