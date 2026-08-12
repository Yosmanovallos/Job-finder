import PDFDocument from "pdfkit";
import type { CvFacts } from "./cv-facts-schema.js";
import type { CvDocument } from "./cv-document-schema.js";
import { resolveCvDocumentForRender, type ResolvedCv } from "./resolve-document.js";
import type { CvTemplateSpec, CvTemplateSectionId } from "./templates/types.js";
import { getTemplate } from "./templates/registry.js";

/**
 * Etapa F, PDF (docs/CV-GENERATION-PLAN.md §4) — pure function, zero LLM
 * cost, deterministic. ATS-friendly by construction: single column, no
 * tables/images, one of the 14 standard PDF fonts so no font embedding is
 * needed and every ATS parser recognizes it. Runs on-demand every time
 * the user downloads, not once per generation.
 *
 * Fase 10 de docs/RESUME-STUDIO-PLAN.md: reescrito para leer todo
 * tipografía/espaciado/colores/orden de sección de un `CvTemplateSpec`
 * en vez de las constantes hardcodeadas de antes. Sin `template`, resuelve
 * al mismo default (`ats_classic`) que ya tenía este archivo — cero
 * cambio de output para cualquier caller que no pase el parámetro nuevo.
 * Esta función NO importa nada de `cv/model-gateway.js`/`ai-gateway/*` —
 * cambiar de plantilla nunca puede disparar el pipeline de IA, verificable
 * con un grep, no solo declarado.
 */
export async function renderCvToPdf(document: CvDocument, facts: CvFacts, template?: CvTemplateSpec): Promise<Buffer> {
  const t = template ?? getTemplate("ats_classic");
  const cv = resolveCvDocumentForRender(document, facts);
  const doc = new PDFDocument({ margin: t.spacing.marginPt, size: "LETTER" });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  doc.font(t.typography.headingFont).fontSize(t.typography.nameSizePt).fillColor(t.colors.heading).text(cv.contact.name);
  doc.fillColor(t.colors.body);
  const contactLine = [cv.contact.email, cv.contact.phone, cv.contact.location, cv.contact.linkedin]
    .filter((v): v is string => !!v)
    .join("  ·  ");
  if (contactLine) {
    doc.font(t.typography.bodyFont).fontSize(9).fillColor(t.colors.muted).text(contactLine);
    doc.fillColor(t.colors.body);
  }
  doc.moveDown(0.5);

  doc.font(t.typography.headingFont).fontSize(13).fillColor(t.colors.heading).text(cv.headline);
  doc.fillColor(t.colors.body);
  doc.moveDown(0.3);
  doc.font(t.typography.bodyFont).fontSize(t.typography.bodySizePt).text(cv.summary, { align: "left" });
  doc.moveDown(0.8);

  const renderers: Record<CvTemplateSectionId, () => void> = {
    experience: () => renderExperience(doc, t, cv),
    skills: () => renderSkills(doc, t, cv),
    education: () => renderEducation(doc, t, cv),
    certifications: () => renderCertifications(doc, t, cv),
    languages: () => renderLanguages(doc, t, cv)
  };
  for (const sectionId of t.sectionOrder) {
    renderers[sectionId]();
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

function renderExperience(doc: PDFKit.PDFDocument, t: CvTemplateSpec, cv: ResolvedCv): void {
  if (cv.experience.length === 0) return;
  section(doc, t, cv.language === "en" ? "EXPERIENCE" : "EXPERIENCIA");
  for (const exp of cv.experience) {
    doc.font(t.typography.headingFont).fontSize(11).fillColor(t.colors.heading).text(exp.title);
    doc.fillColor(t.colors.body);
    const dateRange = `${exp.startDate ?? "?"} – ${exp.endDate ?? (cv.language === "en" ? "Present" : "Actual")}`;
    doc.font(t.typography.bodyFont).fontSize(t.typography.bodySizePt).text(`${exp.company}  ·  ${dateRange}`, { continued: false });
    doc.moveDown(0.2);
    for (const bullet of exp.bullets) {
      doc.font(t.typography.bodyFont).fontSize(t.typography.bodySizePt).text(`•  ${bullet}`, { indent: 10 });
    }
    doc.moveDown(0.5);
  }
}

function renderSkills(doc: PDFKit.PDFDocument, t: CvTemplateSpec, cv: ResolvedCv): void {
  if (cv.skills.length === 0) return;
  section(doc, t, cv.language === "en" ? "SKILLS" : "HABILIDADES");
  doc.font(t.typography.bodyFont).fontSize(t.typography.bodySizePt).text(cv.skills.join(", "));
  doc.moveDown(t.spacing.sectionGapPt);
}

function renderEducation(doc: PDFKit.PDFDocument, t: CvTemplateSpec, cv: ResolvedCv): void {
  if (cv.education.length === 0) return;
  section(doc, t, cv.language === "en" ? "EDUCATION" : "EDUCACIÓN");
  for (const edu of cv.education) {
    doc.font(t.typography.headingFont).fontSize(t.typography.bodySizePt).fillColor(t.colors.heading).text(`${edu.institution} — ${edu.degree}`);
    doc.fillColor(t.colors.body);
    if (edu.endDate) doc.font(t.typography.bodyFont).fontSize(9).fillColor(t.colors.muted).text(edu.endDate).fillColor(t.colors.body);
  }
  doc.moveDown(t.spacing.sectionGapPt);
}

function renderCertifications(doc: PDFKit.PDFDocument, t: CvTemplateSpec, cv: ResolvedCv): void {
  if (cv.certifications.length === 0) return;
  section(doc, t, cv.language === "en" ? "CERTIFICATIONS" : "CERTIFICACIONES");
  for (const cert of cv.certifications) {
    const line = [cert.name, cert.issuer, cert.date].filter(Boolean).join(" — ");
    doc.font(t.typography.bodyFont).fontSize(t.typography.bodySizePt).text(line);
  }
  doc.moveDown(t.spacing.sectionGapPt);
}

function renderLanguages(doc: PDFKit.PDFDocument, t: CvTemplateSpec, cv: ResolvedCv): void {
  if (cv.languages.length === 0) return;
  section(doc, t, cv.language === "en" ? "LANGUAGES" : "IDIOMAS");
  doc
    .font(t.typography.bodyFont)
    .fontSize(t.typography.bodySizePt)
    .text(cv.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(", "));
}

function section(doc: PDFKit.PDFDocument, t: CvTemplateSpec, title: string): void {
  doc.font(t.typography.headingFont).fontSize(t.typography.sectionHeadingSizePt).fillColor(t.colors.heading).text(title);
  doc
    .moveTo(doc.x, doc.y)
    .lineTo(doc.page.width - t.spacing.marginPt, doc.y)
    .strokeColor(t.colors.rule)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.3);
  doc.fillColor(t.colors.body);
}
