// "Lo que mejoramos" on /opiniones. Only user-visible changes that shipped,
// each with the date its pull request was merged (git log of origin/main).
// Public copy: general wording only — no portal or company names, no
// internals, nothing about security, data or incidents.
// Newest first; keep it short (the page shows the first 6).

export interface ChangelogEntry {
  date: string; // YYYY-MM-DD, merge date
  text: string;
}

export const SITE_CHANGELOG: ChangelogEntry[] = [
  { date: "2026-11-02", text: "Si una búsqueda no trae resultados, te sugerimos un término parecido." },
  { date: "2026-11-02", text: "Los proyectos freelance se distinguen de los empleos y aparecen después." },
  { date: "2026-10-31", text: "La búsqueda también encuentra las variantes más comunes del cargo que escribes." },
  { date: "2026-10-30", text: "Más botones de Aplicar te llevan directo a la oferta original." },
  { date: "2026-10-27", text: "Tus vacantes guardadas y postuladas quedan en tu cuenta." },
  { date: "2026-10-27", text: "Navegación más cómoda en el celular, con barra inferior en toda la app." }
];

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function formatChangelogDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} de ${MONTHS[(month || 1) - 1]} de ${year}`;
}
