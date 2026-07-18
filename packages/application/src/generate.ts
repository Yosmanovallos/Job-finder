import type { CanonicalJob, CvFacts } from "@job-radar/domain";
import { SKILL_SYNONYMS } from "@job-radar/matching";
import type { ApplicationAnswers, CoverLetter, CvPatch } from "./drafts.js";
import { missingSkills } from "./factuality.js";

/**
 * Deterministic draft generators. They compose text ONLY out of entries in the
 * facts vault, so they cannot invent experience by construction. An optional
 * future LLM path (prompts P08–P10) must pass the same factuality validator.
 */

function normalize(name: string): string {
  const lower = name.trim().toLowerCase();
  for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
    if (canonical === lower || synonyms.includes(lower)) {
      return canonical;
    }
  }
  return lower;
}

/** Skills the job asks for that the vault CAN back, most relevant first. */
function relevantSkills(facts: CvFacts, job: CanonicalJob): CvFacts["skills"] {
  const wanted = new Set(job.requiredSkills.map(normalize));
  const preferred = new Set(job.preferredSkills.map(normalize));
  return [...facts.skills].sort((a, b) => {
    const rank = (skill: CvFacts["skills"][number]): number => {
      const name = normalize(skill.name);
      if (wanted.has(name)) return 0;
      if (preferred.has(name)) return 1;
      return 2;
    };
    return rank(a) - rank(b);
  });
}

export function buildCvPatch(facts: CvFacts, job: CanonicalJob): CvPatch {
  const ordered = relevantSkills(facts, job);
  const wanted = new Set([...job.requiredSkills, ...job.preferredSkills].map(normalize));
  const matched = ordered.filter((skill) => wanted.has(normalize(skill.name)));
  const current = facts.experience.find((experience) => experience.end_date === null);
  const summaryFacts = [
    ...(current ? [current.id] : []),
    ...matched.slice(0, 3).map((skill) => skill.id)
  ];
  const summaryText = current
    ? `${current.title} en ${current.company}${
        matched.length > 0
          ? `, con experiencia en ${matched
              .slice(0, 3)
              .map((skill) => skill.name)
              .join(", ")}`
          : ""
      }.`
    : matched.length > 0
      ? `Experiencia en ${matched
          .slice(0, 3)
          .map((skill) => skill.name)
          .join(", ")}.`
      : "Perfil profesional basado en los hechos autorizados.";

  const bulletRewrites = facts.experience.flatMap((experience) =>
    experience.achievements.slice(0, 2).map((achievement) => ({
      original_id: achievement.id,
      revised_text: achievement.metric
        ? `${achievement.statement} (${achievement.metric})`
        : achievement.statement,
      supporting_fact_ids: [achievement.id]
    }))
  );

  return {
    summary_revision: {
      text: summaryText,
      supporting_fact_ids: summaryFacts.length > 0 ? summaryFacts : facts.skills.map((s) => s.id)
    },
    reordered_skills: ordered.map((skill) => skill.id),
    bullet_rewrites: bulletRewrites,
    omitted_irrelevant_items: [],
    gaps_not_to_claim: missingSkills(facts, job)
  };
}

export function buildCoverLetter(
  facts: CvFacts,
  job: CanonicalJob,
  maxWords = 180
): CoverLetter {
  const ordered = relevantSkills(facts, job);
  const wanted = new Set(job.requiredSkills.map(normalize));
  const matched = ordered.filter((skill) => wanted.has(normalize(skill.name)));
  const current = facts.experience.find((experience) => experience.end_date === null);

  const paragraphs = [] as CoverLetter["paragraphs"];
  if (current) {
    paragraphs.push({
      text: `Actualmente soy ${current.title} en ${current.company} y me interesa la vacante de ${job.titleRaw}.`,
      supporting_fact_ids: [current.id]
    });
  }
  if (matched.length > 0) {
    paragraphs.push({
      text: `Puedo aportar experiencia respaldada en ${matched
        .slice(0, 4)
        .map((skill) => skill.name)
        .join(", ")}.`,
      supporting_fact_ids: matched.slice(0, 4).map((skill) => skill.id)
    });
  }
  if (paragraphs.length === 0) {
    const anyFact = facts.experience[0] ?? facts.skills[0];
    paragraphs.push({
      text: `Me interesa la vacante de ${job.titleRaw} en ${job.companyNameRaw}.`,
      supporting_fact_ids: anyFact ? [anyFact.id] : []
    });
  }

  let total = 0;
  const bounded = paragraphs.filter((paragraph) => {
    total += paragraph.text.split(/\s+/).length;
    return total <= maxWords;
  });
  const kept = bounded.length > 0 ? bounded : paragraphs.slice(0, 1);
  return {
    paragraphs: kept,
    tone: "directo y específico",
    word_count: kept.reduce((sum, paragraph) => sum + paragraph.text.split(/\s+/).length, 0)
  };
}

/** Common screening questions: answer only when a fact covers it. */
export function buildAnswers(questions: string[], facts: CvFacts): ApplicationAnswers {
  return {
    answers: questions.map((question) => {
      const lower = question.toLowerCase();
      const skill = facts.skills.find((candidate) => lower.includes(normalize(candidate.name)));
      if (skill) {
        return {
          question,
          answer: {
            text: `Sí: ${skill.name}, respaldado por los hechos del CV.`,
            supporting_fact_ids: [skill.id]
          },
          needs_user_input: false
        };
      }
      // Anything else — salary, legal, demographic, work-authorization or data
      // the vault does not cover — is never answered automatically (§20.10).
      return { question, answer: null, needs_user_input: true };
    })
  };
}
