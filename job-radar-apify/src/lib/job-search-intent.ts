import { ROLE_FUNCTIONS, SEARCH_FAMILIES, SENIORITY_WORDS } from "./job-search-families.js";

// Turns a free-text dashboard search into a "search plan" that both the
// in-memory filter (job-filters.ts applyJobFilters) and the SQL filter
// (job-repository.ts buildJobWhere) consume, so the two can't drift apart.
//
// A query naming a job family ("AI Engineer", "QA", "recursos humanos",
// "enfermera") is matched against the job TITLE only, on word boundaries,
// with the whole family's vocabulary, then ranked: the exact role first,
// the family next, related families last. A query naming no family
// (company names, cities, technologies, "Senior") returns null and keeps
// the literal search exactly as it was.
//
// Matching is LIKE over a normalized title, not regex: on a 60k-row corpus
// one Postgres regex alternation of a family's vocabulary took 2-5 s, while
// a cheap LIKE prefilter on the raw title plus LIKE ANY over the
// normalized title of the surviving rows costs about what the old literal
// search did (~0.3 s for the broadest family, "AI").

// ---- Title normalization (identical in JS and SQL) ----

const ACCENTS: Array<[string, string]> = [["á", "a"], ["é", "e"], ["í", "i"], ["ó", "o"], ["ú", "u"], ["ü", "u"], ["ñ", "n"]];

function stripAccents(lower: string): string {
  let out = lower;
  for (const [from, to] of ACCENTS) out = out.split(from).join(to);
  return out;
}

/** " ingeniero a de sistemas lider tic ": lowercase, accent-free, one space between words, padded. */
export function searchTitleText(text: string | null | undefined): string {
  return ` ${stripAccents((text || "").toLowerCase()).replace(/[^a-z0-9+#]+/g, " ")} `;
}

export function sqlSearchTitle(column: string): string {
  const lower = ACCENTS.reduce((expr, [from, to]) => `REPLACE(${expr}, '${from}', '${to}')`, `LOWER(COALESCE(${column}, ''))`);
  return `(' ' || REGEXP_REPLACE(${lower}, '[^a-z0-9+#]+', ' ', 'g') || ' ')`;
}

export function sqlLowerText(column: string): string {
  return `LOWER(COALESCE(${column}, ''))`;
}

/** What the prefilter's stems read: lowercase and accent-free, punctuation untouched. */
export function prefilterText(text: string | null | undefined): string {
  return stripAccents((text || "").toLowerCase());
}

export function sqlPrefilterText(column: string): string {
  return ACCENTS.reduce((expr, [from, to]) => `REPLACE(${expr}, '${from}', '${to}')`, sqlLowerText(column));
}

// LIKE semantics in JS, so the in-memory filter matches exactly what
// Postgres matches.
const likeCache = new Map<string, RegExp>();
export function likeMatches(text: string, pattern: string): boolean {
  let re = likeCache.get(pattern);
  if (!re) {
    const source = Array.from(pattern)
      .map((ch) => (ch === "%" ? "[\\s\\S]*" : ch === "_" ? "[\\s\\S]" : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("");
    re = new RegExp(`^${source}$`, "u");
    if (likeCache.size > 5000) likeCache.clear();
    likeCache.set(pattern, re);
  }
  return re.test(text);
}

export function likeAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => likeMatches(text, pattern));
}

// ---- Phrases ----

// Connector words are ignored in queries, and a phrase written with them
// ("analista de datos") also matches the title without them.
const CONNECTOR_SET = new Set(["de", "del", "la", "las", "el", "los", "en", "y", "e", "a", "o", "para", "con", "al", "of", "the", "and", "in", "for"]);

interface PhraseWord {
  text: string;
  prefix: boolean;
}

function parseWords(text: string): PhraseWord[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.endsWith("*") ? { text: word.slice(0, -1), prefix: true } : { text: word, prefix: false }));
}

