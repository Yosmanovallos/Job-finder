/**
 * Recovery snapshots for the bounded Job SEO V2 administrative mutations.
 * Source descriptions are deliberately excluded: these scripts do not modify
 * them, and an operator should not copy source bodies into an export.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./client.js";

export type JobSeoV2StateSnapshot = {
  version: 1;
  capturedAt: string;
  jobs: Array<Record<string, unknown>>;
  pendingQueue: Array<Record<string, unknown>>;
};

const SNAPSHOT_BATCH_SIZE = 1_000;

async function readSnapshotRows(
  columns: string,
  table: "jobs" | "indexing_queue",
  extraWhere = "TRUE"
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let lastId = "00000000-0000-0000-0000-000000000000";
  while (true) {
    const batch = await pool.query<Record<string, unknown> & { id: string }>(
      `SELECT ${columns}
       FROM ${table}
       WHERE ${extraWhere} AND id > $1
       ORDER BY id
       LIMIT $2`,
      [lastId, SNAPSHOT_BATCH_SIZE]
    );
    rows.push(...batch.rows);
    if (batch.rows.length < SNAPSHOT_BATCH_SIZE) break;
    lastId = batch.rows[batch.rows.length - 1].id;
  }
  return rows;
}

export function requireAbsoluteSnapshotPath(value: string | undefined): string {
  if (!value || !path.isAbsolute(value)) {
    throw new Error("Use --snapshot-out=<absolute-json-path>; store it outside the repository.");
  }
  return path.resolve(value);
}

export async function writeJobSeoV2StateSnapshot(
  outputPath: string
): Promise<{ jobs: number; pendingQueue: number; destination: string }> {
  const destination = requireAbsoluteSnapshotPath(outputPath);
  const [jobs, queue] = await Promise.all([
    readSnapshotRows(
      `id, is_active, title, company, location, country, url, source, published_at,
       employment_type, salary_raw, salary_min, salary_max, salary_currency,
       description_source, description_kind, remote_type, applicant_countries, valid_through,
       detail_status, detail_last_error, seo_ready, seo_reasons, seo_evaluated_at,
       seo_ready_at, content_hash, content_updated_at`,
      "jobs"
    ),
    readSnapshotRows(
      "id, status, priority, job_id, content_hash, superseded_at, superseded_reason",
      "indexing_queue",
      "status = 'pending'"
    )
  ]);
  const snapshot: JobSeoV2StateSnapshot = {
    version: 1,
    capturedAt: new Date().toISOString(),
    jobs,
    pendingQueue: queue
  };
  await writeFile(destination, JSON.stringify(snapshot) + "\n", { encoding: "utf8", flag: "wx" });
  return { jobs: jobs.length, pendingQueue: queue.length, destination };
}
