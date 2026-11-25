import type { ResumeFacts } from "../resume-studio.js";
import { factTexts } from "./evidence.js";
import { contentTerms, normalizeText } from "./text.js";

const ROLE_STOP = new Set(["de", "del", "en", "la", "el", "los", "las", "y", "o", "of", "and", "the", "in", "for", "jr", "sr", "remote", "remoto", "hybrid", "hibrido"]);

// AI Resume Studio R4c — what the card screens need so the user only
// approves (owner's rule: «la IA hace el trabajo; nunca una caja vacía»):
// the CV evidence behind a proposal, the CV bullet to prefill an answer
// with, figures that can be COMPUTED from the CV (years from dates), and
// the check that keeps «no», «nada» or «-» out of the CV. Pure: shared by
// the browser and the tests.

export interface EvidenceItem {
  factId: string;
  text: string;
  /** «Rol · Empresa» of the experience it belongs to, or the section. */
  where: string;
  /** R4d: true when the proposal CITED this fact (by id); false = only shares words with it (a guess, never a badge). */
  cited?: boolean;
}

const SECTION_LABEL: Record<string, string> = {
  headline: "Título del perfil",
  summary: "Perfil",
  experience: "Experiencia",
  bullet: "Experiencia",
  education: "Formación",
  certification: "Certificación",
  skill: "Habilidades",
  language: "Idiomas"
};

function expLabel(facts: ResumeFacts, id: string | undefined): string {
  const e = facts.experience.find((x) => x.id === id);
  return e ? [e.role, e.company].filter(Boolean).join(" · ") || "Experiencia" : "";
}

