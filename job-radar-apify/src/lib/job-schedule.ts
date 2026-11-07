import { likeAny, searchTitleText, sqlSearchTitle } from "./job-search-intent.js";

// Schedule intents (seo-intent-wave2 design D1/D2, ADR 0012 amendment):
// "fines de semana", "medio tiempo" and "temporada".
//
// Deterministic and explicit only, and TITLE ONLY. The production count of
// 2026-11-07 (seo-intent-wave2/validation.md §1) decided it:
//   - title phrases: 15 of 15 sample titles on intent for each one;
//   - the same phrases in descriptions: mostly full-time jobs that say
//     "disponibilidad para laborar fines de semana" (0 of 15 on intent);
//   - employment_type = 'Medio tiempo' (2.094 CO rows, ~24 % of all aptas):
//     shows on titles like "Guardia de seguridad" or "Operario de
//     producción", and full-time-looking postings, so it is not evidence.
//
// One definition, two outputs, like job-experience.ts: matchesSchedule() in
// memory and sqlSchedule() in Postgres, both over the normalized title of
// searchTitleText()/sqlSearchTitle() (lowercase, no accents, every non
// [a-z0-9+#] run is one space, padded with spaces).
// tests/validate-intent-pages.ts compares both on the shared fixture.

export type ScheduleIntent = "fines-de-semana" | "medio-tiempo" | "temporada";

interface SchedulePhrases {
  /** Any of these, as whole words, in the title. */
  match: readonly string[];
  /** None of these in the title (negations of a matched phrase). */
  negate: readonly string[];
}

// The exact lists counted by scripts/count-intent-wave2.ts (fdsTitle,
// fdsNegation, mtTitle, mtNegation, tempTitle).
export const SCHEDULE_PHRASES: Record<ScheduleIntent, SchedulePhrases> = {
  "fines-de-semana": {
    match: ["fin de semana", "fines de semana", "sabados y domingos", "sabado y domingo", "sabados domingos y festivos", "weekend", "weekends"],
    negate: [
      "no fines de semana", "sin fines de semana", "excepto fines de semana", "fines de semana libres",
      "libre los fines de semana", "libres los fines de semana", "no se trabaja fines de semana",
      "no trabaja fines de semana", "no se labora fines de semana"
    ]
  },
  "medio-tiempo": {
    match: ["medio tiempo", "tiempo parcial", "part time", "media jornada", "jornada parcial", "medio turno"],
    negate: ["no es medio tiempo", "no es tiempo parcial", "no es part time"]
  },
  temporada: {
    match: ["temporada", "por temporada", "temporada navidena", "temporada decembrina", "temporada alta", "navidad", "navideno", "navidena", "decembrino", "decembrina"],
    negate: []
  }
};

const likes = (phrases: readonly string[]) => phrases.map((phrase) => `% ${phrase} %`);
const MATCH_LIKES = Object.fromEntries(
  Object.entries(SCHEDULE_PHRASES).map(([intent, phrases]) => [intent, { match: likes(phrases.match), negate: likes(phrases.negate) }])
) as Record<ScheduleIntent, { match: string[]; negate: string[] }>;

export function matchesSchedule(intent: ScheduleIntent, title: string | null | undefined): boolean {
  if (!title) return false;
  const { match, negate } = MATCH_LIKES[intent];
  const text = searchTitleText(title);
  return likeAny(text, match) && !(negate.length > 0 && likeAny(text, negate));
}

const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;
const sqlArray = (values: string[]) => `ARRAY[${values.map(sqlString).join(", ")}]::text[]`;

/** matchesSchedule() as a SQL boolean over one column. Constants only, no parameters. */
export function sqlSchedule(intent: ScheduleIntent, titleColumn: string): string {
  const { match, negate } = MATCH_LIKES[intent];
  const t = sqlSearchTitle(titleColumn);
  const negation = negate.length > 0 ? ` AND NOT (${t} LIKE ANY (${sqlArray(negate)}))` : "";
  return `(${t} LIKE ANY (${sqlArray(match)})${negation})`;
}

/** Filter value accepted by the intent pages (never user-provided free text). */
export function scheduleForFilter(value: string | null | undefined): ScheduleIntent | null {
  return value === "fines-de-semana" || value === "medio-tiempo" || value === "temporada" ? value : null;
}
