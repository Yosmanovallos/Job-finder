import type { CvDocument } from "../cv/cv-document-schema.js";
import type { CvFacts } from "../cv/cv-facts-schema.js";
import { resolveCvDocumentForRender } from "../cv/resolve-document.js";
import type { CvTemplateSpec, CvTemplateSectionId, PdfStandardFont } from "../cv/templates/types.js";

/**
 * Fase 7 de docs/RESUME-STUDIO-PLAN.md (plan aprobado 2026-08-09, §3.4) —
 * preview en vivo HTML/CSS, nunca un viaje de ida y vuelta por PDF (sería
 * lento y una dependencia nueva pesada, ver riesgos del plan aprobado).
 * Reusa `resolveCvDocumentForRender` sin tocarlo — la misma función que ya
 * alimenta `render-pdf.ts`/`render-docx.ts`, así que el preview y los
 * archivos descargados nunca pueden divergir en QUÉ datos muestran.
 * `resolve-document.ts` solo importa tipos de `zod` (`import type`), así
 * que esto es seguro de importar en el bundle del browser.
 *
 * Fase 10: `template` ahora maneja tipografía/color/espaciado/orden de
 * sección — la misma fuente de la verdad que `render-pdf.ts` (§3.4:
 * "un mismo CvTemplateSpec alimenta preview y PDF"). Los estilos EXACTOS
 * no son idénticos pixel-por-pixel (HTML/CSS vs pdfkit son motores de
 * layout distintos), pero la fuente/color/orden de sección coinciden.
 */

// pdfkit solo conoce 4 nombres literales — CSS necesita un stack real con
// fallbacks del sistema para que se vea igual en cualquier navegador.
const FONT_FAMILY: Record<PdfStandardFont, string> = {
  Helvetica: "Helvetica, Arial, sans-serif",
  "Helvetica-Bold": "Helvetica, Arial, sans-serif",
  "Times-Roman": "Georgia, 'Times New Roman', serif",
  "Times-Bold": "Georgia, 'Times New Roman', serif"
};
const FONT_WEIGHT: Record<PdfStandardFont, number> = {
  Helvetica: 400,
  "Helvetica-Bold": 700,
  "Times-Roman": 400,
  "Times-Bold": 700
};

export interface CvPreviewProps {
  document: CvDocument;
  facts: CvFacts;
  template: CvTemplateSpec;
}

export function CvPreview({ document, facts, template: t }: CvPreviewProps) {
  const cv = resolveCvDocumentForRender(document, facts);
  const headingFamily = FONT_FAMILY[t.typography.headingFont];
  const headingWeight = FONT_WEIGHT[t.typography.headingFont];
  const bodyFamily = FONT_FAMILY[t.typography.bodyFont];

  const sections: Record<CvTemplateSectionId, React.ReactNode> = {
    experience: cv.experience.length > 0 && (
      <PreviewSection key="experience" title={cv.language === "en" ? "Experience" : "Experiencia"} t={t}>
        {cv.experience.map((exp, i) => (
          <div key={i} style={{ marginBottom: i < cv.experience.length - 1 ? "5mm" : 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "4mm" }}>
              <p style={{ fontWeight: headingWeight, margin: 0, color: t.colors.heading }}>
                {exp.title} — {exp.company}
              </p>
              <p style={{ margin: 0, color: t.colors.muted, whiteSpace: "nowrap", fontSize: "9pt" }}>
                {exp.startDate ?? "?"} – {exp.endDate ?? (cv.language === "en" ? "Present" : "Actual")}
              </p>
            </div>
            {exp.bullets.length > 0 && (
              <ul style={{ margin: "1.5mm 0 0", paddingLeft: "5mm" }}>
                {exp.bullets.map((b, bi) => (
                  <li key={bi} style={{ marginBottom: "0.8mm" }}>
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </PreviewSection>
    ),
    skills: cv.skills.length > 0 && (
      <PreviewSection key="skills" title={cv.language === "en" ? "Skills" : "Habilidades"} t={t}>
        <p style={{ margin: 0 }}>{cv.skills.join(" · ")}</p>
      </PreviewSection>
    ),
    education: cv.education.length > 0 && (
      <PreviewSection key="education" title={cv.language === "en" ? "Education" : "Educación"} t={t}>
        {cv.education.map((e, i) => (
          <p key={i} style={{ margin: 0 }}>
            {e.degree} — {e.institution}
            {e.endDate ? ` (${e.endDate})` : ""}
          </p>
        ))}
      </PreviewSection>
    ),
    certifications: cv.certifications.length > 0 && (
      <PreviewSection key="certifications" title={cv.language === "en" ? "Certifications" : "Certificaciones"} t={t}>
        {cv.certifications.map((c, i) => (
          <p key={i} style={{ margin: 0 }}>
            {c.name}
            {c.issuer ? ` — ${c.issuer}` : ""}
            {c.date ? ` (${c.date})` : ""}
          </p>
        ))}
      </PreviewSection>
    ),
    languages: cv.languages.length > 0 && (
      <PreviewSection key="languages" title={cv.language === "en" ? "Languages" : "Idiomas"} t={t}>
        <p style={{ margin: 0 }}>
          {cv.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(" · ")}
        </p>
      </PreviewSection>
    )
  };

  return (
    <div
      className="mx-auto bg-white shadow-lg"
      style={{
        width: "210mm",
        minHeight: "297mm",
        padding: `${t.spacing.marginPt / 2.83}mm ${(t.spacing.marginPt / 2.83) * 1.1}mm`,
        fontFamily: bodyFamily,
        fontSize: `${t.typography.bodySizePt}pt`,
        lineHeight: 1.45,
        color: t.colors.body
      }}
    >
      <header style={{ marginBottom: "10mm" }}>
        <h1
          style={{
            fontSize: `${t.typography.nameSizePt}pt`,
            fontWeight: headingWeight,
            fontFamily: headingFamily,
            margin: 0,
            color: t.colors.heading
          }}
        >
          {cv.contact.name}
        </h1>
        {cv.headline && (
          <p style={{ fontSize: "11pt", color: t.colors.heading, margin: "2mm 0 0" }}>{cv.headline}</p>
        )}
        <p style={{ fontSize: "9pt", color: t.colors.muted, margin: "3mm 0 0" }}>
          {[cv.contact.email, cv.contact.phone, cv.contact.location, cv.contact.linkedin]
            .filter(Boolean)
            .join("  ·  ")}
        </p>
      </header>

      {cv.summary && <p style={{ margin: "0 0 6mm" }}>{cv.summary}</p>}

      {t.sectionOrder.map((id) => sections[id])}
    </div>
  );
}

function PreviewSection({ title, children, t }: { title: string; children: React.ReactNode; t: CvTemplateSpec }) {
  return (
    <section style={{ marginBottom: "6mm" }}>
      <h2
        style={{
          fontSize: `${t.typography.sectionHeadingSizePt}pt`,
          fontWeight: FONT_WEIGHT[t.typography.headingFont],
          fontFamily: FONT_FAMILY[t.typography.headingFont],
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          borderBottom: `0.4mm solid ${t.colors.rule}`,
          paddingBottom: "1mm",
          marginBottom: "2.5mm",
          color: t.colors.heading
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
