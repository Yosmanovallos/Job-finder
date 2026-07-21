// Projection of SECOP QA/AI Opportunities into a dedicated Notion database,
// kept separate from the human-curated "Vacantes" board (tenders are not jobs).
// System-owned only; dry-run-first; idempotent via a file-backed state store so
// no Postgres is required for this discovery bridge.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Opportunity } from "./secop.js";

const TEXT_LIMIT = 1900;
const OPTION_LIMIT = 90;

function truncate(value: string, limit = TEXT_LIMIT): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
function richText(value: string): unknown {
  return { rich_text: value ? [{ text: { content: truncate(value) } }] : [] };
}
function option(name: string): { name: string } {
  return { name: truncate(name.replaceAll(",", ";"), OPTION_LIMIT) };
}
function dateProp(value: string | null): unknown {
  return { date: value ? { start: value } : null };
}

/** Notion property schema for the "Oportunidades" data source (DB creation). */
export const OPPORTUNITY_SCHEMA: Record<string, unknown> = {
  Nombre: { title: {} },
  Entidad: { rich_text: {} },
  Objeto: { rich_text: {} },
  "Presupuesto (COP)": { number: { format: "number" } },
  Modalidad: { select: {} },
  "Tipo de contrato": { select: {} },
  "Categoría (UNSPSC)": { rich_text: {} },
  "Proveedor (si adjudicado)": { rich_text: {} },
  Estado: { select: {} },
  Ciudad: { rich_text: {} },
  Relevancia: { select: { options: [{ name: "Alta" }, { name: "Media" }] } },
  "Términos QA/AI": { multi_select: {} },
  "Fecha publicación": { date: {} },
  "Fecha límite (tentativa)": { date: {} },
  "Presupuesto texto": { rich_text: {} },
  Fuente: { select: { options: [{ name: "SECOP II" }] } },
  "ID proceso": { rich_text: {} },
  URL: { url: {} },
  Descubierto: { date: {} }
};

export interface OppRow {
  properties: Record<string, unknown>;
  children: unknown[];
  syncHash: string;
}

function budgetText(opp: Opportunity): string {
  return opp.presupuestoCop === null ? "" : `${opp.presupuestoCop.toLocaleString("es-CO")} COP`;
}

export function buildOpportunityRow(opp: Opportunity): OppRow {
  const properties: Record<string, unknown> = {
    Nombre: { title: [{ text: { content: truncate(opp.title, 200) } }] },
    Entidad: richText(opp.entidad),
    Objeto: richText(opp.objeto),
    "Presupuesto (COP)": { number: opp.presupuestoCop },
    Modalidad: { select: opp.modalidad ? option(opp.modalidad) : null },
    "Tipo de contrato": { select: opp.tipoContrato ? option(opp.tipoContrato) : null },
    "Categoría (UNSPSC)": richText(opp.categoriaUnspsc ?? ""),
    "Proveedor (si adjudicado)": richText(opp.proveedorAdjudicado ?? ""),
    Estado: { select: opp.estado ? option(opp.estado) : null },
    Ciudad: richText(opp.ciudad ?? ""),
    Relevancia: { select: option(opp.relevance) },
    "Términos QA/AI": { multi_select: opp.matchedTerms.map(option) },
    "Fecha publicación": dateProp(opp.publishedAt),
    "Fecha límite (tentativa)": dateProp(opp.deadlineTentative),
    "Presupuesto texto": richText(budgetText(opp)),
    Fuente: { select: option(opp.sourceName) },
    "ID proceso": richText(opp.externalId),
    URL: { url: opp.url },
    Descubierto: dateProp(opp.discoveredAt)
  };
  return { properties, children: buildChildren(opp), syncHash: computeSyncHash(properties) };
}

function heading(text: string): unknown {
  return {
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ text: { content: text } }] }
  };
}
function paragraph(text: string): unknown {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: text ? [{ text: { content: truncate(text) } }] : [] }
  };
}

function buildChildren(opp: Opportunity): unknown[] {
  return [
    heading("Objeto del proceso"),
    paragraph(opp.objeto || "(sin descripción)"),
    heading("Por qué aparece (evidencia)"),
    paragraph(
      `Coincidencia por palabra clave (descubrimiento, no relevancia semántica confirmada). ` +
        `Términos QA/AI detectados: ${opp.matchedTerms.join(", ")}. ` +
        `Revisa el objeto antes de tratarlo como lead real: la coincidencia léxica puede ser un falso positivo.`
    ),
    heading("Datos del proceso"),
    paragraph(
      [
        `Entidad: ${opp.entidad}`,
        opp.ciudad ? `Ciudad: ${opp.ciudad}` : null,
        opp.modalidad ? `Modalidad: ${opp.modalidad}` : null,
        opp.tipoContrato ? `Tipo de contrato: ${opp.tipoContrato}` : null,
        opp.categoriaUnspsc ? `Categoría (UNSPSC): ${opp.categoriaUnspsc}` : null,
        opp.estado ? `Estado: ${opp.estado}` : null,
        `Presupuesto: ${budgetText(opp) || "no indicado"}`,
        opp.publishedAt ? `Publicado: ${opp.publishedAt}` : null,
        opp.deadlineTentative ? `Recepción (tentativa): ${opp.deadlineTentative}` : null
      ]
        .filter(Boolean)
        .join("\n")
    ),
    heading("Fuente original"),
    paragraph(opp.url ?? "(sin URL)")
  ];
}

/** Hash over stable properties (excludes the volatile "Descubierto" date). */
export function computeSyncHash(properties: Record<string, unknown>): string {
  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(properties).sort()) {
    if (key !== "Descubierto") stable[key] = properties[key];
  }
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

// ---- File-backed state (idempotency without Postgres) --------------------

export interface OppState {
  dataSourceId: string | null;
  databaseId: string | null;
  pages: Record<string, { pageId: string; syncHash: string }>;
}

export function loadState(path: string): OppState {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as OppState;
  } catch {
    return { dataSourceId: null, databaseId: null, pages: {} };
  }
}

export function saveState(path: string, state: OppState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}
