import { likeAny, searchTitleText, sqlSearchTitle } from "./job-search-intent.js";

// "Sin experiencia" classifier (seo-intent-pages design D3, ADR 0012).
// Deterministic and explicit only: a job counts when its title or its
// description literally says experience is not required, and neither one
// asks for a minimum of N >= 1 years or months. Never inferred from
// "aprendiz", "practicante" or "junior" alone: those may require experience.
//
// One definition, two outputs, like job-modality.ts: classifyExperience()
// in memory and sqlSinExperiencia() in Postgres, both over the normalized
// text of searchTitleText()/sqlSearchTitle() (lowercase, no accents, ñ→n,
// every non [a-z0-9+#] run is one space, padded with spaces).
// tests/validate-intent-pages.ts compares both on the shared fixture.

export type ExperienceLevel = "sin-experiencia" | "unknown";

export interface ExperienceInput {
  title?: string | null;
  description?: string | null;
}

export const SIN_EXPERIENCIA_PHRASES = [
  "sin experiencia",
  "no requiere experiencia",
  "no se requiere experiencia",
  "primer empleo",
  "0 anos de experiencia",
  "experiencia no requerida"
];

// An explicit minimum: "3 años de experiencia", "2+ años de experiencia",
// "6 meses de experiencia", "experiencia mínima de 1 año". Plain ASCII
// regex syntax that JS RegExp and Postgres "~" read identically.
export const EXPERIENCE_REQUIRED_PATTERN =
  " [1-9][0-9]*\\+? (ano|anos|mes|meses) de experiencia | experiencia (minima )?(de )?[1-9][0-9]*\\+? (ano|anos|mes|meses) ";

const PHRASE_LIKES = SIN_EXPERIENCIA_PHRASES.map((phrase) => `% ${phrase} %`);
const REQUIRED_RE = new RegExp(EXPERIENCE_REQUIRED_PATTERN);
// Cheap first test on the raw text: a phrase can only match when the word
// "experiencia" or "empleo" is there.
const PREFILTER_RE = /experi|empleo/i;

export function classifyExperience(job: ExperienceInput): ExperienceLevel {
  const title = job.title || "";
  const description = job.description || "";
  if (!PREFILTER_RE.test(title) && !PREFILTER_RE.test(description)) return "unknown";
  const t = searchTitleText(title);
  const d = description ? searchTitleText(description) : " ";
  if (!likeAny(t, PHRASE_LIKES) && !likeAny(d, PHRASE_LIKES)) return "unknown";
  if (REQUIRED_RE.test(t) || REQUIRED_RE.test(d)) return "unknown";
  return "sin-experiencia";
}

const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;
const PHRASES_SQL = `ARRAY[${PHRASE_LIKES.map(sqlString).join(", ")}]::text[]`;

/**
 * classifyExperience() === "sin-experiencia" as a SQL boolean over two
 * columns. Constants only, no parameters.
 */
export function sqlSinExperiencia(titleColumn: string, descriptionColumn: string): string {
  const t = sqlSearchTitle(titleColumn);
  const d = sqlSearchTitle(descriptionColumn);
  const pre = `(COALESCE(${titleColumn}, '') ~* 'experi|empleo' OR COALESCE(${descriptionColumn}, '') ~* 'experi|empleo')`;
  const required = sqlString(EXPERIENCE_REQUIRED_PATTERN);
  return (
    `(CASE WHEN ${pre} THEN ` +
    `(${t} LIKE ANY (${PHRASES_SQL}) OR ${d} LIKE ANY (${PHRASES_SQL})) ` +
    `AND NOT (${t} ~ ${required} OR ${d} ~ ${required}) ELSE FALSE END)`
  );
}

/** Filter value accepted by the intent pages (never user-provided free text). */
export function experienceForFilter(value: string | null | undefined): "sin-experiencia" | null {
  return value === "sin-experiencia" ? value : null;
}
