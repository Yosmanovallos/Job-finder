/** Recalculate relative source text from the stored date so it cannot remain
 * "37 minutes ago" for weeks. Keep explicit unknown text as unknown. */
export function jobDateLabel(job: { dateText?: string | null; publishedAt?: string | Date | null }, now: Date = new Date()): string {
  const sourceText = job.dateText?.trim();
  const published = job.publishedAt ? new Date(job.publishedAt) : null;
  if (sourceText && !/\b(?:ago|hace|hoy|today|ayer|yesterday|now|ahora)\b/i.test(sourceText)) return sourceText;
  if (!published || !Number.isFinite(published.getTime())) return sourceText || "Fecha no indicada";
  const hours = Math.max(0, (now.getTime() - published.getTime()) / 3_600_000);
  if (/^(?:hoy|today)$/i.test(sourceText || "") && hours < 24) return sourceText!;
  if (hours < 1) {
    const minutes = Math.floor(hours * 60);
    return minutes < 1 ? "hace menos de 1 min" : `hace ${minutes} min`;
  }
  if (hours < 24) return `hace ${Math.floor(hours)} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}
