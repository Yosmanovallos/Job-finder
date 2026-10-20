/**
 * TypeScript twin of companyKeySql() (src/lib/company-identity.ts), so the
 * discovery dry-run can compare an ATS-declared name with a candidate without
 * a database. Same steps in the same order; the integration test asserts it
 * matches the SQL builder on real spellings.
 */

const LEGAL_SUFFIX_TAIL = /( (s a s|sas|s a|sa|ltda|limitada|e s p|esp|bic|inc|llc|ltd|corp|s de r l|srl|ca|c a))+$/;
const COUNTRY_TAIL = /(?<! de| del) (colombia|venezuela)$/;

/** Lower case, accents folded the way the SQL translate() folds them. */
export function foldName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[áàäâãåā]/g, "a")
    .replace(/[éèëêē]/g, "e")
    .replace(/[íìïîī]/g, "i")
    .replace(/[óòöôõō]/g, "o")
    .replace(/[úùüûū]/g, "u")
    .replace(/ñ/g, "n")
    .replace(/ç/g, "c");
}

/** The words of the name once case, accents, punctuation, legal form and a trailing country are gone. */
export function companyWords(name: string | null): string[] {
  const spaced = foldName(name ?? "confidencial").replace(/[^a-z0-9]+/g, " ").trim();
  const folded = spaced.replace(LEGAL_SUFFIX_TAIL, "").replace(COUNTRY_TAIL, "").replace(LEGAL_SUFFIX_TAIL, "");
  return folded.split(" ").filter(Boolean);
}

/** Employer identity key, equal to companyKeySql() of the same text. */
export function companyKey(name: string | null): string {
  return companyWords(name).join("");
}

/** Same set as isPlaceholderCompanyKeySql(). */
export function isPlaceholderKey(key: string): boolean {
  return key.includes("confidencial") || ["", "anonima", "anonimo", "reservado", "nodisponible", "noespecificado"].includes(key);
}

// Keys too generic to identify one employer by name alone: a board whose
// declared name folds to one of these proves nothing.
const GENERIC_KEYS = new Set([
  "grupo", "global", "colombia", "servicios", "soluciones", "consultores", "consultoria", "empresa",
  "compania", "temporal", "talento", "empleos", "careers", "jobs", "group", "holding", "company", "corporacion"
]);

/** Short (< 4 chars) or generic keys can't verify a board by name — review only. */
export function isWeakKey(key: string): boolean {
  return key.length < 4 || GENERIC_KEYS.has(key);
}
