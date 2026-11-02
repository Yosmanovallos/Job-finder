import { likeAny, prefilterText, searchTitleText, sqlPrefilterText, sqlSearchTitle } from "./job-search-intent.js";

// One modality classifier for the job card label, the in-memory filter
// (job-filters.ts applyJobFilters) and the SQL filter (job-repository.ts
// buildJobWhere). Before 2026-11-02 all three read only `location`, and
// anything that didn't say remote/hybrid there was "Presencial": 28,507 of
// 29,322 Colombia jobs, including LinkedIn titles like "AI Engineer
// (Remote, Cartagena)" whose location is just "Colombia".
//
// Evidence, strongest first:
// 1. Workana: freelance projects; their location is the client's country.
// 2. remote_type, only ever set when the source itself states it (Job SEO
//    V2: GetOnBoard remote_modality, JSON-LD TELECOMMUTE, official ATS).
// 3. Remote-only boards (RemoteOK, Remotive, WeRemoto): the source is
//    remote by definition (same list as countries/index.ts).
// 4. The title, then 5. the location: whole words of the normalized text
//    (job-search-intent.ts), as LIKE patterns, so JS and SQL match the same.
// Without evidence the answer is "unknown" ("Sin especificar"), never
// "Presencial" by default.
//
// The SQL is generated from the same tables below, and
// tests/validate-job-modality.ts compares both on real Postgres.

export type JobModality = "remoto" | "hibrido" | "presencial" | "freelance" | "unknown";

export interface ModalityInput {
  source?: string | null;
  remoteType?: string | null;
  title?: string | null;
  location?: string | null;
}

export const FREELANCE_SOURCES = ["Workana"];
const REMOTE_ONLY_SOURCES = ["RemoteOK", "Remotive", "WeRemoto"];

const REMOTE_TYPE_MODALITY: Record<string, JobModality> = {
  fully_remote: "remoto",
  hybrid: "hibrido",
  onsite: "presencial"
};

interface TextRule {
  modality: JobModality;
  // Normalized-text phrases (job-search-intent.ts searchTitleText):
  // lowercase, accent-free, words separated by one space.
  phrases: string[];
  // The rule does not apply when one of these phrases is present too.
  unless?: string[];
}

// Order matters. Hybrid first: a hybrid title often names its office days
// ("Híbrido, 3 días presencial"), and "remoto o híbrido" is not a promise of
// 100% remote. Then an explicit "no remoto", then "no presencial", then
// on-site words, then remote words.
const TEXT_RULES: TextRule[] = [
  { modality: "hibrido", phrases: ["hibrido", "hibrida", "hybrid", "semipresencial", "semi presencial"] },
  { modality: "presencial", phrases: ["no remoto", "no remota", "no remote", "not remote", "non remote"] },
  { modality: "remoto", phrases: ["no presencial"] },
  { modality: "presencial", phrases: ["presencial", "presencialidad", "onsite", "on site", "in office"] },
  {
    modality: "remoto",
    phrases: ["remoto", "remota", "remotos", "remotas", "remote", "remotely", "teletrabajo", "home office", "trabajo desde casa", "work from home", "100 virtual"],
    // Remote as part of the job itself, not where it is done.
    unless: [
      "remote sensing",
      "control remoto",
      "controles remotos",
      "remote patient",
      "monitoreo remoto",
      "soporte remoto",
      "remote support",
      "asistencia remota",
      "acceso remoto",
      "remote access",
      "sensores remotos",
      "operacion remota"
    ]
  }
];

const likeOf = (phrase: string) => `% ${phrase} %`;
// The longest word of a phrase is a plain substring of prefilterText()
// whenever the normalized text contains the phrase, so it is a safe and
// cheap first test before the normalized text is built.
const stemOf = (phrase: string) => `%${phrase.split(" ").reduce((a, b) => (b.length > a.length ? b : a))}%`;

