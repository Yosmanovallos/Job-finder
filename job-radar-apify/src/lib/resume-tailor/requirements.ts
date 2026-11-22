import { findSkills } from "./skills.js";
import { contentTerms, normalizeText } from "./text.js";

// AI Resume Studio R3 — S1 «requisitos» by rules (doc 05 §3, doc 11 §5.2).
// Headings and keywords decide must / nice; nothing is inferred. When the
// rules find nothing, the server may ask the model (job_requirements@1),
// but every requirement it returns must appear literally in the vacancy.

export type RequirementKind = "must" | "nice";

export interface Requirement {
  id: string;
  text: string;
  kind: RequirementKind;
  /** Canonical skills named in the requirement. */
  skills: string[];
  /** Normalized content terms, for evidence coverage. */
  terms: string[];
}

export interface JobAnalysis {
  requirements: Requirement[];
  /** Tasks from «Funciones / Responsabilidades», for the summary focus check. */
  tasks: string[];
  /** Every skill the vacancy names (title + description). */
  skills: string[];
  /** Content terms of the title (the «área del cargo»). */
  titleTerms: string[];
  /** "rules", "model" or "none" — shown so the user knows where the list came from. */
  source: "rules" | "model" | "none";
  /** Lines that looked like instructions to an AI (prompt injection) and were ignored. */
  suspiciousLines: number;
}

export const MAX_REQUIREMENTS = 12;

type Section = "must" | "nice" | "tasks" | "other" | null;

const HEADINGS: { re: RegExp; section: Section }[] = [
  { re: /^(requisitos|requerimientos|requisitos minimos|perfil|perfil requerido|que buscamos|que necesitas|que necesitamos|lo que buscamos|requirements|qualifications|must have|necesitamos|buscamos)$/, section: "must" },
  { re: /^(deseable|deseables|plus|seria un plus|es un plus|valoramos|se valorara|nice to have|preferred|preferible|te destacaras si)$/, section: "nice" },
  { re: /^(funciones|responsabilidades|que haras|tus funciones|actividades|responsibilities|mision del cargo)$/, section: "tasks" },
  { re: /^(beneficios|ofrecemos|te ofrecemos|que ofrecemos|que te ofrecemos|lo que ofrecemos|condiciones|salario|horario|lugar de trabajo|ubicacion|sobre nosotros|quienes somos|benefits|about us|tipo de contrato|contrato)$/, section: "other" }
];

const INSTRUCTION_LIKE =
  /(ignora|ignore|olvida|disregard|omite)\b.{0,40}\b(instrucci|instruction|reglas|rules|prompt|anteriores|previous)|nuevas instrucciones|new instructions|system prompt|eres ahora|you are now|<<<|>>>/i;
const OFFER_START = /^(ofrecemos|te ofrecemos|beneficios|salario|sueldo|horario|contrato|tipo de contrato|lugar de trabajo|modalidad|we offer|benefits)\b/;
const NICE_WORDS = /\b(deseable|plus|valorara|valoramos|preferible|preferiblemente|ideal|nice to have|preferred|bonus)\b/;
const MUST_WORDS = /\b(indispensable|obligatorio|excluyente|minimo|minima|requerido|requerida|must|required|necesario)\b/;

function headingOf(label: string): Section {
  const n = normalizeText(label).replace(/[:¿?¡!*#-]/g, "").trim();
  for (const h of HEADINGS) if (h.re.test(n)) return h.section;
  return null;
}

/** Splits the description into lines, with inline «Requisitos: a; b» headings broken out. */
function lines(description: string): string[] {
  const keys = HEADINGS.flatMap((h) => h.re.source.replace(/^\^\(|\)\$$/g, "").split("|"));
  const out: string[] = [];
  for (const raw of description.split(/\n+/)) {
    // A heading in the middle of a line («… híbrido. Requisitos: …») starts a new line.
    let line = raw;
    for (const key of keys) {
      const tolerant = key
        .replace(/ /g, "\\s+")
        .replace(/a/g, "[aá]")
        .replace(/e/g, "[eé]")
        .replace(/i/g, "[ií]")
        .replace(/o/g, "[oó]")
        .replace(/u/g, "[uúü]")
        .replace(/n/g, "[nñ]");
      const pattern = new RegExp(`([.!?]\\s+)(¿?${tolerant}\\??)\\s*:`, "giu");
      line = line.replace(pattern, (_m, end, word) => `${end}\n${word}:`);
    }
    for (const part of line.split("\n")) if (part.trim()) out.push(part.trim());
  }
  return out;
}

function items(rest: string): string[] {
  return rest
    .split(/[;•·▪●]|\s[-–]\s|(?<=[a-záéíóúñ)])\.\s+/i)
    .map((s) => s.replace(/^[\s*\-–•·\d.)]+/, "").replace(/[.;,\s]+$/, "").trim())
    .filter((s) => s.length >= 6 && s.length <= 220);
}

