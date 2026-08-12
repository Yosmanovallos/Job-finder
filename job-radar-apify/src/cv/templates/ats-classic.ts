import type { CvTemplateSpec } from "./types.js";

/**
 * Default de siempre — EXACTAMENTE los valores que `render-pdf.ts` traía
 * hardcodeados antes de la Fase 10 (MARGIN=50, Helvetica, mismos
 * tamaños/colores/orden de sección). Ninguna generación vieja cambia de
 * apariencia al desplegar esta fase — `cv_generations.template_id`
 * default es literalmente `"ats_classic"` (ver schema.sql).
 */
export const atsClassicTemplate: CvTemplateSpec = {
  id: "ats_classic",
  displayName: "ATS Classic",
  description: "El formato de siempre — máxima compatibilidad con sistemas ATS, sin adornos.",
  layout: "single-column",
  typography: {
    headingFont: "Helvetica-Bold",
    bodyFont: "Helvetica",
    nameSizePt: 20,
    sectionHeadingSizePt: 11,
    bodySizePt: 10
  },
  spacing: {
    marginPt: 50,
    sectionGapPt: 0.6
  },
  colors: {
    heading: "#1a1a1a",
    body: "#000000",
    muted: "#444444",
    rule: "#cccccc"
  },
  sectionOrder: ["experience", "skills", "education", "certifications", "languages"]
};
