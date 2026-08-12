/**
 * Fase 10 de docs/RESUME-STUDIO-PLAN.md (plan aprobado 2026-08-09, §3.4) —
 * `CvTemplateSpec` declarativo. Tipos puros, sin imports de `pdfkit`/`pg`
 * — seguro de importar tanto en `render-pdf.ts` (servidor) como en
 * `CvPreview.tsx`/`TemplateGallery.tsx` (bundle del browser), mismo
 * criterio que `ai-gateway/types.ts` desde Fase 4.
 *
 * Desviación deliberada al sketch original del plan aprobado:
 * `layout` se queda en un solo valor (`"single-column"`) en vez de
 * `"single-column" | "two-column"` — un layout de dos columnas es un
 * riesgo real de parseo para sistemas ATS (texto que un parser lineal
 * lee entrelazado entre columnas, no en el orden visual), y
 * `render-pdf.ts` ya documenta "ATS-friendly by construction: single
 * column" desde antes de esta fase. Dos columnas queda fuera de v1, no
 * silenciosamente abandonado — si se retoma, es su propia fase con su
 * propia verificación de extracción de texto.
 *
 * Fuente de las 14 fuentes estándar de PDF: pdfkit no necesita embeber
 * font files para estas — cualquier lector/parser las reconoce sin
 * depender de que el archivo trajera la fuente consigo (motivo original
 * de "Helvetica" en render-pdf.ts, ahora generalizado a las 4 familias
 * estándar que de verdad sirven para un CV: Helvetica, Times, Courier no
 * aplica a texto de lectura larga).
 */
export type PdfStandardFont = "Helvetica" | "Helvetica-Bold" | "Times-Roman" | "Times-Bold";

export type CvTemplateSectionId = "experience" | "skills" | "education" | "certifications" | "languages";

export interface CvTemplateSpec {
  id: string;
  displayName: string;
  description: string;
  layout: "single-column";
  typography: {
    headingFont: PdfStandardFont;
    bodyFont: PdfStandardFont;
    nameSizePt: number;
    sectionHeadingSizePt: number;
    bodySizePt: number;
  };
  spacing: {
    marginPt: number;
    sectionGapPt: number;
  };
  colors: {
    heading: string;
    body: string;
    muted: string;
    rule: string;
  };
  /** Orden de las secciones DESPUÉS del bloque fijo de identidad
   * (nombre/contacto/titular/resumen, siempre primero — reordenar la
   * identidad de alguien no tiene sentido como "diseño"). */
  sectionOrder: CvTemplateSectionId[];
}