export function analyzeJob(input: { title: string; description: string }): JobAnalysis {
  const requirements: Requirement[] = [];
  const tasks: string[] = [];
  let section: Section = null;
  const seen = new Set<string>();
  let suspicious = 0;
  const add = (text: string, kind: RequirementKind) => {
    // Lines that talk to the AI are not requirements (doc 09 V4): dropped and counted.
    if (INSTRUCTION_LIKE.test(text)) {
      suspicious++;
      return;
    }
    const key = normalizeText(text);
    if (seen.has(key)) return;
    seen.add(key);
    requirements.push({ id: "", text, kind, skills: findSkills(text), terms: contentTerms(text) });
  };

  for (const line of lines(input.description)) {
    const colon = line.indexOf(":");
    let rest = line;
    const bulletLike = /^[\s*\-–•·▪●]|^\d+[.)]\s/.test(line);
    if (colon > 0 && colon <= 40) {
      const heading = headingOf(line.slice(0, colon));
      if (heading) {
        section = heading;
        rest = line.slice(colon + 1);
      }
    } else if (!bulletLike && line.length <= 45) {
      const heading = headingOf(line);
      if (heading) {
        section = heading;
        continue;
      }
    }
    if (!rest.trim()) continue;
    const n = normalizeText(rest);
    if (section === "tasks") {
      for (const item of items(rest)) tasks.push(item);
      continue;
    }
    if (section === "must" || section === "nice") {
      for (const item of items(rest)) {
        const ni = normalizeText(item)
        // «… Deseable: pruebas A/B. Ofrecemos contrato…»: the offer ends the list.
        if (OFFER_START.test(ni)) {
          section = "other";
          break;
        }
        const kind: RequirementKind = NICE_WORDS.test(ni) ? "nice" : MUST_WORDS.test(ni) ? "must" : section;
        add(item, kind);
      }
      continue;
    }
    // Outside any section: only lines that say so explicitly.
    if (section !== "other" && (MUST_WORDS.test(n) || NICE_WORDS.test(n)) && bulletLike) {
      for (const item of items(rest)) add(item, NICE_WORDS.test(normalizeText(item)) ? "nice" : "must");
    }
  }

  const ordered = [...requirements.filter((r) => r.kind === "must"), ...requirements.filter((r) => r.kind === "nice")].slice(0, MAX_REQUIREMENTS);
  ordered.forEach((r, i) => (r.id = `r${i + 1}`));
  return {
    requirements: ordered,
    tasks: tasks.slice(0, 12),
    skills: findSkills(`${input.title}\n${input.description}`),
    titleTerms: contentTerms(input.title),
    source: ordered.length ? "rules" : "none",
    suspiciousLines: suspicious
  };
}

/**
 * Requirements proposed by the model, kept only when their text appears in
 * the vacancy (AGENTS.md rule 5). Returns the accepted ones with ids.
 */
export function acceptModelRequirements(
  description: string,
  proposed: { text: string; kind: RequirementKind }[]
): Requirement[] {
  const hay = normalizeText(description);
  const out: Requirement[] = [];
  const seen = new Set<string>();
  for (const p of proposed) {
    const key = normalizeText(p.text);
    if (key.length < 6 || !hay.includes(key) || seen.has(key) || INSTRUCTION_LIKE.test(p.text)) continue;
    seen.add(key);
    out.push({ id: `r${out.length + 1}`, text: p.text.trim(), kind: p.kind, skills: findSkills(p.text), terms: contentTerms(p.text) });
    if (out.length >= MAX_REQUIREMENTS) break;
  }
  return out;
}
