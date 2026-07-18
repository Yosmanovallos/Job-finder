import { eq } from "drizzle-orm";
import { schema, type Database } from "@job-radar/db";

const { notionSyncState } = schema;

export interface SyncStateRow {
  jobId: string;
  notionPageId: string;
  dataSourceId: string;
  lastSyncedHash: string;
  lastSyncedAt: Date;
  status: string;
  lastError: string | null;
  humanFields: Record<string, unknown> | null;
  humanPulledAt: Date | null;
}

/** Persistence seam so sync/reconcile/pull are testable without Postgres. */
export interface SyncStateStore {
  all(): Promise<SyncStateRow[]>;
  get(jobId: string): Promise<SyncStateRow | null>;
  upsert(row: SyncStateRow): Promise<void>;
  markError(jobId: string, message: string): Promise<void>;
  saveHumanFields(jobId: string, fields: Record<string, unknown>, pulledAt: Date): Promise<void>;
}

export function createInMemoryStateStore(seed: SyncStateRow[] = []): SyncStateStore & {
  rows: Map<string, SyncStateRow>;
} {
  const rows = new Map(seed.map((row) => [row.jobId, { ...row }]));
  return {
    rows,
    async all() {
      return [...rows.values()];
    },
    async get(jobId) {
      return rows.get(jobId) ?? null;
    },
    async upsert(row) {
      rows.set(row.jobId, { ...row });
    },
    async markError(jobId, message) {
      const existing = rows.get(jobId);
      if (existing) {
        rows.set(jobId, { ...existing, status: "error", lastError: message });
      }
    },
    async saveHumanFields(jobId, fields, pulledAt) {
      const existing = rows.get(jobId);
      if (existing) {
        rows.set(jobId, { ...existing, humanFields: fields, humanPulledAt: pulledAt });
      }
    }
  };
}

export function createDbStateStore(db: Database): SyncStateStore {
  return {
    async all() {
      const rows = await db.select().from(notionSyncState);
      return rows.map(toRow);
    },
    async get(jobId) {
      const rows = await db.select().from(notionSyncState).where(eq(notionSyncState.jobId, jobId));
      return rows[0] ? toRow(rows[0]) : null;
    },
    async upsert(row) {
      await db
        .insert(notionSyncState)
        .values({
          jobId: row.jobId,
          notionPageId: row.notionPageId,
          dataSourceId: row.dataSourceId,
          lastSyncedHash: row.lastSyncedHash,
          lastSyncedAt: row.lastSyncedAt,
          status: row.status,
          lastError: row.lastError,
          humanFields: row.humanFields,
          humanPulledAt: row.humanPulledAt
        })
        .onConflictDoUpdate({
          target: notionSyncState.jobId,
          set: {
            notionPageId: row.notionPageId,
            dataSourceId: row.dataSourceId,
            lastSyncedHash: row.lastSyncedHash,
            lastSyncedAt: row.lastSyncedAt,
            status: row.status,
            lastError: row.lastError
          }
        });
    },
    async markError(jobId, message) {
      await db
        .update(notionSyncState)
        .set({ status: "error", lastError: message })
        .where(eq(notionSyncState.jobId, jobId));
    },
    async saveHumanFields(jobId, fields, pulledAt) {
      await db
        .update(notionSyncState)
        .set({ humanFields: fields, humanPulledAt: pulledAt })
        .where(eq(notionSyncState.jobId, jobId));
    }
  };
}

function toRow(row: typeof notionSyncState.$inferSelect): SyncStateRow {
  return {
    jobId: row.jobId,
    notionPageId: row.notionPageId,
    dataSourceId: row.dataSourceId,
    lastSyncedHash: row.lastSyncedHash,
    lastSyncedAt: row.lastSyncedAt,
    status: row.status,
    lastError: row.lastError,
    humanFields: (row.humanFields as Record<string, unknown> | null) ?? null,
    humanPulledAt: row.humanPulledAt
  };
}
