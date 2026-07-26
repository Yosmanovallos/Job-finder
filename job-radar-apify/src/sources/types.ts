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
 * In-memory deduplication for jobs collected across multiple keyword
 * variations within a single adapter run. Uses both URL and content
 * fingerprint (title + company + location) so the same posting found
 * via different keywords is only returned once — without reducing
 * search coverage (every keyword still executes its fetch).
 */
export function deduplicateJobs(jobs: Job[]): Job[] {
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  return jobs.filter(job => {
    const urlKey = job.url.toLowerCase().split('?')[0].split('#')[0];
    const contentKey = `${job.title.toLowerCase().trim()}|${(job.company || '').toLowerCase().trim()}|${(job.location || '').toLowerCase().trim()}`;
    if (seenUrls.has(urlKey) || seenContent.has(contentKey)) return false;
    seenUrls.add(urlKey);
    seenContent.add(contentKey);
    return true;
  });
}
