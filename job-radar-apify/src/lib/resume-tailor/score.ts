import type { ResumeFacts } from "../resume-studio.js";
import { factTexts, type RequirementEvidence } from "./evidence.js";
import type { JobAnalysis } from "./requirements.js";
import { findSkills } from "./skills.js";
import { contentTerms, normalizeText, sentences } from "./text.js";

// AI Resume Studio R3 — the two deterministic scores (doc 05 §4, doc 11 §5.1).
// Same input → same output. Pure, shared with the page so the number moves
// as soon as the user approves a card, with no model call. Forbidden
// variables (age, sex, photo, civil status, nationality, address, ethnicity,
// religion, disability, health, union or political affiliation) are not
// read: only headline, summary, experience, education, skills and languages
// go in, plus whether contact fields are filled (never their content).

export const COMPATIBILITY_DISCLAIMER =
  "Estimación de BuscoTrabajo con una fórmula pública. No es el puntaje de ningún ATS y no garantiza entrevistas.";

export interface ScoreComponent {
  id: "must" | "nice" | "skills" | "readability" | "focus";
  label: string;
  /** Points earned after redistribution, one decimal. */
  points: number;
  /** Maximum after redistribution. */
  max: number;
  available: boolean;
}

export interface CompatibilityScore {
  total: number;
  components: ScoreComponent[];
  notices: string[];
}

const LEVEL_VALUE = { full: 1, partial: 0.5, none: 0 } as const;

const PRESENT_VERBS = new Set(
  "apoyo gestiono lidero coordino elaboro realizo atiendo manejo desarrollo diseno administro analizo superviso implemento organizo creo dirijo vendo registro controlo preparo reviso redacto capacito ejecuto optimizo".split(" ")
);

/** «Configuré…», «Organizó…», «Gestionar…», «Led…» → true; «Publicaciones diarias…» → false. */
export function startsWithVerb(text: string): boolean {
  const first = text.trim().split(/\s+/)[0] ?? "";
  if (!first) return false;
  if (/[éíó]$/i.test(first.replace(/[.,;:]$/, ""))) return true;
  const n = normalizeText(first).replace(/[^a-z]/g, "");
  if (PRESENT_VERBS.has(n)) return true;
  if (/(ar|er|ir|ando|iendo|aron|ieron|amos|imos)$/.test(n) && n.length > 4) return true;
  return /^[a-z]+ed$/.test(n) && n.length > 4;
}

function bullets(facts: ResumeFacts): string[] {
  return facts.experience.flatMap((e) => e.bullets.map((b) => b.text.trim()).filter(Boolean));
}

/** The 5 structure checks of doc 05 §4 «Legibilidad y estructura». */
export function readabilityChecks(facts: ResumeFacts): { id: string; label: string; ok: boolean }[] {
  const summaryLines = sentences(facts.summary).length;
  const all = bullets(facts);
  const verbShare = all.length ? all.filter(startsWithVerb).length / all.length : 0;
  const datesOk =
    facts.experience.length > 0 &&
    facts.experience.every((e) => Boolean(e.startDate) && (e.current || Boolean(e.endDate)) && (!e.endDate || !e.startDate || e.endDate >= e.startDate));
  const b = facts.basics;
  return [
    { id: "summary", label: "Resumen de 2 a 4 líneas", ok: summaryLines >= 2 && summaryLines <= 4 && facts.summary.length <= 700 },
    { id: "verbs", label: "Viñetas que empiezan con un verbo", ok: all.length > 0 && verbShare >= 0.7 },
    { id: "dates", label: "Fechas completas y coherentes", ok: datesOk },
    { id: "contact", label: "Contacto completo (nombre, correo o teléfono, ciudad)", ok: Boolean(b.fullName.trim() && (b.email.trim() || b.phone.trim()) && b.city.trim()) },
    // Our three templates are one column, real text, no tables or images.
    { id: "layout", label: "Una columna, sin tablas ni imágenes", ok: true }
  ];
}

function cvSkillSet(facts: ResumeFacts): Set<string> {
  const text = factTexts(facts).map((f) => f.text).join("\n");
  return new Set(findSkills(text));
}

