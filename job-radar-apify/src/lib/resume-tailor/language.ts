import type { ResumeFacts } from "../resume-studio.js";
import { findSkills } from "./skills.js";

// AI Resume Studio R4d — the CV's language, fixed by CODE (report «Adaptación
// de CV con IA», P0 «idioma fijo»). A cheap, deterministic detector:
// function words of each language plus a few word endings. Tool names
// («Jenkins», «Postman») never count as a language change. Short or
// ambiguous texts (most headlines) return null, which means «don't know»
// and never blocks anything. Pure: shared by the server and the browser.

export type CvLanguage = "es" | "en";

const ES_WORDS = new Set(
  "de del la las el los que y en por para con una uno su sus al como mas se es fue entre sobre desde hasta durante tambien pero sin este esta estos estas mi mis lo le donde cuando segun mediante".split(" ")
);
const EN_WORDS = new Set(
  "the of and to in for with on as by an is are was were at from that this these my our their or be been have has into using used through across within over under via while which who".split(" ")
);
// Loanwords that Spanish CVs use as they are: they say nothing about the language.
const LOANWORDS = new Set("marketing testing branding networking coaching merchandising outsourcing staffing training software hardware".split(" "));

function score(text: string): { es: number; en: number } {
  let clean = text;
  for (const skill of findSkills(text)) clean = clean.split(skill).join(" ");
  const lower = clean.toLowerCase();
  let es = 0;
  let en = 0;
  for (const raw of lower.split(/[^\p{L}]+/u)) {
    if (!raw) continue;
    const plain = raw.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (ES_WORDS.has(plain)) es += 1;
    else if (EN_WORDS.has(plain)) en += 1;
    else if (LOANWORDS.has(plain)) continue;
    else if (/ñ/.test(raw) || /(ción|ciones|sión|siones|mente|idad|idades)$/.test(raw) || (raw.length > 3 && /é$/.test(raw))) es += 0.5;
    else if (raw.length > 4 && /(tion|tions|ing|ment|ity|ies|ed)$/.test(plain)) en += 0.5;
  }
  return { es, en };
}

/** «es», «en» or null when the text is too short or too mixed to tell. */
export function detectLanguage(text: string | null | undefined): CvLanguage | null {
  if (!text || !text.trim()) return null;
  const { es, en } = score(text);
  if (es + en < 3) return null;
  if (es >= 2 * en && es - en >= 2) return "es";
  if (en >= 2 * es && en - es >= 2) return "en";
  return null;
}

/** The CV's own prose (profile, roles, bullets, studies): never contact data or the skills list. */
export function cvProse(facts: ResumeFacts): string {
  return [
    facts.basics.headline,
    facts.summary,
    ...facts.experience.flatMap((e) => [e.role, ...e.bullets.map((b) => b.text)]),
    ...facts.education.map((e) => e.degree),
    ...facts.certifications.map((c) => c.name)
  ]
    .filter((t) => t && t.trim())
    .join("\n");
}

export function cvLanguage(facts: ResumeFacts): CvLanguage | null {
  return detectLanguage(cvProse(facts));
}

/** True only when the text is clearly in the OTHER language (unknown never counts). */
export function languageMismatch(text: string, expected: CvLanguage | null): boolean {
  if (!expected) return false;
  const found = detectLanguage(text);
  return found !== null && found !== expected;
}

/** For the app's own Spanish UI: true only when a short text clearly reads as Spanish (unknown → false). */
export function readsAsSpanish(text: string): boolean {
  const found = detectLanguage(text);
  if (found) return found === "es";
  const plain = text.toLowerCase();
  return /[áéíóúñ¿¡]/.test(plain) || /\b(de|la|el|que|con|para|en|los|las|del|tu)\b/.test(plain);
}

export const LANGUAGE_NAME: Record<CvLanguage, string> = { es: "español", en: "inglés" };
