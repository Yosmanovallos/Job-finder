import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { schema, type Database } from "@job-radar/db";
import { loadFacts, type CvFacts } from "@job-radar/domain";
import { rowToCanonical } from "@job-radar/ingestion";
import {
  approveApplication,
  prepareApplication,
  type PrepareResult
} from "@job-radar/application";

/**
 * Facts vault resolution: the real private vault if present, otherwise the
 * example template (useful for dry runs; it contains placeholder facts only).
 */
export function resolveFacts(root: string): { facts: CvFacts; source: string } {
  const privatePath = join(root, "private/cv/facts.yaml");
  if (existsSync(privatePath)) {
    return { facts: loadFacts(privatePath), source: "private/cv/facts.yaml" };
  }
  const examplePath = join(root, "config/cv-facts.example.yaml");
  return { facts: loadFacts(examplePath), source: "config/cv-facts.example.yaml (EJEMPLO)" };
}

export async function applyPrepare(
  db: Database,
  root: string,
  jobId: string,
  questions: string[]
): Promise<PrepareResult & { factsSource: string; jobTitle: string }> {
  const rows = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  const row = rows[0];
  if (!row) {
    throw new Error(`No existe la vacante ${jobId} en la base local.`);
  }
  const job = rowToCanonical(row);
  const { facts, source } = resolveFacts(root);
  const result = await prepareApplication(db, job, facts, questions);
  return { ...result, factsSource: source, jobTitle: job.titleRaw };
}

export async function applyApprove(
  db: Database,
  root: string,
  applicationId: string
): Promise<{ exportPath: string }> {
  const rows = await db
    .select()
    .from(schema.applications)
    .where(eq(schema.applications.id, applicationId));
  const application = rows[0];
  if (!application) {
    throw new Error(`No existe la aplicación ${applicationId}.`);
  }
  const jobRows = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, application.jobId));
  const job = rowToCanonical(jobRows[0]!);
  const { markdown } = await approveApplication(db, applicationId, job);
  const exportDir = join(root, "private/applications");
  mkdirSync(exportDir, { recursive: true });
  const exportPath = join(exportDir, `${applicationId}.md`);
  writeFileSync(exportPath, markdown);
  return { exportPath };
}

export async function applyList(db: Database): Promise<
  { id: string; jobId: string; status: string; factualityOk: boolean; createdAt: Date }[]
> {
  const rows = await db.select().from(schema.applications);
  return rows.map((row) => ({
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    factualityOk: row.factualityOk,
    createdAt: row.createdAt
  }));
}
