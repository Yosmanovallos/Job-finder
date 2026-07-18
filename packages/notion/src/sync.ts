import type { CanonicalJob } from "@job-radar/domain";
import type { MatchResult } from "@job-radar/matching";
import { asRateLimited, type NotionApi } from "./api.js";
import { buildNotionRow, type NotionRow } from "./mapping.js";
import type { DeadLetterQueue } from "./dlq.js";
import type { SyncStateStore } from "./state-store.js";

export interface SyncItem {
  job: CanonicalJob;
  match: MatchResult;
}

export interface SyncOperation {
  kind: "create" | "update" | "noop";
  jobId: string;
  title: string;
  pageId: string | null;
  reason: string;
  row: NotionRow;
}

export interface SyncPlan {
  operations: SyncOperation[];
  counts: { create: number; update: number; noop: number };
}

/**
 * Computes create/update/no-op against LOCAL sync state only (plan §14.5:
 * `Job ID` local es la clave idempotente). Fully offline, so --dry-run never
 * needs network. Duplicate protection against lost state happens at execute
 * time (query by Job ID before create) and in reconcile.
 */
export async function planSync(items: SyncItem[], store: SyncStateStore): Promise<SyncPlan> {
  const operations: SyncOperation[] = [];
  for (const item of items) {
    const row = buildNotionRow(item.job, item.match);
    const state = await store.get(item.job.id);
    if (!state) {
      operations.push({
        kind: "create",
        jobId: item.job.id,
        title: item.job.titleRaw,
        pageId: null,
        reason: "sin página registrada",
        row
      });
    } else if (state.lastSyncedHash !== row.syncHash || state.status === "error") {
      operations.push({
        kind: "update",
        jobId: item.job.id,
        title: item.job.titleRaw,
        pageId: state.notionPageId,
        reason: state.status === "error" ? "reintento tras error" : "contenido cambió",
        row
      });
    } else {
      operations.push({
        kind: "noop",
        jobId: item.job.id,
        title: item.job.titleRaw,
        pageId: state.notionPageId,
        reason: "sin cambios (hash idéntico)",
        row
      });
    }
  }
  return {
    operations,
    counts: {
      create: operations.filter((op) => op.kind === "create").length,
      update: operations.filter((op) => op.kind === "update").length,
      noop: operations.filter((op) => op.kind === "noop").length
    }
  };
}

export interface ExecuteOptions {
  api: NotionApi;
  store: SyncStateStore;
  dlq: DeadLetterQueue;
  dataSourceId: string;
  /** Notion allows ~3 req/s on integrations; stay under it. */
  minIntervalMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface ExecuteResult {
  created: number;
  updated: number;
  noop: number;
  adopted: number;
  failed: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * Applies a plan. Retries on 429 honoring Retry-After, exponential backoff on
 * other errors; after maxRetries the operation lands in the DLQ and the state
 * row is marked error — the run continues with the remaining operations.
 */
export async function executeSync(plan: SyncPlan, options: ExecuteOptions): Promise<ExecuteResult> {
  const {
    api,
    store,
    dlq,
    dataSourceId,
    minIntervalMs = 350,
    maxRetries = 4,
    sleep = defaultSleep,
    now = () => new Date()
  } = options;

  const result: ExecuteResult = { created: 0, updated: 0, noop: 0, adopted: 0, failed: 0 };
  let firstRequest = true;

  const throttled = async <T>(call: () => Promise<T>): Promise<T> => {
    if (!firstRequest) {
      await sleep(minIntervalMs);
    }
    firstRequest = false;
    return call();
  };

  const withRetries = async <T>(operation: SyncOperation, call: () => Promise<T>): Promise<T> => {
    let attempt = 0;
    for (;;) {
      try {
        return await throttled(call);
      } catch (error) {
        attempt += 1;
        const rateLimited = asRateLimited(error);
        if (attempt > maxRetries) {
          throw Object.assign(new Error(errorMessage(error)), { attempts: attempt });
        }
        if (rateLimited) {
          await sleep((rateLimited.retryAfterSeconds ?? 1) * 1000);
        } else {
          await sleep(1000 * 2 ** (attempt - 1));
        }
      }
    }
  };

  for (const operation of plan.operations) {
    if (operation.kind === "noop") {
      result.noop += 1;
      continue;
    }
    try {
      if (operation.kind === "create") {
        // Guard against lost local state: never create a visible duplicate.
        const existing = await withRetries(operation, () =>
          api.findPagesByJobId(dataSourceId, operation.jobId)
        );
        if (existing.length > 0) {
          const page = existing[0]!;
          await withRetries(operation, () => api.updatePage(page.id, operation.row.properties));
          await saveSynced(store, operation, page.id, dataSourceId, now());
          result.adopted += 1;
          continue;
        }
        const created = await withRetries(operation, () =>
          api.createPage(dataSourceId, operation.row.properties, operation.row.children)
        );
        await saveSynced(store, operation, created.id, dataSourceId, now());
        result.created += 1;
      } else {
        await withRetries(operation, () =>
          api.updatePage(operation.pageId!, operation.row.properties)
        );
        await saveSynced(store, operation, operation.pageId!, dataSourceId, now());
        result.updated += 1;
      }
    } catch (error) {
      result.failed += 1;
      const attempts = (error as { attempts?: number }).attempts ?? 1;
      dlq.append({
        failedAt: now().toISOString(),
        operation: operation.kind,
        jobId: operation.jobId,
        pageId: operation.pageId,
        error: errorMessage(error),
        attempts
      });
      await store.markError(operation.jobId, errorMessage(error));
    }
  }
  return result;
}

async function saveSynced(
  store: SyncStateStore,
  operation: SyncOperation,
  pageId: string,
  dataSourceId: string,
  at: Date
): Promise<void> {
  const previous = await store.get(operation.jobId);
  await store.upsert({
    jobId: operation.jobId,
    notionPageId: pageId,
    dataSourceId,
    lastSyncedHash: operation.row.syncHash,
    lastSyncedAt: at,
    status: "synced",
    lastError: null,
    humanFields: previous?.humanFields ?? null,
    humanPulledAt: previous?.humanPulledAt ?? null
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Human-readable dry-run rendering for the CLI. */
export function renderPlan(plan: SyncPlan): string {
  const lines = [
    `create: ${plan.counts.create}  update: ${plan.counts.update}  no-op: ${plan.counts.noop}`,
    ""
  ];
  for (const op of plan.operations) {
    if (op.kind !== "noop") {
      lines.push(`${op.kind.toUpperCase().padEnd(6)} ${op.title} (${op.jobId}) — ${op.reason}`);
    }
  }
  return lines.join("\n");
}
