// Which sources' employment type ("Tiempo completo", "Medio tiempo"...) can be
// shown and emitted as JobPosting.employmentType
// (openspec/changes/employment-type-trust, design D1): Magneto and Elempleo.
//
// Magneto's JobPosting JSON-LD fills employmentType from the CONTRACT TERM,
// not the working hours. Checked on 9 public posting pages (2026-11-07,
// validation.md §2): every "Por obra o labor" posting says PART_TIME (a
// 9 a. m.–8 p. m. warehouse job, a forklift operator, a C3 driver), every
// "Término indefinido" says FULL_TIME (including "Vendedor 6 horas") and
// "Temporal" says TEMPORARY. None of those values describe the schedule, so
// all of them are dropped for Magneto, never re-guessed from the title.
//
// Elempleo does the same (12 of 12 pages, validation.md §2): "Por obra o
// labor" -> PER_DIEM, "Definido" -> TEMPORARY, "Indefinido" -> FULL_TIME,
// while its own visible "Jornada laboral" says "Tiempo completo".
//
// Computrabajo's value matched its visible "Tiempo Completo" jornada on 10 of
// 10 pages and stays. The raw value is kept in jobs.employment_type (no data
// is destroyed); only what we show and emit is filtered.
const UNRELIABLE_EMPLOYMENT_TYPE_SOURCES: ReadonlySet<string> = new Set(["Magneto", "Elempleo"]);

/** The source-stated employment type when that source's value means the schedule, else undefined. */
export function trustedEmploymentType(source: unknown, employmentType: unknown): string | undefined {
  if (typeof employmentType !== "string" || !employmentType.trim()) return undefined;
  if (typeof source === "string" && UNRELIABLE_EMPLOYMENT_TYPE_SOURCES.has(source.trim())) return undefined;
  return employmentType;
}
