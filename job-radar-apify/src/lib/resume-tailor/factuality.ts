import { findSkills, textMentionsSkill } from "./skills.js";
import { contentTerms, normalizeText } from "./text.js";

// AI Resume Studio R3 — factuality validator (doc 05 §5, ADR 0017 §2,
// AGENTS.md rule 5). A proposal may only use what the cited facts or the
// user's own answer say. Code, not the model, decides: numbers, percentages,
// years and months, tools/skills, proper nouns and seniority/title words in
// the proposed text must all appear in the sources. Anything new:
//   - only skills/tools → the card becomes a QUESTION («¿Usaste X?»);
//   - anything else      → the proposal is DISCARDED.
// An unknown supporting fact id also discards it.

export type ClaimKind = "number" | "month" | "skill" | "proper_noun" | "title" | "achievement" | "new_word" | "link";

export interface Claim {
  kind: ClaimKind;
  value: string;
}

export interface FactualityResult {
  verdict: "accept" | "question" | "discard";
  newClaims: Claim[];
  reason: "ok" | "new_data" | "unknown_fact" | "empty";
}

const NUMBER_WORDS: Record<string, string> = {
  dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10", once: "11", doce: "12",
  quince: "15", veinte: "20", treinta: "30", cuarenta: "40", cincuenta: "50", cien: "100", ciento: "100", mil: "1000", millon: "1000000", millones: "1000000",
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twenty: "20", hundred: "100", thousand: "1000"
};

const MONTHS = new Set("enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre ene feb mar abr jun jul ago sep sept oct nov dic january february march april june july august september october november december".split(" "));

// Words that claim a level, a title or a credential.
const TITLE_WORDS = new Set(
  (
    "senior semisenior semi-senior junior experto experta especialista jefe jefa gerente director directora lider lideresa coordinador coordinadora supervisor supervisora " +
    "manager head lead principal certificado certificada certificacion magister maestria doctor doctora phd ingeniero ingeniera abogado abogada contador contadora " +
    "profesional tecnologo tecnologa tecnico tecnica bilingue nativo nativa fluido fluida avanzado avanzada premio premiada galardonado"
  ).split(" ")
);

// Words that claim a result, a scope or leadership («duplicando», «lideré»,
// «a nivel nacional», «amplia experiencia», «exitosas»). Prefix stems (≥ 5
// chars) and exact words; supported only when a source word has the same stem.
const ACHIEVEMENT_STEMS = [
  "duplic", "tripli", "cuadrupl", "aument", "increment", "reduj", "reduc", "ahorr", "optimi", "maximi", "lider", "dirig", "dirij",
  "encabe", "nacional", "internacional", "multinacional", "exitos", "extens", "premi", "galardon", "reconocim", "destaca", "sobresal",
  "millon", "mejor"
];
const ACHIEVEMENT_WORDS = new Set(["amplia", "amplio", "solida", "solido", "global", "record", "top", "miles", "cientos", "exito"]);

function achievementKey(word: string): string | null {
  if (ACHIEVEMENT_WORDS.has(word)) return word;
  return ACHIEVEMENT_STEMS.find((stem) => word.startsWith(stem)) ?? null;
}

function numbersIn(n: string): string[] {
  const out: string[] = [];
  for (const m of n.matchAll(/(?<![a-z0-9])\d+(?:[.,]\d+)?%?(?![a-z])/g)) out.push(m[0].replace(",", "."));
  for (const w of n.split(/[^a-z]+/)) if (NUMBER_WORDS[w]) out.push(NUMBER_WORDS[w]);
  return out;
}

