// AI Resume Studio R3 — text helpers shared by the server and the lazy
// /hoja-de-vida chunk. Pure: no process.env, no Node APIs.

/** Lower case, no accents, «20 %» → «20%», one space between words. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’“”«»"']/g, "")
    .replace(/(\d)\s+(%|k\b)/g, "$1$2")
    .replace(/(\d)[.,](?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Finds `quote` in `original` ignoring case, accents and whitespace runs, and
 * returns its offsets in `original`. Null when the quote isn't there: the
 * model can't cite text that doesn't exist (doc 05 §2 step 3).
 */
export function findQuote(original: string, quote: string): { start: number; end: number } | null {
  const wanted = foldChars(quote.trim());
  if (wanted.text.length < 2) return null;
  const hay = foldChars(original);
  const at = hay.text.indexOf(wanted.text);
  if (at < 0) return null;
  const start = hay.map[at];
  const end = hay.map[at + wanted.text.length - 1] + 1;
  return { start, end };
}

/** Folded text plus, for each folded char, its index in the source. */
function foldChars(value: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (/\s/.test(ch)) {
      if (!lastSpace) {
        text += " ";
        map.push(i);
        lastSpace = true;
      }
      continue;
    }
    const folded = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const c of folded) {
      text += c;
      map.push(i);
    }
    lastSpace = false;
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

const STOPWORDS = new Set(
  (
    "a al algo algun alguna algunos ante con contra como cual cuando de del desde donde durante e el ella ellos en entre era es esa ese eso esta este esto estos " +
    "fue ha han hasta la las le les lo los mas me mi mis muy ni no nos o otra otro para pero por que se ser si sin sobre su sus tambien te tiene tu tus un una unas " +
    "uno unos y ya the and of for to in with on at an or as by from is are be your our we you minimo minima experiencia anos ano conocimiento conocimientos manejo " +
    "deseable indispensable requisito requisitos requerido requerida preferible preferiblemente valorara plus buscamos capacidad habilidad habilidades nivel " +
    "trabajo equipo empresa cargo funciones responsabilidades persona profesional tecnico tecnologo bachiller etc"
  ).split(" ")
);

/** Content words (no stopwords, ≥ 3 chars), normalized. */
export function contentTerms(value: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of normalizeText(value).split(/[^a-z0-9+#./-]+/)) {
    const w = word.replace(/^[./-]+|[./-]+$/g, "");
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    const stem = stemEs(w);
    if (!seen.has(stem)) {
      seen.add(stem);
      out.push(stem);
    }
  }
  return out;
}

/** Very light Spanish/English stemming: enough to match «reportes» with «reporte». */
export function stemEs(word: string): string {
  if (word.length <= 4) return word;
  return word.replace(/(aciones|acion|amientos|amiento|imientos|imiento|mente|idades|idad|ciones|cion|es|s)$/, "") || word;
}

/** True when the text starts with a capital letter (used for the «viñeta con verbo» check). */
export function sentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
