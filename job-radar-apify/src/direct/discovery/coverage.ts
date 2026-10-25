import type { CoverageBucketRow } from "../../db/direct-discovery-repository.js";

/**
 * Coverage funnel (docs/adr/0006-direct-employers.md §7.1). Never one
 * percentage: every line says what share of the directory was looked at and
 * how, by companies and weighted by job-board rows. "Not found by name" is
 * not "has no portal".
 */

export interface FunnelLine {
  label: string;
  companies: number;
  rows: number;
}

export interface CoverageSummary {
  totalCompanies: number;
  totalRows: number;
  probedCompanies: number;
  probedRows: number;
  covered: FunnelLine;
  lines: FunnelLine[];
}

const DECISION_LABELS: Record<string, string> = {
  known: "con tablero oficial (seed / ya existente)",
  verified: "con tablero oficial (descubierto y verificado)",
  needs_review: "detectado, falta revisión humana",
  unsupported_ats: "portal en un ATS aún sin conector (D5)",
  magneto: "portal en Magneto sin listado completo (más de 20 vacantes)",
  excluded: "agencia de empleo (excluida)",
  rejected: "rechazado por revisión humana",
  pending: "sin revisar o con error transitorio"
};

export function summarizeCoverage(rows: CoverageBucketRow[]): CoverageSummary {
  const sum = (filter: (row: CoverageBucketRow) => boolean): FunnelLine => {
    const selected = rows.filter(filter);
    return { label: "", companies: selected.reduce((n, row) => n + row.companies, 0), rows: selected.reduce((n, row) => n + row.rows, 0) };
  };
  const total = sum(() => true);
  // A transient error is not "looked at": pending rows never count as reviewed.
  const probed = sum((row) => row.decision !== "pending");
  const lines: FunnelLine[] = Object.entries(DECISION_LABELS).map(([decision, label]) => ({ ...sum((row) => row.decision === decision), label }));
  // not_found split by what could be looked at: the honest "unknown" part.
  lines.push({ ...sum((row) => row.decision === "not_found" && row.siteProbe === "no_domain"), label: "no encontrado por nombre; sin dominio para leer su sitio" });
  lines.push({ ...sum((row) => row.decision === "not_found" && row.siteProbe === "no_link"), label: "no encontrado por nombre ni en su sitio (sin portal visible)" });
  lines.push({
    ...sum((row) => row.decision === "not_found" && ["robots_blocked", "blocked", "redirect_offsite", "unreachable"].includes(row.siteProbe)),
    label: "no encontrado por nombre; su sitio bloquea o no se pudo leer"
  });
  const covered = { ...sum((row) => row.decision === "known" || row.decision === "verified"), label: "cubiertas" };
  return { totalCompanies: total.companies, totalRows: total.rows, probedCompanies: probed.companies, probedRows: probed.rows, covered, lines };
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "—" : `${((part / whole) * 100).toFixed(1)} %`;
}

export function formatCoverage(summary: CoverageSummary): string {
  const out: string[] = [];
  out.push(
    `Directorio activo (candidatos sincronizados): ${summary.totalCompanies} empresas · ${summary.totalRows} vacantes de bolsas vigentes`,
    `Revisadas: ${summary.probedCompanies} de ${summary.totalCompanies} empresas (${pct(summary.probedCompanies, summary.totalCompanies)}) · ` +
      `${pct(summary.probedRows, summary.totalRows)} de las vacantes`,
    `Cubiertas con tablero oficial: ${summary.covered.companies} empresas (${pct(summary.covered.companies, summary.totalCompanies)} del directorio, ` +
      `${pct(summary.covered.companies, summary.probedCompanies)} de lo revisado) · ${pct(summary.covered.rows, summary.totalRows)} de las vacantes`,
    ""
  );
  for (const line of summary.lines) {
    out.push(`  ${String(line.companies).padStart(6)} empresas  ${String(line.rows).padStart(7)} vacantes  ${line.label}`);
  }
  return out.join("\n");
}

/**
 * External denominator (docs/source-catalog/servicio-publico-empleo.md §6):
 * the SPE's monthly count of registered job openings. Different unit from
 * ours (positions registered in a month vs. distinct live vacancies in a
 * 30-day window), so the ratio is stated as an order of magnitude with its
 * period and caveats — never as "coverage %" alone.
 */
export interface ExternalDenominator {
  source: string;
  url: string;
  unit: string;
  period: string;
  value: number;
  retrievedAt: string;
  caveats: string;
}

export function parseDenominator(raw: unknown): ExternalDenominator | null {
  const value = raw as Partial<ExternalDenominator> | null;
  if (!value || typeof value !== "object") return null;
  const strings = ["source", "url", "unit", "period", "retrievedAt", "caveats"] as const;
  if (!strings.every((key) => typeof value[key] === "string" && value[key]!.length > 0)) return null;
  if (typeof value.value !== "number" || !Number.isInteger(value.value) || value.value <= 0) return null;
  return value as ExternalDenominator;
}

export function formatDenominator(denominator: ExternalDenominator, boardRows: number, liveOfficial: number): string {
  const ours = boardRows + liveOfficial;
  return [
    `Denominador externo: ${denominator.value.toLocaleString("es-CO")} ${denominator.unit} — ${denominator.source}, período ${denominator.period} (consultado ${denominator.retrievedAt}).`,
    `  BuscoTrabajo hoy: ${boardRows} vacantes de bolsas del directorio + ${liveOfficial} oficiales vigentes = ${ours} ` +
      `(≈ ${pct(ours, denominator.value)} del flujo mensual del SPE; unidades distintas y sin descontar copias oficial/bolsa: orden de magnitud).`,
    `  Sesgos: ${denominator.caveats}`
  ].join("\n");
}
