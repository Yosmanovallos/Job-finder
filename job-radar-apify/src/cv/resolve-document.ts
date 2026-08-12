import type { CvFacts } from "./cv-facts-schema.js";
import type { CvDocument } from "./cv-document-schema.js";

/**
 * Shared id-resolution layer for Etapa F (docs/CV-GENERATION-PLAN.md §4) —
 * turns a `CvDocument` (ids + tailored text) plus its `CvFacts` vault into
 * a plain, renderer-agnostic structure with every id already resolved to
 * real text. Both `render-pdf.ts` and `render-docx.ts` consume this same
 * output so the id-lookup logic exists in exactly one place.
 *
 * Real gap found while implementing, not present in §3.2's original
 * schema: `CvDocument` has no field referencing `CvFacts.languages` at
 * all — Etapa B never got a way to include them. Rather than change
 * `CvDocumentSchema` now (would ripple back into the already
 * eval-verified Etapa B prompt from Fase 3), languages are rendered
 * directly from `CvFacts` unconditionally, the same way contact info
 * already is — languages aren't really something that needs per-job
 * tailoring/reordering the way skills or experience bullets do.
 *
 * Defensive: an id in `CvDocument` that doesn't exist in `CvFacts` (stale
 * `document_json` after the user replaced their base CV, for example) is
 * skipped, never invented — AGENTS.md regla 5. This should never happen
 * for a document that passed the validator (factuality.ts) at generation
 * time, but the editor (§9.4) can persist `document_json` independently
 * afterward, so render-time can't assume it's still in sync.
 */

export interface ResolvedExperience {
  title: string;
  company: string;
  startDate: string | null;
  endDate: string | null;
  bullets: string[];
}

export interface ResolvedCv {
  contact: CvFacts["contact"];
  headline: string;
  summary: string;
  experience: ResolvedExperience[];
  skills: string[];
  education: { institution: string; degree: string; endDate: string | null }[];
  certifications: { name: string; issuer: string | null; date: string | null }[];
  languages: { name: string; level: string | null }[];
  language: "es" | "en";
}

export function resolveCvDocumentForRender(document: CvDocument, facts: CvFacts): ResolvedCv {
  const experienceById = new Map(facts.experience.map((e) => [e.id, e]));
  const skillById = new Map(facts.skills.map((s) => [s.id, s]));
  const educationById = new Map(facts.education.map((e) => [e.id, e]));
  const certificationById = new Map(facts.certifications.map((c) => [c.id, c]));

  const experience: ResolvedExperience[] = [];
  for (const exp of document.experience) {
    const source = experienceById.get(exp.source_id);
    if (!source) continue; // stale id, skip rather than invent (see module doc)
    experience.push({
      title: source.title,
      company: source.company,
      startDate: source.start_date,
      endDate: source.end_date,
      bullets: exp.bullets.map((b) => b.text)
    });
  }

  const skills = document.reordered_skill_ids.map((id) => skillById.get(id)?.name).filter((n): n is string => !!n);

  const education = document.reordered_education_ids
    .map((id) => educationById.get(id))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => ({ institution: e.institution, degree: e.degree, endDate: e.end_date }));

  const certifications = document.reordered_certification_ids
    .map((id) => certificationById.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({ name: c.name, issuer: c.issuer, date: c.date }));

  return {
    contact: facts.contact,
    headline: document.headline.text,
    summary: document.summary.text,
    experience,
    skills,
    education,
    certifications,
    languages: facts.languages.map((l) => ({ name: l.name, level: l.level })),
    language: document.language
  };
}
