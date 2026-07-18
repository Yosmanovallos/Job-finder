import { createHash } from "node:crypto";
import type { CanonicalJob } from "@job-radar/domain";
import type { MatchResult } from "@job-radar/matching";
import { HUMAN_PROPERTIES } from "./schema-spec.js";

/** Notion rich_text content objects cap at 2000 chars. */
const TEXT_LIMIT = 1900;
/** Multi-select option names: no commas, keep them short. */
const OPTION_LIMIT = 80;
const MAX_OPTIONS = 20;

function truncate(value: string, limit = TEXT_LIMIT): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function richText(value: string): unknown {
  return { rich_text: value ? [{ text: { content: truncate(value) } }] : [] };
}

function option(name: string): { name: string } {
  return { name: truncate(name.replaceAll(",", ";"), OPTION_LIMIT) };
}

function multiSelect(values: string[]): unknown {
  return { multi_select: values.slice(0, MAX_OPTIONS).map(option) };
}

function date(value: string | null): unknown {
  return { date: value ? { start: value } : null };
}

const WORK_MODE_LABEL: Record<CanonicalJob["workMode"], string> = {
  remote: "Remoto",
  hybrid: "Híbrido",
  onsite: "Presencial",
  unknown: "Desconocida"
};

const SPONSORSHIP_LABEL: Record<CanonicalJob["visaSponsorship"], string> = {
  yes: "Sí",
  no: "No",
  unknown: "Desconocido"
};

const STATUS_LABEL: Record<CanonicalJob["status"], string> = {
  active: "Activa",
  possibly_active: "Posiblemente activa",
  closed: "Cerrada",
  unknown: "Desconocida"
};

const PRIORITY_LABEL: Record<MatchResult["decision"], string> = {
  priority: "Alta",
  consider: "Media",
  discard: "Baja",
  reject: "Descartada"
};

function locationSummary(job: CanonicalJob): string {
  const parts = job.locations.map((location) => location.raw).filter(Boolean);
  if (parts.length === 0) {
    return job.remoteRegion ?? "";
  }
  return parts.slice(0, 5).join(" | ");
}

function salarySummary(job: CanonicalJob): string {
  const { min, max, currency, period, source } = job.compensation;
  if (source === "unknown" || (min === null && max === null)) {
    return "";
  }
  const range = [min, max]
    .filter((value): value is number => value !== null)
    .map((value) => value.toLocaleString("en-US"))
    .join(" – ");
  return [range, currency ?? "", period ? `/${period}` : ""].filter(Boolean).join(" ").trim();
}

export interface NotionRow {
  /** System-owned property payloads, ready for pages.create/update. */
  properties: Record<string, unknown>;
  /** Page body blocks (create only; updates never touch human-edited bodies). */
  children: unknown[];
  /** Stable hash of the system-owned payload; equal hash => no-op. */
  syncHash: string;
}

/**
 * Projects a canonical job + match result into Notion `Vacantes` properties.
 * Only system-owned fields — human-owned properties (plan §14.5) are never
 * emitted here, which structurally prevents overwriting human edits.
 */
export function buildNotionRow(job: CanonicalJob, match: MatchResult): NotionRow {
  const properties: Record<string, unknown> = {
    Nombre: { title: [{ text: { content: truncate(job.titleRaw, 200) } }] },
    "Job ID": richText(job.id),
    Empresa: richText(job.companyNameRaw),
    URL: { url: job.canonicalUrl },
    Aplicar: { url: job.applyUrl },
    "Fuente principal": { select: option(job.sourceId.split(":")[0] ?? job.sourceId) },
    Ubicación: richText(locationSummary(job)),
    Modalidad: { select: option(WORK_MODE_LABEL[job.workMode]) },
    "Fecha publicada": date(job.publishedAt),
    "Primera vez vista": date(job.firstSeenAt),
    "Última verificación": date(job.lastVerifiedAt),
    Vigencia: { status: option(STATUS_LABEL[job.status]) },
    Match: { number: match.score },
    Confianza: { number: match.confidence },
    Prioridad: { select: option(PRIORITY_LABEL[match.decision]) },
    "Skills match": multiSelect(match.matched_requirements),
    "Skills faltantes": multiSelect(match.missing_requirements),
    Blockers: richText(match.hard_blockers.join("; ")),
    Salario: richText(salarySummary(job)),
    Sponsorship: { select: option(SPONSORSHIP_LABEL[job.visaSponsorship]) },
    Idioma: multiSelect(job.languageRequirements),
    "Actualizado por sistema": date(new Date().toISOString())
  };

  for (const humanProperty of Object.keys(HUMAN_PROPERTIES)) {
    if (humanProperty in properties) {
      throw new Error(`mapping emitted human-owned property: ${humanProperty}`);
    }
  }

  return { properties, children: buildChildren(job, match), syncHash: computeSyncHash(properties) };
}

function paragraph(text: string): unknown {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: text ? [{ text: { content: truncate(text) } }] : [] }
  };
}

function heading(text: string): unknown {
  return {
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ text: { content: text } }] }
  };
}

/** Page body per plan §14.2: resumen, encaje, brechas, evidencia, descripción. */
function buildChildren(job: CanonicalJob, match: MatchResult): unknown[] {
  const evidence = match.evidence
    .slice(0, 8)
    .map((item) => `${item.field}: "${item.quote}"`)
    .join("\n");
  return [
    heading("Resumen"),
    paragraph(match.recommended_action),
    heading("Por qué encaja"),
    paragraph(match.why_apply.join("\n")),
    heading("Brechas"),
    paragraph([...match.missing_requirements, ...match.why_not_apply].join("\n")),
    heading("Evidencia"),
    paragraph(evidence),
    heading("Descripción limpia"),
    paragraph(job.descriptionText),
    heading("Fuentes originales"),
    paragraph(job.sourceUrl)
  ];
}

/**
 * Hash over everything EXCEPT "Actualizado por sistema" (volatile timestamp),
 * so re-running with unchanged data is a no-op.
 */
export function computeSyncHash(properties: Record<string, unknown>): string {
  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(properties).sort()) {
    if (key !== "Actualizado por sistema") {
      stable[key] = properties[key];
    }
  }
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
