// Shared fixture for the schedule classifier (seo-intent-wave2 SIW-010/011):
// the unit test checks matchesSchedule() in memory and the seo integration
// test checks sqlSchedule() on real Postgres, row by row. Titles taken from
// the shapes seen in the 2026-11-07 production sample (validation.md §1).
import type { ScheduleIntent } from "../../src/lib/job-schedule.js";

export interface ScheduleCase {
  title: string;
  description: string | null;
  employmentType: string | null;
  expected: ScheduleIntent[];
  note: string;
}

export const SCHEDULE_CASES: ScheduleCase[] = [
  { title: "Mesero fines de semana", description: null, employmentType: null, expected: ["fines-de-semana"], note: "título" },
  { title: "Cajero fin de semana", description: null, employmentType: "Tiempo completo", expected: ["fines-de-semana"], note: "singular" },
  { title: "Promotor(a) de Ventas (Fines De Semana)", description: null, employmentType: null, expected: ["fines-de-semana"], note: "paréntesis y mayúsculas" },
  { title: "Auxiliar sábados y domingos", description: null, employmentType: null, expected: ["fines-de-semana"], note: "tildes" },
  { title: "Remote Weekend Support", description: null, employmentType: null, expected: ["fines-de-semana"], note: "inglés" },
  { title: "Analista, lunes a viernes, fines de semana libres", description: null, employmentType: null, expected: [], note: "negación" },
  {
    title: "Asesor comercial",
    description: "Disponibilidad para laborar fines de semana y festivos.",
    employmentType: "Tiempo completo",
    expected: [],
    note: "descripción no cuenta"
  },
  { title: "Auxiliar de tienda medio tiempo", description: null, employmentType: null, expected: ["medio-tiempo"], note: "medio tiempo" },
  { title: "Cajero part-time", description: null, employmentType: null, expected: ["medio-tiempo"], note: "part-time con guion" },
  { title: "Docente tiempo parcial", description: null, employmentType: null, expected: ["medio-tiempo"], note: "tiempo parcial" },
  { title: "Guardia de seguridad", description: null, employmentType: "Medio tiempo", expected: [], note: "employment_type no cuenta" },
  { title: "Mensajero tiempo completo", description: "Jornada de medio tiempo los sábados.", employmentType: null, expected: [], note: "descripción no cuenta" },
  { title: "Asesor, no es medio tiempo", description: null, employmentType: null, expected: [], note: "negación" },
  { title: "Impulsadora temporada navideña", description: null, employmentType: null, expected: ["temporada"], note: "temporada navideña" },
  { title: "SUPERVISOR POR TEMPORADA 637745", description: null, employmentType: null, expected: ["temporada"], note: "por temporada" },
  { title: "Cajero temporal (punto de venta)", description: null, employmentType: "Temporal", expected: [], note: "temporal es otro contrato" },
  { title: "Guía fin de semana en temporada", description: null, employmentType: null, expected: ["fines-de-semana", "temporada"], note: "dos intenciones" },
  { title: "Asesor medio tiempo fines de semana", description: null, employmentType: null, expected: ["fines-de-semana", "medio-tiempo"], note: "dos intenciones" },
  { title: "Operario de producción", description: null, employmentType: null, expected: [], note: "nada" },
  { title: "", description: null, employmentType: null, expected: [], note: "vacío" }
];
