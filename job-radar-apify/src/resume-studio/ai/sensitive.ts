// AI Resume Studio R3 — data minimization before anything reaches the model
// (doc 05 §2 step 5, doc 08 §5, doc 09 T-SENS). Contact data is replaced by
// markers; lines with sensitive data that a CV doesn't need (ID numbers,
// civil status, age, birth date, health insurance, religion, politics…)
// are removed entirely and reported to the user.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>()]+|\b(?:linkedin\.com|github\.com)\/[^\s<>()]+/gi;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;

export const SENSITIVE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "documento de identidad", re: /\b(c[ée]dula|c\.?\s?c\.?\s*(no\.?|n[°º])?\s*\d|documento de identidad|pasaporte|tarjeta de identidad|\bnit\b|\bdni\b)/i },
  { label: "estado civil", re: /\b(estado civil|solter[oa]|casad[oa]|divorciad[oa]|viud[oa]|uni[óo]n libre)\b/i },
  { label: "edad o fecha de nacimiento", re: /\b(edad\s*:|\d{2}\s*a[ñn]os de edad|fecha de nacimiento|nacid[oa] el|lugar de nacimiento)\b/i },
  { label: "salud o EPS", re: /\b(eps\b|tipo de sangre|grupo sangu[íi]neo|rh\s*[+-]|discapacidad|diagn[óo]stico)/i },
  { label: "religión", re: /\b(religi[óo]n|cat[óo]lic[oa]|cristian[oa]|evang[ée]lic[oa])\b/i },
  { label: "afiliación política o sindical", re: /\b(partido pol[íi]tico|afiliaci[óo]n pol[íi]tica|sindicato)\b/i },
  { label: "foto", re: /\b(foto(graf[íi]a)?\s*:)/i },
  { label: "libreta militar", re: /\blibreta militar\b/i },
  { label: "dirección de residencia", re: /\b(direcci[óo]n\s*:|calle\s+\d+|carrera\s+\d+|cra\.?\s*\d+|cl\.?\s*\d+\s*#|barrio\s+\w+)/i }
];

export interface MinimizedCv {
  /** Text with contact markers and without sensitive lines: what the model sees. */
  text: string;
  emails: string[];
  phones: string[];
  links: string[];
  /** First line when it looks like a name (never sent). */
  name: string | null;
  /** Labels of the sensitive data found and removed. */
  removed: string[];
}

export function minimizeCvText(original: string): MinimizedCv {
  const emails = [...new Set(original.match(EMAIL) ?? [])].slice(0, 3);
  const links = [...new Set((original.match(URL) ?? []).map((u) => (u.startsWith("http") ? u : `https://${u}`)))].slice(0, 5);
  const removed = new Set<string>();
  const out: string[] = [];
  let name: string | null = null;
  const lines = original.split(/\r?\n/);
  const firstContent = lines.findIndex((l) => l.trim().length > 0);
  lines.forEach((line, index) => {
    const hit = SENSITIVE_PATTERNS.find((p) => p.re.test(line));
    if (hit) {
      removed.add(hit.label);
      return;
    }
    let clean = line.replace(EMAIL, "[CORREO]").replace(URL, "[ENLACE]").replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 7 ? "[TELEFONO]" : m));
    if (index === firstContent && looksLikeName(line)) {
      name = line.trim();
      clean = "[NOMBRE]";
    }
    out.push(clean);
  });
  const phones = [...new Set((original.match(PHONE) ?? []).filter((m) => m.replace(/\D/g, "").length >= 7))].slice(0, 2);
  return { text: out.join("\n"), emails, phones, links, name, removed: [...removed] };
}

function looksLikeName(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 60 || /\d|@|:|\|/.test(t)) return false;
  const words = t.split(/\s+/);
  return words.length >= 2 && words.length <= 5 && words.every((w) => /^\p{Lu}/u.test(w) || /^(de|del|la|los|las|y)$/i.test(w));
}
