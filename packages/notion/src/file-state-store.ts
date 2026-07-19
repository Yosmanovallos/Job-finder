// File-backed SyncStateStore: same contract as the Postgres store, so planSync/
// executeSync/reconcile work without a database (this environment has no Postgres).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SyncStateRow, SyncStateStore } from "./state-store.js";

interface Serialized {
  rows: Record<string, Omit<SyncStateRow, "lastSyncedAt" | "humanPulledAt"> & {
    lastSyncedAt: string;
    humanPulledAt: string | null;
  }>;
}

export function createFileStateStore(path: string): SyncStateStore {
  const load = (): Map<string, SyncStateRow> => {
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as Serialized;
      const map = new Map<string, SyncStateRow>();
      for (const [id, r] of Object.entries(data.rows)) {
        map.set(id, {
          ...r,
          lastSyncedAt: new Date(r.lastSyncedAt),
          humanPulledAt: r.humanPulledAt ? new Date(r.humanPulledAt) : null
        });
      }
      return map;
    } catch {
      return new Map();
    }
  };

  const save = (rows: Map<string, SyncStateRow>): void => {
    const serialized: Serialized = { rows: {} };
    for (const [id, r] of rows) {
      serialized.rows[id] = {
        ...r,
        lastSyncedAt: r.lastSyncedAt.toISOString(),
        humanPulledAt: r.humanPulledAt ? r.humanPulledAt.toISOString() : null
      };
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(serialized, null, 2)}\n`);
  };

  return {
    async all() {
      return [...load().values()];
    },
    async get(jobId) {
      return load().get(jobId) ?? null;
    },
    async upsert(row) {
      const rows = load();
      rows.set(row.jobId, { ...row });
      save(rows);
    },
    async markError(jobId, message) {
      const rows = load();
      const existing = rows.get(jobId);
      if (existing) {
        rows.set(jobId, { ...existing, status: "error", lastError: message });
        save(rows);
      }
    },
    async saveHumanFields(jobId, fields, pulledAt) {
      const rows = load();
      const existing = rows.get(jobId);
      if (existing) {
        rows.set(jobId, { ...existing, humanFields: fields, humanPulledAt: pulledAt });
        save(rows);
      }
    }
  };
}
