import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { Database } from "@job-radar/db";
import { schema } from "@job-radar/db";
import { buildAdapter, type SourceAdapter, type SourceConfig } from "@job-radar/sources";
import { rowToCanonical } from "./persist-job.js";

export interface VerifyOptions {
  configs: SourceConfig[];
  /** Re-check jobs whose last verification is older than this. */
  dueHours?: number;
  limit?: number;
  adapterFactory?: (config: SourceConfig) => SourceAdapter;
}

export interface VerifyReport {
  checked: number;
  active: number;
  possiblyActive: number;
  closed: number;
  unknown: number;
}

/**
 * Freshness verification (plan §12). A job is only closed after TWO
 * consecutive explicit negative signals — a single 404 downgrades to
 * possibly_active, and technical errors never close anything.
 */
export async function runVerify(db: Database, options: VerifyOptions): Promise<VerifyReport> {
  const dueHours = options.dueHours ?? 24;
  const limit = options.limit ?? 50;
  const cutoff = new Date(Date.now() - dueHours * 3_600_000);

  const due = await db.query.jobs.findMany({
    where: and(
      inArray(schema.jobs.status, ["active", "possibly_active", "unknown"]),
      or(isNull(schema.jobs.lastVerifiedAt), lt(schema.jobs.lastVerifiedAt, cutoff))
    ),
    limit
  });

  const factory = options.adapterFactory ?? buildAdapter;
  const adapters = new Map<string, SourceAdapter>();
  for (const config of options.configs) {
    adapters.set(config.id, factory(config));
  }

  const report: VerifyReport = { checked: 0, active: 0, possiblyActive: 0, closed: 0, unknown: 0 };
  const now = new Date();

  for (const row of due) {
    const occurrence = await db.query.sourceOccurrences.findFirst({
      where: eq(schema.sourceOccurrences.jobId, row.id)
    });
    const adapter = occurrence ? adapters.get(occurrence.sourceId) : undefined;
    if (!adapter) {
      continue;
    }
    report.checked += 1;

    let result: { status: "active" | "closed" | "unknown"; httpStatus: number | null; detail: string | null };
    try {
      const canonical = rowToCanonical(row);
      const verification = await adapter.verify({
        ...canonical,
        sourceUrl: occurrence!.sourceUrl
      });
      result = {
        status: verification.status,
        httpStatus: verification.httpStatus,
        detail: verification.detail
      };
    } catch (error) {
      result = {
        status: "unknown",
        httpStatus: null,
        detail: error instanceof Error ? error.message : String(error)
      };
    }

    await db.insert(schema.jobVerifications).values({
      jobId: row.id,
      checkedAt: now,
      method: "api",
      httpStatus: result.httpStatus,
      result: result.status,
      detail: result.detail
    });

    if (result.status === "active") {
      await db
        .update(schema.jobs)
        .set({ status: "active", lastVerifiedAt: now })
        .where(eq(schema.jobs.id, row.id));
      report.active += 1;
      continue;
    }

    if (result.status === "closed") {
      const previous = await db.query.jobVerifications.findMany({
        where: eq(schema.jobVerifications.jobId, row.id),
        orderBy: [desc(schema.jobVerifications.checkedAt)],
        limit: 2
      });
      const consecutiveClosed =
        previous.length === 2 && previous.every((entry) => entry.result === "closed");
      await db
        .update(schema.jobs)
        .set({
          status: consecutiveClosed ? "closed" : "possibly_active",
          lastVerifiedAt: now
        })
        .where(eq(schema.jobs.id, row.id));
      if (consecutiveClosed) {
        report.closed += 1;
      } else {
        report.possiblyActive += 1;
      }
      continue;
    }

    // Technical error / contradictory signal: never close (plan §12.2).
    await db
      .update(schema.jobs)
      .set({ status: "possibly_active", lastVerifiedAt: now })
      .where(eq(schema.jobs.id, row.id));
    report.unknown += 1;
  }

  return report;
}
