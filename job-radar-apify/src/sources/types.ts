export interface Job {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  dateText: string;
  source: string;
  publishedAt?: string;
  // ISO 3166-1 alpha-2 ('CO'/'VE'), or null for remote (shown to every
  // country — see schema.sql's jobs.country comment). Stamped by
  // ScrapeWorker.processRoleJob from the tick's country, not by individual
  // adapters — see src/queue/scrape-worker.ts.
  country?: string | null;
  // Detalle enriquecido — opcional porque solo algunas fuentes lo traen en
  // su respuesta (ver src/db/schema.sql y scripts/migrate-job-details.ts).
  // Nunca inventado: si la fuente no lo publica, el campo se omite.
  description?: string;
  requirements?: string[];
  technologies?: string[];
  employmentType?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryRaw?: string;
  applicantCount?: number;
  [key: string]: any;
}

// Subset of Job's enrichment fields a detail-page fetch can fill in —
// deliberately excludes identity fields (title/company/location/url/...):
// a detail fetcher only ever adds detail to a job the search-results fetch
// already identified, never redefines what the job IS.
export type JobDetail = Pick<
  Job,
  | "description"
  | "requirements"
  | "technologies"
  | "employmentType"
  | "salaryMin"
  | "salaryMax"
  | "salaryCurrency"
  | "salaryRaw"
  | "applicantCount"
>;

export interface SourceAdapter {
  readonly name: string;
  fetch(keywords: string[], dateRange?: string): Promise<Job[]>;
  // Optional: fetches the rich detail for ONE job's own page. Only called by
  // ScrapeWorker for jobs that were genuinely new this tick (never on every
  // re-scrape — see saveJobs()/updateJobDetail() in job-repository.ts), so a
  // source without this simply never gets the extra request. Returns null
  // (not a partial/guessed object) when the detail page didn't yield
  // anything usable.
  fetchDetail?(url: string): Promise<Partial<JobDetail> | null>;
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

/**
 * Unwraps a Google redirect wrapper (`google.com/url?q=...`), preserving
 * case and scheme — unlike normalizeJobUrl, which is for identity
 * comparison only and deliberately lowercases/strips the protocol. Detail
 * fetchers need the real fetchable URL, not a comparison key.
 */
export function resolveOutboundUrl(url: string): string {
  const googleRedirectMatch = url.trim().match(/google\.com\/url\?q=([^&]+)/);
  return googleRedirectMatch ? decodeURIComponent(googleRedirectMatch[1]) : url.trim();
}
