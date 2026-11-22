// AI Resume Studio R3 — data minimization before anything reaches the model
// (doc 05 §2 step 5, doc 08 §5, doc 09 T-SENS). Contact data is replaced by
// markers; lines with sensitive data that a CV doesn't need (ID numbers,
// civil status, age, birth date, health insurance, religion, politics…)
// are removed entirely and reported to the user.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>()]+|\b(?:linkedin\.com|github\.com)\/[^\s<>()]+/gi;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;

export const INSTRUCTION_TO_AI =
  /(ignora|ignore|olvida|disregard|omite)\b.{0,40}\b(instrucci|instruction|reglas|rules|prompt|anteriores|previous)|nuevas instrucciones|new instructions|system prompt|eres ahora|you are now|<<<|>>>/i;

// Label-style lines («Estado civil: …», «EPS: …») and unmistakable values
// («C.C. 1.234.567», «Calle 12 # 34-56») only. A CV line that merely mentions
// a word («Universidad Católica», «EPS Sura» as an employer, «diagnóstico de
// redes», «barrio La Paz») is content and stays.
const BULLET = String.raw`^\s*[-•*·]?\s*`;
const label = (labels: string) => new RegExp(String.raw`${BULLET}(?:${labels})\s*[:=]`, "i");
const any = (...res: RegExp[]) => new RegExp(res.map((r) => r.source).join("|"), "i");

export const SENSITIVE_PATTERNS: { label: string; re: RegExp }[] = [
  {
    label: "documento de identidad",
    re: any(
      label(String.raw`c[ée]dula(?: de ciudadan[íi]a)?|c\.?\s?c\.?|documento(?: de identidad)?|pasaporte|tarjeta de identidad|n[úu]mero de identificaci[óo]n|dni`),
      /\b(?:c[ée]dula|c\.\s?c\.)\s*(?:de ciudadan[íi]a\s*)?(?:no\.?|n[°º]|#)?\s*\d[\d.\s]{5,}/
    )
  },
  { label: "estado civil", re: any(label("estado civil"), /^\s*(?:solter[oa]|casad[oa]|divorciad[oa]|viud[oa]|uni[óo]n libre)\s*[,.]?\s*$/) },
  {
    label: "edad o fecha de nacimiento",
    re: any(label("edad|fecha de nacimiento|lugar de nacimiento|fecha y lugar de nacimiento"), /\b\d{2}\s*a[ñn]os de edad\b/, /\bnacid[oa] el\b/)
  },
  { label: "salud o EPS", re: label(String.raw`eps|tipo de sangre|grupo sangu[íi]neo|rh|discapacidad|salud|condici[óo]n m[ée]dica`) },
  { label: "religión", re: label(String.raw`religi[óo]n|credo`) },
  { label: "afiliación política o sindical", re: label(String.raw`partido(?: pol[íi]tico)?|afiliaci[óo]n pol[íi]tica|sindicato`) },
  { label: "foto", re: label(String.raw`foto|fotograf[íi]a`) },
  { label: "libreta militar", re: any(label("libreta militar"), /\blibreta militar\s*(?:no\.?|n[°º]|#)?\s*\d/) },
  // Text aimed at the AI inside a CV is not CV content (doc 09 §4 adversarial).
  { label: "texto dirigido a la IA", re: INSTRUCTION_TO_AI },
  {
    label: "dirección de residencia",
    re: any(
      label(String.raw`direcci[óo]n|domicilio|residencia|barrio`),
      /\b(?:calle|carrera|cra\.?|cl\.?|avenida|av\.?|diagonal|dg\.?|transversal|tv\.?)\s*\d+\s*[a-z]?\s*(?:#|no\.?|n[°º])\s*\d+/
    )
  }
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
