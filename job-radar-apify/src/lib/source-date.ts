/** Converts a source-stated posting age into a timestamp observed at `now`.
 * Unknown text is rejected: silently treating it as "today" makes old jobs
 * appear newly published and pass freshness filters without evidence.
 */
export function parseDateText(
  dateText: string,
  maxDays = 2,
  now: Date = new Date()
): { date: string; valid: boolean } {
  const text = dateText.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let ageMs: number;
  if (/^(?:publicad[oa]\s+)?(?:hoy|today|ahora|now|just now)$/.test(text)) {
    ageMs = 0;
  } else if (/^(?:publicad[oa]\s+)?(?:ayer|yesterday)$/.test(text)) {
    ageMs = 86_400_000;
  } else {
    const match = /(?:^|\s)(\d+)\s*(segundos?|seconds?|secs?|minutos?|minutes?|mins?|horas?|hours?|hrs?|dias?|days?|semanas?|weeks?|meses?|months?)(?:\s|$)/.exec(text);
    if (!match) return { date: "", valid: false };
    const quantity = Number(match[1]);
    const unit = match[2];
    const multiplier = /^(?:seg|sec)/.test(unit) ? 1_000
      : /^(?:min)/.test(unit) ? 60_000
      : /^(?:hor|hour|hr)/.test(unit) ? 3_600_000
      : /^(?:dia|day)/.test(unit) ? 86_400_000
      : /^(?:sem|week)/.test(unit) ? 604_800_000
      : 2_592_000_000;
    ageMs = quantity * multiplier;
  }
  if (!Number.isFinite(ageMs) || ageMs > maxDays * 86_400_000) return { date: "", valid: false };
  return { date: new Date(now.getTime() - ageMs).toISOString(), valid: true };
}