/** Compatibilidad estimada (doc 05 §4). */
export function compatibilityScore(job: JobAnalysis, evidence: RequirementEvidence[], facts: ResumeFacts): CompatibilityScore {
  const level = new Map(evidence.map((e) => [e.requirementId, LEVEL_VALUE[e.level]]));
  const must = job.requirements.filter((r) => r.kind === "must");
  const nice = job.requirements.filter((r) => r.kind === "nice");
  const share = (list: typeof must) => list.reduce((acc, r) => acc + (level.get(r.id) ?? 0), 0) / list.length;

  const cvSkills = cvSkillSet(facts);
  const skillsShare = job.skills.length ? job.skills.filter((s) => cvSkills.has(s)).length / job.skills.length : 0;

  const checks = readabilityChecks(facts);
  const readability = checks.filter((c) => c.ok).length / checks.length;

  // Resumen enfocado: names the role area (5) and ≥ 2 tasks/requirements of the vacancy (5).
  const focusText = `${facts.basics.headline}\n${facts.summary}`;
  const focusTerms = new Set(contentTerms(focusText));
  const namesArea = job.titleTerms.some((t) => focusTerms.has(t));
  const summaryTerms = new Set(contentTerms(facts.summary));
  const targets = [...job.tasks.map((t) => contentTerms(t)), ...job.requirements.map((r) => r.terms)];
  const tasksHit = targets.filter((terms) => terms.some((t) => summaryTerms.has(t))).length;
  const focus = (namesArea ? 0.5 : 0) + (tasksHit >= 2 ? 0.5 : 0);

  const raw: (Omit<ScoreComponent, "points" | "max"> & { weight: number; share: number })[] = [
    { id: "must", label: "Requisitos obligatorios", weight: 40, share: must.length ? share(must) : 0, available: must.length > 0 },
    { id: "nice", label: "Requisitos deseables", weight: 15, share: nice.length ? share(nice) : 0, available: nice.length > 0 },
    { id: "skills", label: "Habilidades que pide la vacante", weight: 20, share: skillsShare, available: job.skills.length > 0 },
    { id: "readability", label: "Legibilidad y estructura", weight: 15, share: readability, available: true },
    { id: "focus", label: "Resumen enfocado en el cargo", weight: 10, share: focus, available: true }
  ];
  const totalWeight = raw.filter((c) => c.available).reduce((acc, c) => acc + c.weight, 0);
  const scale = 100 / totalWeight;
  const components: ScoreComponent[] = raw.map((c) => {
    const max = c.available ? c.weight * scale : 0;
    return { id: c.id, label: c.label, available: c.available, max: round1(max), points: round1(max * c.share) };
  });
  const notices: string[] = [];
  const missing = raw.filter((c) => !c.available).map((c) => c.label.toLowerCase());
  if (missing.length) notices.push(`La vacante no trae ${missing.join(" ni ")} identificables: su peso se repartió entre los demás criterios.`);
  const total = Math.round(raw.reduce((acc, c) => acc + (c.available ? c.weight * scale * c.share : 0), 0));
  return { total: Math.max(0, Math.min(100, total)), components, notices };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface QualityCheck {
  id: string;
  label: string;
  ok: boolean;
}

/** Calidad de tu hoja de vida (0–100): structure only, never «ATS». 10 checks × 10. */
export function qualityScore(facts: ResumeFacts): { total: number; checks: QualityCheck[] } {
  const read = readabilityChecks(facts);
  const all = bullets(facts);
  const checks: QualityCheck[] = [
    ...read.filter((c) => c.id !== "layout"),
    { id: "headline", label: "Título de perfil", ok: facts.basics.headline.trim().length >= 3 },
    { id: "history", label: "Experiencia o formación registrada", ok: facts.experience.length + facts.education.length > 0 },
    { id: "bullets", label: "Entre 2 y 6 viñetas por experiencia", ok: facts.experience.length > 0 && facts.experience.every((e) => e.bullets.filter((b) => b.text.trim()).length >= 2 && e.bullets.length <= 6) },
    { id: "results", label: "Al menos una viñeta con un resultado medible", ok: all.some((b) => /\d/.test(b)) },
    { id: "skills", label: "Al menos 3 habilidades", ok: facts.skills.filter((s) => s.name.trim()).length >= 3 },
    { id: "length", label: "Viñetas de menos de 2 líneas (≤ 220 caracteres)", ok: all.length > 0 && all.every((b) => b.length <= 220) }
  ];
  const total = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  return { total, checks };
}
