// "Lo que mejoramos" on /opiniones. Only user-visible changes that shipped,
// each with the date its pull request was merged (git log of origin/main).
// Newest first; keep it short (the page shows the first 6).

export interface ChangelogEntry {
  date: string; // YYYY-MM-DD, merge date
  text: string;
}

export const SITE_CHANGELOG: ChangelogEntry[] = [
  { date: "2026-11-02", text: "Si una búsqueda no trae resultados, te sugerimos el término correcto («¿Quisiste decir…?»)." },
  { date: "2026-11-02", text: "Las ofertas de Workana se marcan como proyecto freelance y aparecen después de los empleos." },
  { date: "2026-10-31", text: "La búsqueda entiende familias de cargos: al buscar un cargo también ves sus variantes más comunes." },
  { date: "2026-10-30", text: "El botón Aplicar de las ofertas de Computrabajo te lleva directo a la oferta." },
  { date: "2026-10-28", text: "Volver a pedir el correo de registro ya no falla por exceso de intentos." },
  { date: "2026-10-27", text: "Tus vacantes guardadas y postuladas quedan en tu cuenta, y en el celular tienes la barra inferior en toda la app." }
];

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function formatChangelogDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} de ${MONTHS[(month || 1) - 1]} de ${year}`;
}
