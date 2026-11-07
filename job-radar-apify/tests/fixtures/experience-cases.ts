// Shared fixture for the "sin experiencia" classifier (seo-intent-pages
// SIP-010/011): the unit test checks classifyExperience() in memory and the
// integration test checks sqlSinExperiencia() on real Postgres, row by row.
export interface ExperienceCase {
  title: string;
  description: string | null;
  sinExperiencia: boolean;
  note: string;
}

export const EXPERIENCE_CASES: ExperienceCase[] = [
  // Positive: explicit phrases, title or description, accents and case free.
  { title: "Asesor comercial sin experiencia", description: null, sinExperiencia: true, note: "título" },
  { title: "Auxiliar de bodega", description: "No se requiere experiencia. Turnos rotativos.", sinExperiencia: true, note: "descripción" },
  { title: "Cajero(a) con o sin experiencia", description: "", sinExperiencia: true, note: "con o sin experiencia" },
  { title: "Mesero", description: "NO REQUIERE EXPERIENCIA, te capacitamos.", sinExperiencia: true, note: "mayúsculas" },
  { title: "Vendedor", description: "Ideal para tu primer empleo.", sinExperiencia: true, note: "primer empleo" },
  { title: "Operario", description: "Experiencia: no requerida.", sinExperiencia: true, note: "experiencia: no requerida" },
  { title: "Auxiliar", description: "0 años de experiencia.", sinExperiencia: true, note: "0 años" },
  { title: "Asesor SIN EXPERIENCIA PREVIA", description: null, sinExperiencia: true, note: "previa" },
  { title: "Asesor sín experiéncia", description: null, sinExperiencia: true, note: "tildes" },
  // Negative: words that may still require experience.
  { title: "Aprendiz SENA", description: "Etapa productiva.", sinExperiencia: false, note: "aprendiz solo" },
  { title: "Junior developer", description: "Primer trabajo en tecnología.", sinExperiencia: false, note: "junior solo" },
  { title: "Practicante de mercadeo", description: null, sinExperiencia: false, note: "practicante solo" },
  { title: "Analista", description: "Experiencia mínima de 1 año.", sinExperiencia: false, note: "mínimo 1 año" },
  { title: "Analista sin experiencia en Python", description: "Requisitos: 3 años de experiencia en SQL.", sinExperiencia: false, note: "exclusión por años" },
  { title: "Asesor con o sin experiencia", description: "Deseable 6 meses de experiencia en ventas.", sinExperiencia: false, note: "exclusión por meses" },
  { title: "Asesor sin experiencia", description: "Mínimo 2+ años de experiencia.", sinExperiencia: false, note: "2+ años" },
  { title: "Gerente", description: "10 años de experiencia liderando equipos.", sinExperiencia: false, note: "10 años" },
  { title: "Persona sinexperiencia", description: null, sinExperiencia: false, note: "palabra completa" },
  { title: "Analista", description: "Experiencia en Excel.", sinExperiencia: false, note: "sin frase" },
  { title: "Auxiliar", description: null, sinExperiencia: false, note: "sin descripción" }
];
