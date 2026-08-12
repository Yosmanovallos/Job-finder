import type { CvTemplateSpec } from "./types.js";

/**
 * Márgenes/tamaños/espaciado más chicos que "ATS Classic" — pensado para
 * un candidato con experiencia densa que no entra cómodo en una página
 * con el espaciado por defecto. Mismo Helvetica, mismo orden de sección.
 */
export const compactTemplate: CvTemplateSpec = {
  id: "compact",
  displayName: "Compacto",
  description: "Márgenes y espaciado más ajustados — cabe más contenido por página.",
  layout: "single-column",
  typography: {
    headingFont: "Helvetica-Bold",
    bodyFont: "Helvetica",
    nameSizePt: 16,
    sectionHeadingSizePt: 10,
    bodySizePt: 9
  },
  spacing: {
    marginPt: 36,
    sectionGapPt: 0.35
  },
  colors: {
    heading: "#1a1a1a",
    body: "#000000",
    muted: "#444444",
    rule: "#cccccc"
  },
  sectionOrder: ["experience", "skills", "education", "certifications", "languages"]
};
