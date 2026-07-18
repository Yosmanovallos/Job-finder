import type { CanonicalJob } from "@job-radar/domain";
import type { ApplicationAnswers, CoverLetter, CvPatch } from "./drafts.js";
import type { FactualityReport } from "./factuality.js";

export interface ApplicationBundle {
  job: CanonicalJob;
  cvPatch: CvPatch;
  coverLetter: CoverLetter;
  answers: ApplicationAnswers;
  reports: { cvPatch: FactualityReport; coverLetter: FactualityReport; answers: FactualityReport };
}

/**
 * Markdown export for human review/manual submission. The system never sends
 * this anywhere: the human copies what they approve into the real application.
 */
export function renderApplicationMarkdown(bundle: ApplicationBundle): string {
  const { job, cvPatch, coverLetter, answers } = bundle;
  const lines: string[] = [
    `# Candidatura: ${job.titleRaw} — ${job.companyNameRaw}`,
    "",
    `- Vacante: ${job.canonicalUrl}`,
    `- Aplicar: ${job.applyUrl ?? "(sin URL de aplicación)"}`,
    "",
    "> ⚠️ Borrador asistido. Revisa, edita y envía manualmente.",
    "> El sistema no envía candidaturas (no existe auto-apply).",
    "",
    "## Resumen propuesto",
    "",
    cvPatch.summary_revision.text,
    "",
    "## Bullets reescritos",
    ""
  ];
  for (const bullet of cvPatch.bullet_rewrites) {
    lines.push(`- ${bullet.revised_text}  _(facts: ${bullet.supporting_fact_ids.join(", ")})_`);
  }
  lines.push("", "## Brechas que NO se deben afirmar", "");
  if (cvPatch.gaps_not_to_claim.length === 0) {
    lines.push("- (ninguna detectada)");
  }
  for (const gap of cvPatch.gaps_not_to_claim) {
    lines.push(`- ${gap}`);
  }
  lines.push("", "## Carta / mensaje", "");
  for (const paragraph of coverLetter.paragraphs) {
    lines.push(paragraph.text, "");
  }
  lines.push("## Respuestas de aplicación", "");
  for (const entry of answers.answers) {
    lines.push(`**${entry.question}**`);
    lines.push(
      entry.needs_user_input || !entry.answer
        ? "_Requiere tu respuesta manual._"
        : entry.answer.text,
      ""
    );
  }
  return lines.join("\n");
}