interface CompiledRule {
  modality: JobModality;
  like: string[];
  stems: string[];
  unless: string[];
}

const COMPILED_RULES: CompiledRule[] = TEXT_RULES.map((rule) => ({
  modality: rule.modality,
  like: rule.phrases.map(likeOf),
  stems: [...new Set(rule.phrases.map(stemOf))],
  unless: (rule.unless || []).map(likeOf)
}));

function textModality(text: string | null | undefined): JobModality | null {
  if (!text) return null;
  const pre = prefilterText(text);
  let normalized: string | null = null;
  for (const rule of COMPILED_RULES) {
    if (!likeAny(pre, rule.stems)) continue;
    normalized ??= searchTitleText(text);
    if (likeAny(normalized, rule.like) && !likeAny(normalized, rule.unless)) return rule.modality;
  }
  return null;
}

export function isFreelanceProject(job: { source?: string | null }): boolean {
  return !!job.source && FREELANCE_SOURCES.includes(job.source);
}

export function classifyModality(job: ModalityInput): JobModality {
  if (isFreelanceProject(job)) return "freelance";
  const stated = job.remoteType ? REMOTE_TYPE_MODALITY[job.remoteType] : undefined;
  if (stated) return stated;
  if (job.source && REMOTE_ONLY_SOURCES.includes(job.source)) return "remoto";
  return textModality(job.title) ?? textModality(job.location) ?? "unknown";
}

const LABELS: Record<JobModality, string> = {
  remoto: "Remoto",
  hibrido: "Híbrido",
  presencial: "Presencial",
  freelance: "Freelance · proyecto remoto",
  unknown: "Sin especificar"
};

export function modalityLabel(modality: JobModality): string {
  return LABELS[modality];
}

export function getJobModalityLabel(job: ModalityInput): string {
  return modalityLabel(classifyModality(job));
}

/** Dashboard filter values (FilterBar, /api/jobs, /api/v1/jobs) → bucket. */
export function modalityForFilter(value: string | null | undefined): JobModality | null {
  const v = (value || "").toLowerCase();
  return v === "remoto" || v === "hibrido" || v === "presencial" ? v : null;
}

// ---- SQL ----

const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;
const sqlArray = (values: string[]) => `ARRAY[${values.map(sqlString).join(", ")}]::text[]`;

function sqlTextRules(column: string): string[] {
  const pre = sqlPrefilterText(column);
  const normalized = sqlSearchTitle(column);
  return COMPILED_RULES.map((rule) => {
    const match = rule.unless.length
      ? `${normalized} LIKE ANY (${sqlArray(rule.like)}) AND NOT (${normalized} LIKE ANY (${sqlArray(rule.unless)}))`
      : `${normalized} LIKE ANY (${sqlArray(rule.like)})`;
    // CASE keeps the cheap prefilter first: most rows never build the
    // normalized text (same pattern as job-repository.ts familyColumnPredicate).
    return `WHEN CASE WHEN ${pre} LIKE ANY (${sqlArray(rule.stems)}) THEN ${match} ELSE FALSE END THEN ${sqlString(rule.modality)}`;
  });
}

/**
 * classifyModality() as one SQL CASE over the jobs columns source,
 * remote_type, title and location. Constants only, no parameters.
 */
export function sqlJobModality(): string {
  const branches = [
    `WHEN source IN (${FREELANCE_SOURCES.map(sqlString).join(", ")}) THEN 'freelance'`,
    ...Object.entries(REMOTE_TYPE_MODALITY).map(([type, modality]) => `WHEN remote_type = ${sqlString(type)} THEN ${sqlString(modality)}`),
    `WHEN source IN (${REMOTE_ONLY_SOURCES.map(sqlString).join(", ")}) THEN 'remoto'`,
    ...sqlTextRules("title"),
    ...sqlTextRules("location")
  ];
  return `(CASE ${branches.join(" ")} ELSE 'unknown' END)`;
}