function words(n: string): Set<string> {
  return new Set(n.split(/[^a-z0-9+#./-]+/).map((w) => w.replace(/^[./-]+|[./-]+$/g, "")).filter(Boolean));
}

/** Capitalized words not at a sentence start, acronyms and camel-case names (TikTok). */
function properNouns(text: string): string[] {
  const out: string[] = [];
  const tokens = text.split(/\s+/);
  let sentenceStart = true;
  for (const raw of tokens) {
    const token = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (token) {
      const capital = /^\p{Lu}/u.test(token);
      const acronym = /^\p{Lu}{2,}$/u.test(token);
      const inner = /\p{Ll}\p{Lu}/u.test(token);
      // «B2», «ISO9001», «GA4»: letters and digits together name something specific.
      const mixed = /\d/.test(token) && /\p{L}/u.test(token);
      if (acronym || inner || mixed || (capital && !sentenceStart)) out.push(token);
      sentenceStart = false;
    }
    // Only a real sentence end resets: after «·», «|» or «-» a capital still names something.
    if (/[.!?:;]["»)]*$/.test(raw)) sentenceStart = true;
  }
  return out;
}

/** The claims of `text` that its sources don't support. */
export function newClaims(text: string, sources: string[], options: { strictWords?: boolean } = {}): Claim[] {
  const source = sources.join("\n");
  const ns = normalizeText(source);
  const nt = normalizeText(text);
  const sourceNumbers = new Set(numbersIn(ns));
  const sourceWords = words(ns);
  const claims: Claim[] = [];
  const push = (kind: ClaimKind, value: string) => {
    if (!claims.some((c) => c.kind === kind && normalizeText(c.value) === normalizeText(value))) claims.push({ kind, value });
  };

  // Links, e-mails, HTML or Markdown never come from the model (doc 08 §3 «exfiltración»).
  for (const m of text.matchAll(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\w+|<\/?[a-z][^>]*>|\]\(\S+\)/gi)) push("link", m[0]);
  for (const num of numbersIn(nt)) {
    const bare = num.replace("%", "");
    const supported = num.endsWith("%")
      ? sourceNumbers.has(num) || (sourceNumbers.has(bare) && new RegExp(`\\b${bare.replace(".", "\\.")} por ciento`).test(ns))
      : sourceNumbers.has(num) || sourceNumbers.has(`${num}%`);
    if (!supported) push("number", num);
  }
  for (const w of words(nt)) {
    if (MONTHS.has(w) && !sourceWords.has(w)) push("month", w);
    if (TITLE_WORDS.has(w) && !sourceWords.has(w)) push("title", w);
    const key = achievementKey(w);
    if (key && ![...sourceWords].some((sw) => achievementKey(sw) === key)) push("achievement", w);
  }
  for (const skill of findSkills(text)) {
    if (!textMentionsSkill(source, skill)) push("skill", skill);
  }
  const skillsHere = new Set(findSkills(text).map((s) => normalizeText(s)));
  for (const noun of properNouns(text)) {
    const n = normalizeText(noun);
    if (sourceWords.has(n) || ns.includes(n)) continue;
    // Already reported as a skill (e.g. «Salesforce»).
    if ([...skillsHere].some((s) => s.split(" ").includes(n))) continue;
    push("proper_noun", noun);
  }
  // Headlines may only reuse words that are already in the CV (doc 11 prototype).
  if (options.strictWords) {
    const known = new Set(contentTerms(source));
    for (const term of contentTerms(text)) if (!known.has(term)) push("new_word", term);
  }
  return claims;
}

export function validateProposal(input: {
  after: string;
  sources: string[];
  supportingFactIds?: string[];
  knownFactIds?: Iterable<string>;
  /** Every content word must already be in the sources (headline). */
  strictWords?: boolean;
}): FactualityResult {
  if (!input.after.trim()) return { verdict: "discard", newClaims: [], reason: "empty" };
  if (input.supportingFactIds && input.knownFactIds) {
    const known = new Set(input.knownFactIds);
    if (input.supportingFactIds.some((id) => !known.has(id))) return { verdict: "discard", newClaims: [], reason: "unknown_fact" };
  }
  const claims = newClaims(input.after, input.sources, { strictWords: input.strictWords });
  if (!claims.length) return { verdict: "accept", newClaims: [], reason: "ok" };
  const onlySkills = claims.every((c) => c.kind === "skill");
  return { verdict: onlySkills ? "question" : "discard", newClaims: claims, reason: "new_data" };
}
