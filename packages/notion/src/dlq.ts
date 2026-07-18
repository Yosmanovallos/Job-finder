import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface DlqEntry {
  failedAt: string;
  operation: string;
  jobId: string;
  pageId: string | null;
  error: string;
  attempts: number;
}

/** Dead-letter queue for Notion writes that exhausted retries (plan §14.5). */
export interface DeadLetterQueue {
  append(entry: DlqEntry): void;
}

export function createFileDlq(path: string): DeadLetterQueue {
  return {
    append(entry) {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(entry)}\n`);
    }
  };
}

export function readDlq(path: string): DlqEntry[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DlqEntry);
}