/** The CV facts a proposal stands on: the ids the model cited, else the facts that share the most words with it. */
export function evidenceFor(facts: ResumeFacts, text: string, supportingFactIds: string[] = [], scopeExperienceId: string | null = null, max = 3): EvidenceItem[] {
  const all = factTexts(facts).filter((f) => !scopeExperienceId || f.factId === scopeExperienceId || f.parentId === scopeExperienceId);
  const toItem = (f: (typeof all)[number]): EvidenceItem => ({
    factId: f.factId,
    text: f.text,
    where: f.section === "bullet" ? expLabel(facts, f.parentId) : f.section === "experience" ? f.text : SECTION_LABEL[f.section] ?? ""
  });
  const cited = supportingFactIds.map((id) => all.find((f) => f.factId === id)).filter((f): f is (typeof all)[number] => Boolean(f));
  if (cited.length) return cited.slice(0, max).map((f) => ({ ...toItem(f), cited: true }));
  const want = new Set(contentTerms(text));
  return all
    .filter((f) => f.section !== "headline" && f.section !== "summary")
    .map((f) => ({ f, hits: contentTerms(f.text).filter((t) => want.has(t)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, max)
    .map((x) => ({ ...toItem(x.f), cited: false }));
}

/** The CV bullet (in that experience, or anywhere) that best matches a requirement: the default answer, in the user's own words. */
export function bestBullet(facts: ResumeFacts, requirement: string, experienceId: string | null): EvidenceItem | null {
  const want = new Set(contentTerms(requirement));
  let best: { item: EvidenceItem; hits: number } | null = null;
  for (const e of facts.experience) {
    if (experienceId && e.id !== experienceId) continue;
    for (const b of e.bullets) {
      const hits = contentTerms(b.text).filter((t) => want.has(t)).length;
      if (!best || hits > best.hits) best = { item: { factId: b.id, text: b.text, where: expLabel(facts, e.id) }, hits };
    }
  }
  return best?.item ?? null;
}

const NEGATIVE = /^(no+|nop|nope|nada|ningun[oa]?|nunca|tampoco|n\/?a|no aplica|no s[eé]|no tengo|no lo (he )?hecho|sin experiencia|ninguna experiencia|x+|[-–—_.?¿!¡]+)$/i;

/**
 * Why a user's text can't go into the CV as written: «negative» means «no
 * tengo esa experiencia» (nothing is written, the requirement is left out),
 * «too_short» means there's nothing to write yet. Null when it's usable.
 */
export function answerProblem(text: string): "negative" | "too_short" | null {
  const raw = text.trim().replace(/\s+/g, " ");
  if (!raw) return "too_short";
  const t = raw.replace(/[.!]+$/, "");
  if (!t || NEGATIVE.test(t)) return "negative";
  const words = t.split(" ").filter((w) => /\p{L}{2,}/u.test(w));
  if (t.length < 12 || words.length < 3) return "too_short";
  return null;
}

const MONTH = /^(\d{4})-(\d{2})$/;
const toMonths = (v: string) => {
  const m = MONTH.exec(v);
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
};

/**
 * Years of experience computed from the CV's own dates (overlaps merged).
 * With focus terms (e.g. the vacancy's title), only the experiences whose
 * role shares a term count; if none does, all count. Null without dates.
 */
export function yearsFromCv(facts: ResumeFacts, focus: string, now = new Date()): { years: number; count: number; focused: boolean } | null {
  const nowM = now.getUTCFullYear() * 12 + now.getUTCMonth();
  // Role words, short ones included («QA», «BI»): contentTerms drops words under 3 letters.
  const words = (v: string) => normalizeText(v).split(/[^a-z0-9+#]+/).filter((w) => w.length >= 2 && !ROLE_STOP.has(w));
  const terms = new Set(words(focus));
  // R4d: «Quality Assurance or Software Testing» names the same area as a «QA» role.
  if (/quality assurance|aseguramiento de (la )?calidad|software testing|pruebas de software|\btest(ing|er)?\b/.test(normalizeText(focus))) terms.add("qa");
  const dated = facts.experience
    .map((e) => ({ e, s: toMonths(e.startDate), end: e.current ? nowM : toMonths(e.endDate) }))
    .filter((x): x is { e: (typeof facts.experience)[number]; s: number; end: number } => x.s !== null && x.end !== null && x.end >= x.s);
  if (!dated.length) return null;
  const focused = dated.filter((x) => words(x.e.role).some((t) => terms.has(t)));
  const use = focused.length ? focused : dated;
  const spans = use.map((x) => [x.s, x.end + 1] as [number, number]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = spans[0];
  for (const [s, e] of spans.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e);
    else {
      total += ce - cs;
      [cs, ce] = [s, e];
    }
  }
  total += ce - cs;
  return { years: Math.round((total / 12) * 2) / 2, count: use.length, focused: focused.length > 0 };
}

// ---------- R4d: computed figures only when they answer the card ----------

const YEARS_ASKED =
  /\b\d+(?:[.,]\d+)?\s*\+?\s*(?:anos|years?|yrs)\b|\b(?:anos|years?)\s+(?:de|of)\s+(?:experiencia|experience)\b|\b(?:cuantos|how many)\s+(?:anos|years)\b/;
const GENERIC_YEARS = new Set(
  "experiencia experience years year anos ano yrs minimo minima minimum least laboral profesional professional relevante relevant tienes have cuantos many como menos more mas requerida required preferible preferred".split(" ")
);

/** The text asks for a NUMBER OF YEARS («2+ years of experience», «¿cuántos años…?»), not just «experiencia». */
export function asksForYears(text: string | null | undefined): boolean {
  return Boolean(text) && YEARS_ASKED.test(normalizeText(text as string));
}

/** Content words of a years question other than «years of experience» itself (its domain: «QA», «Java»…). */
export function yearsDomain(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length >= 2 && !/^\d/.test(w) && !GENERIC_YEARS.has(w) && !ROLE_STOP.has(w) && !YEARS_FILLER.has(w));
}
const YEARS_FILLER = new Set("at to with con tu your un una an is es are son tiene has como such".split(" "));

/**
 * Report P0 «ocultar datos calculados que no vienen al caso»: the «~X años
 * según tu CV» figure is offered only when the card's requirement (or, on
 * the profile cards, the AI's question) asks for a number of years, and the
 * computed figure answers THAT: either it was computed from experiences in
 * that area (`focused`) or the question names no area. «Distributed
 * systems», «¿Tienes experiencia con X?» → never.
 */
export function yearsFit(input: { requirement: string; question: string; allowQuestion: boolean; focused: boolean }): boolean {
  const texts = [input.requirement, ...(input.allowQuestion ? [input.question] : [])];
  return texts.some((t) => asksForYears(t) && (input.focused || yearsDomain(t).length === 0));
}

// ---------- R4d: «qué falta, por qué importa y qué puedes hacer» ----------

const REQ_LEAD =
  /^(?:experience (?:with|in)|hands-on experience (?:with|in)|understanding of|knowledge of|familiarity with|ability to|experiencia (?:en|con)|conocimientos? (?:de|en)|manejo de|dominio de)\s+/i;

/** The requirement's topic, short: «Understanding of distributed systems.» → «distributed systems». */
export function requirementTopic(requirement: string): string {
  const t = requirement.replace(/\s*\((?:obligatorio|deseable)\)\s*$/, "").replace(/[.;:]+$/, "").trim().replace(REQ_LEAD, "");
  return t.length > 70 ? `${t.slice(0, 70).replace(/\s+\S*$/, "")}…` : t;
}

/**
 * The three parts the report asks for (copy is a PROPOSAL, not yet tested
 * with users): what is missing, that we don't invent it, and a question
 * that leads to an action. `claims` are the validator's new data.
 */
export function missingNotice(input: { claims: { kind: string; value: string }[]; requirement: string; question?: string }): { missing: string; ask: string } {
  const values = [...new Set(input.claims.map((c) => c.value))].slice(0, 4);
  const missing = values.length ? values.join(", ") : requirementTopic(input.requirement);
  const figures = values.length > 0 && input.claims.every((c) => c.kind === "number" || c.kind === "month" || c.kind === "achievement");
  const ask = figures
    ? "¿Es un dato real de tu trabajo? Si lo es, cuéntalo con tus palabras."
    : !values.length && input.question?.trim()
      ? input.question.trim()
      : "¿Trabajaste con eso en algún empleo?";
  return { missing, ask };
}

/** «~4,5 años» */
export function formatYears(years: number): string {
  return `~${years.toLocaleString("es-CO", { maximumFractionDigits: 1 })} ${years === 1 ? "año" : "años"}`;
}
