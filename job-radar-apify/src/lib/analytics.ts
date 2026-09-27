const ACQUISITION_STORAGE_KEY = "bt_acquisition_v1";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

type UtmKey = (typeof UTM_KEYS)[number];
export type AcquisitionParams = Partial<Record<UtmKey, string>>;

export type AnalyticsEventMap = {
  sign_up: { method: "email" | "google" };
  login: { method: "email" | "google" };
  onboarding_complete: { role_count: number; skipped: boolean };
  apply_gate_open: JobAnalyticsParams;
  outbound_apply: JobAnalyticsParams;
  view_job: Omit<JobAnalyticsParams, "surface"> & { surface: "job_page" };
  page_view: {
    page_path: string;
    page_location: string;
    page_title: string;
  };
};

export interface JobAnalyticsParams {
  job_id: string;
  job_source: string;
  surface: "dashboard_card" | "dashboard_detail" | "job_page" | "apply_gate" | "post_signup";
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function cleanCampaignValue(value: string | null): string | undefined {
  if (!value) return undefined;
  const cleaned = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 100);
  return cleaned || undefined;
}

export function parseAcquisition(search: string): AcquisitionParams {
  const params = new URLSearchParams(search);
  const acquisition: AcquisitionParams = {};
  for (const key of UTM_KEYS) {
    const value = cleanCampaignValue(params.get(key));
    if (value) acquisition[key] = value;
  }
  return acquisition;
}

function readStoredAcquisition(): AcquisitionParams {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(ACQUISITION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const acquisition: AcquisitionParams = {};
    for (const key of UTM_KEYS) {
      const value = typeof parsed[key] === "string" ? cleanCampaignValue(parsed[key]) : undefined;
      if (value) acquisition[key] = value;
    }
    return acquisition;
  } catch {
    return {};
  }
}

export function captureAcquisition(search?: string): AcquisitionParams {
  if (typeof window === "undefined") return {};
  const current = parseAcquisition(search ?? window.location.search);
  if (Object.keys(current).length === 0) return readStoredAcquisition();
  try {
    window.sessionStorage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Analytics must never break navigation when storage is unavailable.
  }
  return current;
}

export function sanitizeAnalyticsPath(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] || "/";
  return withoutQuery.startsWith("/") ? withoutQuery : "/";
}

function dispatch(name: string, params: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  if (typeof window.gtag === "function") {
    window.gtag("event", name, params);
    return;
  }
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(["event", name, params]);
}

export function trackEvent<Name extends keyof AnalyticsEventMap>(
  name: Name,
  params: AnalyticsEventMap[Name]
): void {
  if (typeof window === "undefined") return;
  const pagePath = sanitizeAnalyticsPath(window.location.pathname);
  dispatch(name, {
    ...captureAcquisition(),
    page_path: pagePath,
    ...params
  });
}

export function trackPageView(pathname: string, title = document.title): void {
  if (typeof window === "undefined") return;
  const pagePath = sanitizeAnalyticsPath(pathname);
  trackEvent("page_view", {
    page_path: pagePath,
    page_location: `${window.location.origin}${pagePath}`,
    page_title: title
  });
}

export function jobAnalyticsParams(
  job: { jobId?: string; source?: string },
  surface: JobAnalyticsParams["surface"]
): JobAnalyticsParams {
  return {
    job_id: String(job.jobId || "unknown").slice(0, 100),
    job_source: String(job.source || "unknown").slice(0, 100),
    surface
  };
}
