import { eq } from "drizzle-orm";
import { schema, type Database } from "@job-radar/db";
import type { CanonicalJob, CvFacts } from "@job-radar/domain";
import { buildAnswers, buildCoverLetter, buildCvPatch } from "./generate.js";
import { validateAnswers, validateCoverLetter, validateCvPatch } from "./factuality.js";
import { renderApplicationMarkdown, type ApplicationBundle } from "./export.js";

const { applications, applicationArtifacts } = schema;

export interface PrepareResult {
  applicationId: string;
  status: "awaiting_human_approval" | "blocked";
  factualityOk: boolean;
  violations: number;
  gaps: string[];
}

/**
 * Generates drafts from the facts vault, runs the factuality gate and stores
 * everything. The result ALWAYS waits for a human: there is no code path from
 * here to any submission (plan Fase 8: no existe endpoint auto_apply).
 */
export async function prepareApplication(
  db: Database,
  job: CanonicalJob,
  facts: CvFacts,
  questions: string[] = []
): Promise<PrepareResult> {
  const cvPatch = buildCvPatch(facts, job);
  const coverLetter = buildCoverLetter(facts, job);
  const answers = buildAnswers(questions, facts);
  const reports = {
    cvPatch: validateCvPatch(cvPatch, facts, job),
    coverLetter: validateCoverLetter(coverLetter, facts, job),
    answers: validateAnswers(answers, facts, job)
  };
  const factualityOk = reports.cvPatch.ok && reports.coverLetter.ok && reports.answers.ok;
  const status = factualityOk ? "awaiting_human_approval" : "blocked";

  const [applicationRow] = await db
    .insert(applications)
    .values({ jobId: job.id, status, factualityOk })
    .returning({ id: applications.id });
  const applicationId = applicationRow!.id;

  await db.insert(applicationArtifacts).values([
    {
      applicationId,
      kind: "cv_patch",
      content: cvPatch,
      factualityReport: reports.cvPatch
    },
    {
      applicationId,
      kind: "cover_letter",
      content: coverLetter,
      factualityReport: reports.coverLetter
    },
    {
      applicationId,
      kind: "answers",
      content: answers,
      factualityReport: reports.answers
    }
  ]);

  return {
    applicationId,
    status,
    factualityOk,
    violations:
      reports.cvPatch.violations.length +
      reports.coverLetter.violations.length +
      reports.answers.violations.length,
    gaps: reports.cvPatch.gaps
  };
}

export class ApprovalError extends Error {}

/**
 * Human-only approval step. Refuses blocked applications; marks the record
 * approved and returns the Markdown export for manual submission.
 */
export async function approveApplication(
  db: Database,
  applicationId: string,
  job: CanonicalJob
): Promise<{ markdown: string }> {
  const rows = await db
    .select()
    .from(applications)
    .where(eq(applications.id, applicationId));
  const application = rows[0];
  if (!application) {
    throw new ApprovalError(`No existe la aplicación ${applicationId}`);
  }
  if (application.status === "blocked" || !application.factualityOk) {
    throw new ApprovalError(
      "La aplicación está bloqueada por el factuality validator; corrige los hechos o la vacante antes de aprobar."
    );
  }
  const artifacts = await db
    .select()
    .from(applicationArtifacts)
    .where(eq(applicationArtifacts.applicationId, applicationId));
  const byKind = new Map(artifacts.map((artifact) => [artifact.kind, artifact]));
  const cvPatch = byKind.get("cv_patch");
  const coverLetter = byKind.get("cover_letter");
  const answers = byKind.get("answers");
  if (!cvPatch || !coverLetter || !answers) {
    throw new ApprovalError("Faltan artefactos generados; vuelve a ejecutar apply:prepare.");
  }
  const bundle: ApplicationBundle = {
    job,
    cvPatch: cvPatch.content as ApplicationBundle["cvPatch"],
    coverLetter: coverLetter.content as ApplicationBundle["coverLetter"],
    answers: answers.content as ApplicationBundle["answers"],
    reports: {
      cvPatch: cvPatch.factualityReport as ApplicationBundle["reports"]["cvPatch"],
      coverLetter: coverLetter.factualityReport as ApplicationBundle["reports"]["coverLetter"],
      answers: answers.factualityReport as ApplicationBundle["reports"]["answers"]
    }
  };
  const markdown = renderApplicationMarkdown(bundle);
  await db
    .update(applications)
    .set({ status: "approved", approvedByHumanAt: new Date(), updatedAt: new Date() })
    .where(eq(applications.id, applicationId));
  await db
    .insert(applicationArtifacts)
    .values({ applicationId, kind: "export_markdown", content: { markdown } });
  return { markdown };
}
