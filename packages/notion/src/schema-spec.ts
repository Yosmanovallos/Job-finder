import type { NotionDataSourceInfo } from "./api.js";

/**
 * Expected `Vacantes` data source schema (plan §14.2, MVP subset).
 * schema:check validates presence and type before any write.
 */
export const REQUIRED_PROPERTIES: Record<string, string> = {
  Nombre: "title",
  "Job ID": "rich_text",
  Empresa: "rich_text",
  URL: "url",
  Aplicar: "url",
  "Fuente principal": "select",
  Ubicación: "rich_text",
  Modalidad: "select",
  "Fecha publicada": "date",
  "Primera vez vista": "date",
  "Última verificación": "date",
  Vigencia: "status",
  Match: "number",
  Confianza: "number",
  Prioridad: "select",
  "Skills match": "multi_select",
  "Skills faltantes": "multi_select",
  Blockers: "rich_text",
  Salario: "rich_text",
  Sponsorship: "select",
  Idioma: "multi_select",
  "Actualizado por sistema": "date"
};

/**
 * Human-owned properties (plan §14.5): read back, NEVER written by the system.
 * They may be absent from a fresh data source; schema:check only warns.
 */
export const HUMAN_PROPERTIES: Record<string, string> = {
  Decisión: "select",
  "Estado aplicación": "status",
  "Fecha aplicación": "date",
  "Revisión humana": "select",
  Notas: "rich_text",
  "Prioridad manual": "select"
};

export interface SchemaCheckResult {
  ok: boolean;
  missing: string[];
  typeMismatches: { property: string; expected: string; actual: string }[];
  missingHuman: string[];
}

export function checkSchema(dataSource: NotionDataSourceInfo): SchemaCheckResult {
  const missing: string[] = [];
  const typeMismatches: SchemaCheckResult["typeMismatches"] = [];
  for (const [name, expected] of Object.entries(REQUIRED_PROPERTIES)) {
    const actual = dataSource.properties[name];
    if (!actual) {
      missing.push(name);
    } else if (actual.type !== expected) {
      typeMismatches.push({ property: name, expected, actual: actual.type });
    }
  }
  const missingHuman = Object.keys(HUMAN_PROPERTIES).filter(
    (name) => !dataSource.properties[name]
  );
  return {
    ok: missing.length === 0 && typeMismatches.length === 0,
    missing,
    typeMismatches,
    missingHuman
  };
}
