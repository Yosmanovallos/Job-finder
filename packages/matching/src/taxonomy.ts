/**
 * Deterministic skill/title taxonomy (plan §8.2, §13.1). Pure string rules —
 * no models. The canonical job record is never mutated: these derive features
 * for matching only.
 */

/** skill canonical name → accepted synonyms (lowercase). */
export const SKILL_SYNONYMS: Record<string, string[]> = {
  sql: ["sql", "postgresql", "postgres", "mysql", "t-sql", "tsql", "sql server"],
  "power bi": ["power bi", "powerbi", "power-bi"],
  python: ["python"],
  excel: ["excel", "microsoft excel", "ms excel"],
  dbt: ["dbt"],
  tableau: ["tableau"],
  looker: ["looker", "lookml"],
  r: ["r language"],
  snowflake: ["snowflake"],
  bigquery: ["bigquery", "big query"],
  airflow: ["airflow"],
  spark: ["spark", "pyspark"],
  etl: ["etl", "elt"],
  "data visualization": ["data visualization", "data viz", "dashboards", "dashboarding"],
  "machine learning": ["machine learning", "ml"],
  javascript: ["javascript", "js", "node.js", "nodejs"],
  typescript: ["typescript"],
  java: ["java"],
  "google analytics": ["google analytics", "ga4"]
};

export function normalizeSkill(skill: string): string {
  const lower = skill.toLowerCase().trim();
  for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
    if (canonical === lower || synonyms.includes(lower)) {
      return canonical;
    }
  }
  return lower;
}

/** Whole-word presence of a skill (or its synonyms) inside free text. */
export function skillInText(skill: string, text: string): boolean {
  const lowerText = text.toLowerCase();
  const canonical = normalizeSkill(skill);
  const candidates = [canonical, ...(SKILL_SYNONYMS[canonical] ?? [])];
  return candidates.some((candidate) => {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(lowerText);
  });
}

const SENIORITY_PATTERNS: [RegExp, string][] = [
  [/\b(intern|internship|practicante)\b/i, "intern"],
  [/\b(jr\.?|junior)\b/i, "junior"],
  [/\b(sr\.?|senior)\b/i, "senior"],
  [/\b(staff|principal|lead)\b/i, "lead"],
  [/\b(director)\b/i, "director"],
  [/\b(vp|vice president|chief|head of)\b/i, "executive"],
  [/\bmanager\b/i, "manager"],
  [/\b(entry[- ]level|graduate|trainee)\b/i, "entry"],
  [/\b(mid[- ]level|intermediate)\b/i, "mid"]
];

/**
 * Seniority *feature* derived from the title for matching. The stored job
 * keeps whatever the source said (usually "unknown") — this never writes back.
 */
export function seniorityFromTitle(title: string): string | null {
  for (const [pattern, seniority] of SENIORITY_PATTERNS) {
    if (pattern.test(title)) {
      return seniority;
    }
  }
  return null;
}

export const SENIORITY_ORDER = [
  "intern",
  "entry",
  "junior",
  "mid",
  "senior",
  "lead",
  "manager",
  "director",
  "executive"
];

export function seniorityDistance(a: string, b: string): number | null {
  const ia = SENIORITY_ORDER.indexOf(a);
  const ib = SENIORITY_ORDER.indexOf(b);
  if (ia === -1 || ib === -1) {
    return null;
  }
  return ib - ia;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Title matches when every meaningful token of the target appears. */
export function titleMatches(targetTitle: string, jobTitle: string): boolean {
  const jobNormalized = ` ${normalizeTitle(jobTitle)} `;
  const tokens = normalizeTitle(targetTitle)
    .split(" ")
    .filter((token) => token.length > 1);
  if (tokens.length === 0) {
    return false;
  }
  return tokens.every((token) => jobNormalized.includes(` ${token} `));
}