function parsePhrase(phrase: string): { all: PhraseWord[]; words: PhraseWord[]; queryOnly: boolean } {
  const queryOnly = phrase.startsWith("~");
  const all = parseWords(queryOnly ? phrase.slice(1) : phrase);
  return { all, words: all.filter((word) => !CONNECTOR_SET.has(word.text)), queryOnly };
}

// "% ingenier% de sistemas %": whole words between spaces of the normalized
// title, "*" words as prefixes, the last word also in plural.
function likePatterns(words: PhraseWord[]): string[] {
  if (words.length === 0) return [];
  const head = words.slice(0, -1).map((word) => (word.prefix ? `${word.text}%` : word.text));
  const last = words[words.length - 1];
  const tails = last.prefix ? [`${last.text}%`] : [`${last.text} `, `${last.text}s `, `${last.text}es `];
  return tails.map((tail) => `% ${[...head, tail].join(" ")}${last.prefix ? "" : "%"}`);
}

// Cheap prefilter: the distinctive word of each phrase as a plain substring
// of the accent-free title (prefilterText). Words of 3 letters or fewer
// ("ai", "ia", "ux") sit inside too many unrelated words for that
// ("gerencia", "auxiliar"), so they get one small whole-word regex over the
// plain lowercase title instead (they carry no accents).
const SHORT_STEM_MAX_LENGTH = 3;

const ROLE_WORDS = ROLE_FUNCTIONS.flatMap((fn) => fn.forms.map((form) => parseWords(form)[0]));
function isRoleWord(text: string): boolean {
  return ROLE_WORDS.some((word) => wordMatches(text, word));
}

function stemPattern(text: string): string {
  return `%${text}%`;
}

export interface TitlePattern {
  like: string[];
  stems: string[];
  shortWords: string | null;
}

function shortWordsRegex(words: string[]): string | null {
  if (words.length === 0) return null;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `(^|[^a-z0-9])(${escaped.join("|")})([^a-z0-9]|$)`;
}

function compileTitlePattern(phrases: string[]): TitlePattern | null {
  const like = new Set<string>();
  const stems = new Set<string>();
  const shortWords = new Set<string>();
  for (const phrase of phrases) {
    const parsed = parsePhrase(phrase);
    if (parsed.queryOnly || parsed.words.length === 0) continue;
    for (const pattern of likePatterns(parsed.all)) like.add(pattern);
    for (const pattern of likePatterns(parsed.words)) like.add(pattern);
    // The last word that isn't a role word is the distinctive one
    // ("auxiliar de SISTEMAS", "inteligencia ARTIFICIAL", "ML engineer").
    const key = [...parsed.words].reverse().find((word) => !isRoleWord(word.text)) ?? parsed.words[parsed.words.length - 1];
    if (!key.prefix && key.text.length <= SHORT_STEM_MAX_LENGTH) shortWords.add(key.text);
    else stems.add(stemPattern(key.text));
  }
  if (like.size === 0) return null;
  return { like: Array.from(like), stems: Array.from(stems), shortWords: shortWordsRegex(Array.from(shortWords)) };
}

// ---- Vocabulary index ----

function wordMatches(queryWord: string, word: PhraseWord): boolean {
  if (word.prefix) return queryWord.startsWith(word.text);
  return queryWord === word.text || queryWord === `${word.text}s` || queryWord === `${word.text}es`;
}

interface Trigger {
  family: number;
  group: number;
  words: PhraseWord[];
}

const TRIGGERS: Trigger[] = [];
SEARCH_FAMILIES.forEach((family, f) => {
  family.groups.forEach((group, g) => {
    for (const phrase of group) {
      const { words } = parsePhrase(phrase);
      if (words.length > 0) TRIGGERS.push({ family: f, group: g, words });
    }
  });
});

const FUNCTION_WORDS = ROLE_FUNCTIONS.map((fn) => ({ id: fn.id, words: fn.forms.map((form) => parseWords(form)[0]) }));
const FUNCTIONS_BY_ID = new Map(ROLE_FUNCTIONS.map((fn) => [fn.id, fn]));

