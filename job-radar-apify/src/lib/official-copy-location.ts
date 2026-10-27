/** SQL shared by copy matching and old-copy redirects. Column names are code-owned. */
export const BROAD_LOCATION_KEYS = "('colombia', 'remoto', 'remote')";

// Formatting-only equivalents in Colombian source locations. This never
// equates a neighborhood, department or different city with a municipality.
export function copyMatchLocationSql(column: string): string {
  return `(CASE WHEN ${column} IN ('bogotadc', 'capitaldistrict') THEN 'bogota' ELSE ${column} END)`;
}

export function copySpecificCityMismatchSql(copy: string, official: string): string {
  return `(${copy}.location_key IS NOT NULL AND ${official}.location_key IS NOT NULL
    AND ${copy}.location_key NOT IN ${BROAD_LOCATION_KEYS}
    AND ${official}.location_key NOT IN ${BROAD_LOCATION_KEYS}
    AND ${copyMatchLocationSql(`${copy}.location_key`)} <> ${copyMatchLocationSql(`${official}.location_key`)})`;
}
