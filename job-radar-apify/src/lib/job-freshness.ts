/**
 * The single definition of "a job that may be shown" (bug reported
 * 2026-10-04: postings closed or older than a month were still live).
 *
 * A job is live only while BOTH hold:
 *   - it was published within the last MAX_JOB_AGE_DAYS days, and
 *   - the source's own expiration date (`valid_through`), when it states one,
 *     has not passed.
 *
 * Every public read path filters with liveJobSql(), purgeOldJobs() deletes
 * what fails it, and validateJobs() refuses to ingest it — one rule in three
 * places, never three hand-written copies.
 *
 * `published_at` is set once at first sighting and never updated on a
 * re-scrape (see saveJobs' ON CONFLICT), so it answers "how old is this
 * posting", unlike `last_seen_at`, which a source that keeps listing an old
 * posting refreshes on every tick.
 */

export const MAX_JOB_AGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * SQL predicate, true for a live row. `alias` is the jobs table alias in the
 * calling query, or "" for an unaliased `FROM jobs`. The comparison on
 * valid_through matches seoReadySql() (src/lib/google-job-readiness.ts).
 */
export function liveJobSql(alias = ""): string {
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  return `(${col("published_at")} >= NOW() - INTERVAL '${MAX_JOB_AGE_DAYS} days' AND (${col("valid_through")} IS NULL OR ${col("valid_through")} > NOW()))`;
}

/** Why a job may not be shown, or null when it is live. Pure twin of liveJobSql(). */
export function jobStaleReason(
  publishedAt: string | Date | null | undefined,
  validThrough: string | Date | null | undefined,
  now: Date = new Date()
): string | null {
  if (publishedAt) {
    const published = new Date(publishedAt).getTime();
    if (Number.isFinite(published) && published < now.getTime() - MAX_JOB_AGE_DAYS * DAY_MS) {
      return `publicada hace más de ${MAX_JOB_AGE_DAYS} días`;
    }
  }
  if (validThrough) {
    const expires = new Date(validThrough).getTime();
    if (Number.isFinite(expires) && expires <= now.getTime()) return "vencida según la fuente (validThrough)";
  }
  return null;
}
