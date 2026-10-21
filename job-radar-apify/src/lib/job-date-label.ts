/**
 * The posting-age text shown on cards and detail pages. A source's own text
 * ("51 minutes ago") wins; a source that states only a date (company
 * portals, Magneto) gets the same kind of relative label computed from
 * publishedAt — never the raw ISO timestamp.
 */
export function jobDateLabel(job: { dateText?: string | null; publishedAt?: string | Date | null }, now: Date = new Date()): string {
  if (job.dateText && job.dateText.trim()) return job.dateText;
  const published = job.publishedAt ? new Date(job.publishedAt) : null;
  if (!published || !Number.isFinite(published.getTime())) return "Reciente";
  const hours = Math.max(0, (now.getTime() - published.getTime()) / 3_600_000);
  if (hours < 1) return "hace menos de 1 h";
  if (hours < 24) return `hace ${Math.floor(hours)} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}
