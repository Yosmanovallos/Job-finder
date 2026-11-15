// Client-side half of /guias links (adsense-readiness F3): types and the
// validator for window.__SSR_GUIDE_LINKS__. Kept apart from guides.ts so
// hub and job pages never download the Markdown parser and validator.

export const GUIDES_BASE_PATH = "/guias";
export const MAX_RELATED_GUIDES = 3;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function guidePath(slug: string): string {
  return `${GUIDES_BASE_PATH}/${slug}`;
}

export interface GuideSummary {
  slug: string;
  path: string;
  title: string;
  description: string;
  datePublished: string;
  dateModified: string;
}

export interface SsrGuideLinks {
  path: string;
  links: GuideSummary[];
}

export function isGuideSummaryList(value: unknown): value is GuideSummary[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const v = item as Record<string, unknown>;
    return typeof v.slug === "string" && SLUG_RE.test(v.slug) && typeof v.title === "string" && typeof v.path === "string" && v.path === guidePath(v.slug);
  });
}

/** Validates window.__SSR_GUIDE_LINKS__: only for this exact page, at most three /guias links. */
export function readSsrGuideLinks(value: unknown, pathname: string): GuideSummary[] {
  if (!value || typeof value !== "object") return [];
  const v = value as Record<string, unknown>;
  if (v.path !== pathname || !isGuideSummaryList(v.links)) return [];
  return v.links.slice(0, MAX_RELATED_GUIDES);
}
