/**
 * D1(b) of openspec/changes/adsense-readiness: a vacancy copied from another
 * job board shows a short excerpt of its text instead of the full copy, is
 * kept out of Google's corpus (noindex, no JobPosting, out of both job
 * sitemaps and of URL_UPDATED) and links the original to read the rest.
 *
 * OFF by default. Turning it on requires docs/adr/0016-third-party-job-excerpt.md
 * to be accepted first (it amends docs/JOBPOSTING-GOOGLE-CONTRACT.md). With
 * the flag off every function here is the identity: the job page HTML is
 * byte for byte what it was before F2 (tests/validate-adsense-f2.test.ts).
 *
 * Read per call, like intentPagesEnabled(), so it can be flipped (and rolled
 * back) from the environment without a code change.
 */
import { jobProvenance } from "./ad-eligibility.js";
import { clipAtWord } from "./job-seo.js";

export const THIRD_PARTY_JOB_EXCERPT_MAX = 300;

export function thirdPartyExcerptEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env.THIRD_PARTY_JOB_EXCERPT_ENABLED || "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "on";
}

/**
 * The first THIRD_PARTY_JOB_EXCERPT_MAX characters of the source's own
 * description, cut at a word. A prefix of the real text, never a summary and
 * never filler: an empty description gives an empty excerpt.
 */
export function buildJobExcerpt(job: { description?: string | null }): string {
  const text = (job.description || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return text ? clipAtWord(text, THIRD_PARTY_JOB_EXCERPT_MAX) : "";
}

/** True when D1(b) is on and this vacancy is a third-party copy. */
export function isExcludedFromGoogleIndex(job: { source?: string | null }, enabled: boolean = thirdPartyExcerptEnabled()): boolean {
  return enabled && jobProvenance(job) === "third_party";
}

/**
 * The job as the public page shows it. Off, or an official vacancy: the same
 * object. On, for a third-party copy: the excerpt replaces the description and
 * the copied requirements are dropped, so the server body, the hydration
 * payload and the meta description all read the same short text.
 */
export function applyThirdPartyExcerpt<T extends { source?: string | null; description?: string | null; requirements?: string[] | null }>(
  job: T,
  enabled: boolean
): T {
  if (!isExcludedFromGoogleIndex(job, enabled)) return job;
  return { ...job, description: buildJobExcerpt(job), requirements: [] };
}
