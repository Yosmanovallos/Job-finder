import type { NotionApi, NotionPage } from "./api.js";
import type { SyncStateStore } from "./state-store.js";

export interface ReconcileReport {
  /** Job IDs that appear on 2+ pages. Reported for human action, NEVER deleted. */
  duplicates: { jobId: string; pageIds: string[] }[];
  /** Pages with a Job ID that local state didn't know about; adopted into state. */
  adopted: { jobId: string; pageId: string }[];
  /** State rows whose page is archived/missing; marked for re-create next sync. */
  missingPages: string[];
  /** Pages without a readable Job ID; reported only. */
  unidentified: string[];
}

function jobIdOf(page: NotionPage): string | null {
  const raw = page.properties["Job ID"];
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const items = (raw as { rich_text?: { plain_text?: string }[] }).rich_text ?? [];
  const text = items.map((item) => item.plain_text ?? "").join("").trim();
  return text.length > 0 ? text : null;
}

/**
 * Non-destructive reconciliation (D06): re-aligns local state with what exists
 * in Notion. Never archives pages, never touches page content or human fields.
 */
export async function reconcile(
  api: NotionApi,
  store: SyncStateStore,
  dataSourceId: string,
  options: { dryRun: boolean; now?: () => Date }
): Promise<ReconcileReport> {
  const now = options.now ?? (() => new Date());
  const pages = await api.queryAllPages(dataSourceId);
  const byJobId = new Map<string, NotionPage[]>();
  const unidentified: string[] = [];
  for (const page of pages) {
    const jobId = jobIdOf(page);
    if (!jobId) {
      unidentified.push(page.id);
      continue;
    }
    byJobId.set(jobId, [...(byJobId.get(jobId) ?? []), page]);
  }

  const report: ReconcileReport = { duplicates: [], adopted: [], missingPages: [], unidentified };
  const stateRows = await store.all();
  const stateByJobId = new Map(stateRows.map((row) => [row.jobId, row]));

  for (const [jobId, jobPages] of byJobId) {
    if (jobPages.length > 1) {
      report.duplicates.push({ jobId, pageIds: jobPages.map((page) => page.id) });
    }
    const known = stateByJobId.get(jobId);
    const page = jobPages[0]!;
    if (!known) {
      report.adopted.push({ jobId, pageId: page.id });
      if (!options.dryRun) {
        await store.upsert({
          jobId,
          notionPageId: page.id,
          dataSourceId,
          // Unknown remote content: blank hash forces an update on next sync.
          lastSyncedHash: "",
          lastSyncedAt: now(),
          status: "adopted",
          lastError: null,
          humanFields: null,
          humanPulledAt: null
        });
      }
    }
  }

  const livePageIds = new Set(pages.map((page) => page.id));
  for (const row of stateRows) {
    if (!livePageIds.has(row.notionPageId)) {
      report.missingPages.push(row.jobId);
      if (!options.dryRun) {
        await store.markError(row.jobId, "page missing or archived in Notion");
      }
    }
  }
  return report;
}
