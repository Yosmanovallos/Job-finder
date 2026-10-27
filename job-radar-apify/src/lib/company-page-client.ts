import type { ReputationEntryProps } from "../components/ReputationBadges.js";
import type { Job } from "../sources/types.js";
import { buildCompanyPath } from "./job-seo.js";

// Client side of GET /api/companies/:slug. Links to a company start the
// request on hover/press (prefetchCompanyPage), so the click usually finds
// it already in flight or done, and going back and forth between the
// directory and a company never refetches within a few minutes.

export interface CompanyPagePayload {
  companyName: string;
  logoUrl: string | null;
  reputation: ReputationEntryProps[];
  officialCareersUrl: string | null;
  jobs: Job[];
  total: number;
}

// What a company link already knows, so the company page can paint its
// header at once instead of a skeleton (passed as router state).
export interface CompanyPreview {
  companyName: string;
  logoUrl: string | null;
  count: number;
}

const FRESH_MS = 5 * 60_000;
const MAX_ENTRIES = 24;
const cache = new Map<string, { at: number; request: Promise<CompanyPagePayload | null> }>();

function cacheKey(slug: string, country: string, accessToken: string | null): string {
  // A signed-in visitor can get a different (unmasked) payload than an
  // anonymous one, so the two never share an entry.
  return `${country}|${slug}|${accessToken ? "auth" : "anon"}`;
}

/** Resolves to null when the company doesn't exist in this country (404). */
export function fetchCompanyPage(slug: string, country: string, accessToken: string | null): Promise<CompanyPagePayload | null> {
  const key = cacheKey(slug, country, accessToken);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.request;

  const headers: HeadersInit = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const request = fetch(`/api/companies/${encodeURIComponent(slug)}?country=${country}`, { headers }).then((res) => {
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Company page unavailable");
    return res.json() as Promise<CompanyPagePayload>;
  });
  cache.set(key, { at: Date.now(), request });
  // A failed request is never reused: the next visit tries again.
  request.catch(() => {
    if (cache.get(key)?.request === request) cache.delete(key);
  });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return request;
}

export function prefetchCompanyPage(slug: string, country: string, accessToken: string | null): void {
  fetchCompanyPage(slug, country, accessToken).catch(() => {
    // Prefetch is best effort; the page's own request reports errors.
  });
}

/**
 * Props for a <Link> to a company page: its path, the preview the page
 * paints first, and a prefetch on hover, keyboard focus or press (a tap
 * fires pointerdown ~100 ms before the click navigates).
 */
export function companyLinkProps(company: CompanyPreview, country: string, accessToken: string | null) {
  const to = buildCompanyPath(company.companyName, country);
  const slug = to.slice(to.lastIndexOf("/") + 1);
  const prefetch = () => prefetchCompanyPage(slug, country, accessToken);
  return {
    to,
    state: { companyPreview: company },
    onPointerEnter: prefetch,
    onPointerDown: prefetch,
    onFocus: prefetch
  };
}
