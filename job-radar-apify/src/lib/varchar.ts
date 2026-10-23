/**
 * Fits text into a VARCHAR(n) column (jobs.company, location, salary_raw,
 * role_origin are VARCHAR(255)). One over-long value used to abort the whole
 * save: tick 2026-10-22 23:44, a Magneto vacancy listing every city of the
 * country failed all 186 catalog rows with "value too long". Cut on code
 * points, marking the cut with an ellipsis.
 */
export function clipVarchar<T extends string | null | undefined>(value: T, max = 255): T {
  if (typeof value !== "string") return value;
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return (chars.slice(0, max - 1).join("") + "…") as T;
}