interface CompiledFamily {
  core: TitlePattern | null;
  all: TitlePattern | null;
  exclude: TitlePattern | null;
  groups: Array<TitlePattern | null>;
}

const COMPILED_FAMILIES: CompiledFamily[] = SEARCH_FAMILIES.map((family) => {
  const corePhrases = [...family.groups.flat(), ...(family.extra || [])];
  return {
    core: compileTitlePattern(corePhrases),
    all: compileTitlePattern([...corePhrases, ...(family.related || [])]),
    exclude: family.exclude ? compileTitlePattern(family.exclude) : null,
    groups: family.groups.map((group) => compileTitlePattern(group))
  };
});

// ---- Plan ----

export interface SearchPlan {
  // Each family named in the query: the title must match `match` (family
  // plus related vocabulary) and must not match `exclude`.
  families: Array<{ id: string; match: TitlePattern; exclude: TitlePattern | null; matchCompany: boolean }>;
  // Rank 0: every one of these (the exact names the query used, plus its
  // role-type word if it had one).
  exact: TitlePattern[];
  // Rank 1: every one of these (each family's own vocabulary, plus a close
  // role-type word if the query had one). Anything else matching
  // `families` is rank 2.
  core: TitlePattern[];
  // Leftover words ("medellín", "python") keep the literal per-word search,
  // spelled as the user typed them; words of 3 letters or fewer as whole
  // words ("Tiendas Ara" must not take "ara" from "para"/"Barranquilla").
  residual: string[];
  // A query with leftover words may be an employer name that contains a
  // family word ("Tiendas Ara", "Torre.ai"): postings at an employer whose
  // name contains the whole query rank first. Not for pure family queries,
  // where it would put a "Consultora de Recursos Humanos" developer posting
  // above every HR job for "recursos humanos".
  companyPhrase: string | null;
}

const planCache = new Map<string, SearchPlan | null>();

/** Null when the query names no job family: the caller keeps the literal search. */
export function buildSearchPlan(rawQuery: string | null | undefined): SearchPlan | null {
  const query = (rawQuery || "").trim();
  if (!query) return null;
  const cached = planCache.get(query);
  if (cached !== undefined) return cached;
  const plan = computeSearchPlan(query);
  if (planCache.size > 500) planCache.clear();
  planCache.set(query, plan);
  return plan;
}

function computeSearchPlan(query: string): SearchPlan | null {
  const original = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((token) => token && !CONNECTOR_SET.has(stripAccents(token)));
  const tokens = original.map(stripAccents);

  const hits = new Map<number, Set<number>>();
  const functions = new Set<string>();
  const residual: string[] = [];

  for (let i = 0; i < tokens.length; ) {
    let best: Trigger | null = null;
    for (const trigger of TRIGGERS) {
      if (best && trigger.words.length <= best.words.length) continue;
      if (i + trigger.words.length > tokens.length) continue;
      if (trigger.words.every((word, k) => wordMatches(tokens[i + k], word))) best = trigger;
    }
    if (best) {
      if (!hits.has(best.family)) hits.set(best.family, new Set());
      hits.get(best.family)!.add(best.group);
      i += best.words.length;
      continue;
    }
    const fn = FUNCTION_WORDS.find((candidate) => candidate.words.some((word) => wordMatches(tokens[i], word)));
    if (fn) functions.add(fn.id);
    else if (!SENIORITY_WORDS.has(tokens[i])) residual.push(original[i]);
    i += 1;
  }

  if (hits.size === 0) return null;

  const strict = compileTitlePattern(Array.from(functions).flatMap((id) => FUNCTIONS_BY_ID.get(id)!.forms));
  const near = compileTitlePattern(
    Array.from(functions).flatMap((id) =>
      [id, ...(FUNCTIONS_BY_ID.get(id)!.near || [])].flatMap((nearId) => FUNCTIONS_BY_ID.get(nearId)?.forms || [])
    )
  );

  const families: SearchPlan["families"] = [];
  const exact: TitlePattern[] = [];
  const core: TitlePattern[] = [];
  for (const [f, groups] of hits) {
    const compiled = COMPILED_FAMILIES[f];
    if (!compiled.all || !compiled.core) continue;
    families.push({
      id: SEARCH_FAMILIES[f].id,
      match: compiled.all,
      exclude: compiled.exclude,
      matchCompany: SEARCH_FAMILIES[f].matchCompany === true
    });
    core.push(compiled.core);
    // Two names of the same family in one query ("cuidadora adultos
    // mayores") rank first when the title has either of them.
    const groupPatterns = Array.from(groups)
      .map((g) => compiled.groups[g])
      .filter((pattern): pattern is TitlePattern => pattern !== null);
    exact.push(
      groupPatterns.length > 0
        ? { like: Array.from(new Set(groupPatterns.flatMap((p) => p.like))), stems: [], shortWords: null }
        : compiled.core
    );
  }
  if (families.length === 0) return null;
  if (strict) exact.push(strict);
  if (near) core.push(near);

  return { families, exact, core, residual, companyPhrase: residual.length > 0 ? query.toLowerCase() : null };
}

