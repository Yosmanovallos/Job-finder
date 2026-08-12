import type { CvTemplateSpec } from "./types.js";

/**
 * Mismo Helvetica que "ATS Classic" (ningún template sacrifica
 * compatibilidad ATS por estilo — esa es una de las 14 fuentes estándar
 * de PDF en cualquier caso) — la diferencia es puramente de color:
 * títulos de sección y la línea divisoria toman el verde de marca de
 * BuscoTrabajo.co (`--primary: 160 75% 24%` en index.css, convertido a
 * hex) en vez de gris neutro.
 */
export const modernTemplate: CvTemplateSpec = {
  id: "modern",
  displayName: "Moderno",
  description: "Los mismos datos, con un acento de color en los títulos de sección.",
  layout: "single-column",
  typography: {
    headingFont: "Helvetica-Bold",
    bodyFont: "Helvetica",
    nameSizePt: 22,
    sectionHeadingSizePt: 11,
    bodySizePt: 10
  },
  spacing: {
    marginPt: 50,
    sectionGapPt: 0.6
  },
  colors: {
    heading: "#0f6b4c",
    body: "#000000",
    muted: "#444444",
    rule: "#0f6b4c"
  },
  sectionOrder: ["experience", "skills", "education", "certifications", "languages"]
};
