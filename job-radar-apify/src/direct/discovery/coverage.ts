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
  magneto: "portal en Magneto (pregunta abierta)",
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
    `Directorio (candidatos sincronizados): ${summary.totalCompanies} empresas · ${summary.totalRows} vacantes de bolsas vigentes`,
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
