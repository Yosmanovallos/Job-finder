import type { CvTemplateSpec } from "./types.js";

/**
 * Times-Roman/Times-Bold (una de las 14 fuentes estándar de PDF, igual
 * de segura para ATS que Helvetica) — el registro serif que suele leerse
 * como más formal/senior. Único template que reordena las secciones:
 * Educación y Certificaciones suben antes que Habilidades — perfil
 * pensado para roles donde las credenciales pesan más que una lista de
 * herramientas.
 */
export const executiveTemplate: CvTemplateSpec = {
  id: "executive",
  displayName: "Ejecutivo",
  description: "Tipografía serif formal, credenciales antes que habilidades.",
  layout: "single-column",
  typography: {
    headingFont: "Times-Bold",
    bodyFont: "Times-Roman",
    nameSizePt: 22,
    sectionHeadingSizePt: 12,
    bodySizePt: 10.5
  },
  spacing: {
    marginPt: 54,
    sectionGapPt: 0.7
  },
  colors: {
    heading: "#111111",
    body: "#111111",
    muted: "#555555",
    rule: "#999999"
  },
  sectionOrder: ["experience", "education", "certifications", "skills", "languages"]
};