// ---- Evaluation (JS side; job-repository.ts emits the same in SQL) ----

const regexCache = new Map<string, RegExp>();
function regexMatches(text: string, pattern: string): boolean {
  let re = regexCache.get(pattern);
  if (!re) {
    re = new RegExp(pattern);
    if (regexCache.size > 1000) regexCache.clear();
    regexCache.set(pattern, re);
  }
  return re.test(text);
}

/** The prefilter: a superset of the titles the LIKE patterns can match. */
export function titlePassesPrefilter(title: string | null | undefined, pattern: TitlePattern): boolean {
  return (
    likeAny(prefilterText(title), pattern.stems) ||
    (pattern.shortWords !== null && regexMatches((title || "").toLowerCase(), pattern.shortWords))
  );
}

function textMatchesFamily(text: string | null | undefined, family: SearchPlan["families"][number]): boolean {
  if (!titlePassesPrefilter(text, family.match)) return false;
  const normalized = searchTitleText(text);
  return likeAny(normalized, family.match.like) && !(family.exclude && likeAny(normalized, family.exclude.like));
}

/**
 * Whether a posting satisfies the plan's family part (residual words are
 * checked by the caller): its title, or for industry families its employer.
 */
export function titleMatchesFamilies(
  plan: SearchPlan,
  title: string | null | undefined,
  company?: string | null
): boolean {
  return plan.families.every(
    (family) => textMatchesFamily(title, family) || (family.matchCompany && textMatchesFamily(company, family))
  );
}

/** 0 exact role, 1 same family, 2 related family. Only meaningful for titles that match the families. */
export function familyRank(plan: SearchPlan, title: string | null | undefined): 0 | 1 | 2 {
  const normalized = searchTitleText(title);
  if (plan.exact.every((pattern) => likeAny(normalized, pattern.like))) return 0;
  if (plan.core.every((pattern) => likeAny(normalized, pattern.like))) return 1;
  return 2;
}

// ---- Leftover words of a family search ----

const SHORT_RESIDUAL_MAX_LENGTH = 3;

/** Whole-word patterns for a short leftover word; null keeps the substring match. */
export function shortResidualPatterns(word: string): { stem: string; like: string } | null {
  const lower = word.toLowerCase();
  if (lower.length > SHORT_RESIDUAL_MAX_LENGTH || !/^[a-z0-9]+$/.test(lower)) return null;
  return { stem: `%${lower}%`, like: `% ${lower} %` };
}

export function textContainsResidual(text: string | null | undefined, word: string): boolean {
  const lower = (text || "").toLowerCase();
  const short = shortResidualPatterns(word);
  if (!short) return lower.includes(word.toLowerCase());
  return likeMatches(lower, short.stem) && likeMatches(searchTitleText(text), short.like);
}
