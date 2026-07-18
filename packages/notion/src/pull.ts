import type { NotionApi, NotionPage } from "./api.js";
import { HUMAN_PROPERTIES } from "./schema-spec.js";
import type { SyncStateStore } from "./state-store.js";

/**
 * Extracts ONLY human-owned property values from a page (plan §14.5).
 * Calculated fields like `Match` are never read back.
 */
export function extractHumanFields(page: NotionPage): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const name of Object.keys(HUMAN_PROPERTIES)) {
    const raw = page.properties[name];
    if (raw === undefined) {
      continue;
    }
    fields[name] = parsePropertyValue(raw);
  }
  return fields;
}

function parsePropertyValue(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  switch (value.type) {
    case "select":
      return (value.select as { name?: string } | null)?.name ?? null;
    case "status":
      return (value.status as { name?: string } | null)?.name ?? null;
    case "date":
      return (value.date as { start?: string } | null)?.start ?? null;
    case "rich_text":
      return ((value.rich_text as { plain_text?: string }[] | undefined) ?? [])
        .map((item) => item.plain_text ?? "")
        .join("");
    case "checkbox":
      return value.checkbox ?? null;
    default:
      return null;
  }
}

export interface PullResult {
  pulled: number;
  missingPages: string[];
}

/** Reads human fields for every synced job and stores them locally. */
export async function pullHumanFields(
  api: NotionApi,
  store: SyncStateStore,
  now: () => Date = () => new Date()
): Promise<PullResult> {
  const rows = await store.all();
  const missingPages: string[] = [];
  let pulled = 0;
  for (const row of rows) {
    try {
      const page = await api.retrievePage(row.notionPageId);
      if (page.archived) {
        missingPages.push(row.jobId);
        continue;
      }
      await store.saveHumanFields(row.jobId, extractHumanFields(page), now());
      pulled += 1;
    } catch {
      missingPages.push(row.jobId);
    }
  }
  return { pulled, missingPages };
}
