import type { Job } from "../sources/types.js";

export interface SsrJobPayload {
  job: Job;
}

declare global {
  interface Window {
    __SSR_JOB__?: SsrJobPayload;
  }
}

/** Only an anonymous public snapshot of THIS job may replace a detail fetch. */
export function readSsrJob(id: string | undefined, payload: unknown): Job | null {
  if (!id || !payload || typeof payload !== "object") return null;
  const job = (payload as { job?: unknown }).job;
  if (!job || typeof job !== "object") return null;
  const candidate = job as Partial<Job>;
  if (candidate.jobId !== id || candidate.isLocked === true) return null;
  if (
    ![candidate.title, candidate.company, candidate.source, candidate.url].every(
      (value) => typeof value === "string" && value.trim().length > 0
    )
  )
    return null;
  return candidate as Job;
}

/** The same terminal absence semantics as the HTTP job routes. */
export function isMissingJobResponse(status: number): boolean {
  return status === 404 || status === 410;
}
