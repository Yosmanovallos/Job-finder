import { TRANSLATION_MAP } from "../ai-role-agent.js";
import { COUNTRIES } from "../countries/index.js";
import { DEFAULT_ROLES_200 } from "../queue/scheduler.js";
import { ROLE_FUNCTIONS, SEARCH_FAMILIES } from "./job-search-families.js";

// "¿Quisiste decir…?" for a dashboard search that found nothing
// ("markerting" → "marketing"). Only a suggestion the visitor can click:
// the search they typed is never replaced silently.
//
// The dictionary is closed and built once from vocabulary the code already
// has: the job-family phrases (job-search-families.ts), the role functions,
// the tracked roles (scheduler.ts), the scraper's synonym map
// (ai-role-agent.ts) and the configured cities. No external service and no
// database query: GET /api/jobs calls this only when a search returned 0
// rows, after the page cache.

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const MIN_WORD_LENGTH = 4;

// Folded word → how it is shown (the accented spelling wins: a literal
// search for "ingenieria" would not match "Ingeniería").
const DISPLAY = new Map<string, string>();

function addWords(text: string): void {
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}+#*~]+/u)) {
    // "enfermer*" is a stem, not a word to suggest; "~" only marks a
    // query-only phrase.
    if (!raw || raw.endsWith("*")) continue;
    const word = raw.replace(/^~/, "");
    if (word.length < MIN_WORD_LENGTH || /\d/.test(word)) continue;
    const key = fold(word);
    const shown = DISPLAY.get(key);
    if (!shown || (shown === key && word !== key)) DISPLAY.set(key, word);
  }
}

for (const family of SEARCH_FAMILIES) {
  for (const phrase of [...family.groups.flat(), ...(family.extra || []), ...(family.related || [])]) addWords(phrase);
}
for (const fn of ROLE_FUNCTIONS) for (const form of fn.forms) addWords(form);
for (const role of DEFAULT_ROLES_200) addWords(role);
for (const [word, synonyms] of Object.entries(TRANSLATION_MAP)) {
  addWords(word);
  for (const synonym of synonyms) addWords(synonym);
}
for (const country of Object.values(COUNTRIES)) for (const city of country.cities) addWords(city);

const BY_LENGTH = new Map<number, string[]>();
for (const key of [...DISPLAY.keys()].sort()) {
  const bucket = BY_LENGTH.get(key.length) || [];
  bucket.push(key);
  BY_LENGTH.set(key.length, bucket);
}

/** Optimal string alignment distance, or max + 1 as soon as it exceeds max. */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prevPrev[j - 2] + 1);
      row.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = row;
  }
  return prev[b.length];
}

function correctWord(word: string): string | null {
  if (word.length < MIN_WORD_LENGTH || /\d/.test(word) || DISPLAY.has(word)) return null;
  const max = word.length >= 7 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = max + 1;
  for (let length = word.length - max; length <= word.length + max; length++) {
    for (const candidate of BY_LENGTH.get(length) || []) {
      const distance = boundedEditDistance(word, candidate, max);
      // Ties keep the first candidate in alphabetical order: deterministic.
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}

const MAX_QUERY_LENGTH = 80;
const MAX_WORDS = 6;

/**
 * The query with each unknown word replaced by the closest dictionary word,
 * or null when nothing would change (every word known, or nothing close).
 */
export function suggestSearch(rawQuery: string | null | undefined): string | null {
  const query = fold((rawQuery || "").trim()).slice(0, MAX_QUERY_LENGTH);
  const words = query.split(/[^a-z0-9+#]+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return null;
  let changed = false;
  const corrected = words.map((word) => {
    const fix = correctWord(word);
    if (!fix) return DISPLAY.get(word) || word;
    changed = true;
    return DISPLAY.get(fix) || fix;
  });
  return changed ? corrected.join(" ") : null;
}
