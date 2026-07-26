export interface Job {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  dateText: string;
  source: string;
  publishedAt?: string;
  [key: string]: any;
}

export interface SourceAdapter {
  readonly name: string;
  fetch(keywords: string[], dateRange?: string): Promise<Job[]>;
}

/**
 * Normalizes a job URL for identity comparison: unwraps Google redirect/
 * Translate proxy wrappers and strips known tracking params. Deliberately
 * does NOT drop the whole query string — sources like Indeed encode the
 * job id there (`?jk=<id>`), so a blind `.split('?')[0]` would collapse
 * every distinct posting from that source into one key. Shared by
 * deduplicateJobs (in-memory, per adapter run) and computeUrlHash
 * (DB-level, in job-repository.ts) so both layers agree on identity.
 */
export function normalizeJobUrl(url: string): string {
  let cleaned = url.trim();

  const googleRedirectMatch = cleaned.match(/google\.com\/url\?q=([^&]+)/);
  if (googleRedirectMatch) {
    cleaned = decodeURIComponent(googleRedirectMatch[1]);
  }

  cleaned = cleaned.replace(/https?:\/\/[\w.-]*\.translate\.goog\//, "https://translated.host/");

  return cleaned
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/[?&]_x_tr_[^&]*/g, "")
    .replace(/[?&](utm_\w+|ref|fbclid|gclid)=[^&]*/g, "")
    .replace(/[?&]$/, "")
    .split("#")[0];
}

/**
 * In-memory deduplication for jobs collected across multiple keyword
 * variations within a single adapter run. Uses both URL and content
 * fingerprint (title + company + location) so the same posting found
 * via different keywords is only returned once — without reducing
 * search coverage (every keyword still executes its fetch).
 */
export function deduplicateJobs(jobs: Job[]): Job[] {
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  return jobs.filter((job) => {
    const urlKey = normalizeJobUrl(job.url);
    const contentKey = `${job.title.toLowerCase().trim()}|${(job.company || "confidencial").toLowerCase().trim()}|${(job.location || "colombia").toLowerCase().trim()}`;
    if (seenUrls.has(urlKey) || seenContent.has(contentKey)) return false;
    seenUrls.add(urlKey);
    seenContent.add(contentKey);
    return true;
  });
}
