// Where a visitor came from before opening /empleos/:id, so the job page's
// back link returns there (a company, a city, a role) instead of always to
// the dashboard. Passed as router state by the hub that links to the job;
// a job page opened directly (search result, shared link) has none.

export interface JobOrigin {
  label: string;
  path: string;
}

export function jobOriginState(origin: JobOrigin): { jobOrigin: JobOrigin } {
  return { jobOrigin: origin };
}

/** Only an internal path is accepted ("/x", never "//host" or a URL). */
export function readJobOrigin(state: unknown): JobOrigin | null {
  const origin = (state as { jobOrigin?: Partial<JobOrigin> } | null)?.jobOrigin;
  if (!origin || typeof origin.label !== "string" || typeof origin.path !== "string") return null;
  if (!origin.path.startsWith("/") || origin.path.startsWith("//")) return null;
  return { label: origin.label.slice(0, 80), path: origin.path };
}
