import React from "react";
import { Star, Check, ArrowUpRight, Search } from "lucide-react";
import { Job } from "../sources/types.js";
import { getSourceColor } from "../lib/source-colors.js";
import { getModalityLabel } from "../lib/job-filters.js";
import { useAuth } from "../auth/auth-provider.js";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";

export interface JobDetailPanelProps {
  job: (Job & { alsoIn?: string[]; isSaved?: boolean; isApplied?: boolean; salary?: string }) | null;
  onSaveToggle?: (jobId: string) => void;
  onAppliedToggle?: (jobId: string) => void;
  onApplyClick?: (job: any) => void;
}

const MODALITY_VARIANT: Record<string, "remote" | "hybrid" | "default"> = {
  Remoto: "remote",
  Híbrido: "hybrid",
  Presencial: "default"
};

function initialFor(job: { company?: string; source?: string }): string {
  const source = (job.company || job.source || "?").trim();
  return source.charAt(0).toUpperCase() || "?";
}

// Right-hand pane of the desktop split-pane dashboard — shows everything we
// actually know about the selected job. Deliberately does NOT render a
// "Descripción de la vacante" prose section: this aggregator never scrapes
// full job descriptions (only title/company/location/salary/date), and
// inventing one would violate AGENTS.md's "never invent data" rule. Instead
// it states plainly that the full posting lives on the source site.
export const JobDetailPanel: React.FC<JobDetailPanelProps> = ({
  job,
  onSaveToggle,
  onAppliedToggle,
  onApplyClick
}) => {
  const { isAuthenticated } = useAuth();

  if (!job) {
    return (
      <div className="hidden lg:flex h-full min-h-[400px] flex-col items-center justify-center rounded-lg border border-border bg-card text-center p-8">
        <Search className="h-8 w-8 text-ink-faint mb-3" />
        <p className="text-sm text-muted-foreground">
          Selecciona una vacante de la lista para ver el detalle.
        </p>
      </div>
    );
  }

  const otherSources =
    job.alsoIn || (Array.isArray((job as any).sources) ? (job as any).sources.filter((s: string) => s !== job.source) : []);
  const modality = getModalityLabel(job.location);
  const sourceColor = getSourceColor(job.source);

  const handleApplyClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isAuthenticated && onApplyClick) {
      e.preventDefault();
      onApplyClick(job);
    }
  };

  return (
    <div className="hud-corners rounded-lg border border-border bg-card overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-green-soft via-primary to-gold-2" />

      <div className="p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="shrink-0 w-11 h-11 rounded-lg bg-gradient-to-br from-gold-1 to-gold-2 text-gold-ink font-heading font-semibold text-lg flex items-center justify-center">
              {initialFor(job)}
            </div>
            <div className="min-w-0">
              <h2 className="font-heading font-semibold text-lg text-foreground leading-snug">
                {job.title}
              </h2>
              <p className="text-sm text-foreground/80">
                {job.company || "Confidencial"}
                <span className="text-muted-foreground"> · {job.location || "Colombia"}</span>
              </p>
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-1">
            <Button
              variant="icon"
              size="icon"
              onClick={() => onSaveToggle?.(job.jobId)}
              aria-label={job.isSaved ? "Quitar de guardados" : "Guardar"}
              className={
                job.isSaved ? "bg-gold-1/40 border-gold-2/50 text-gold-ink hover:bg-gold-1/40" : undefined
              }
            >
              <Star className="h-4 w-4" fill={job.isSaved ? "currentColor" : "none"} />
            </Button>
            <Button
              variant="icon"
              size="icon"
              onClick={() => onAppliedToggle?.(job.jobId)}
              aria-label={job.isApplied ? "Marcar como no aplicada" : "Marcar aplicada"}
              className={
                job.isApplied
                  ? "bg-primary/10 border-primary/40 text-primary hover:bg-primary/10"
                  : undefined
              }
            >
              <Check className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mb-5">
          {modality && <Badge variant={MODALITY_VARIANT[modality]}>{modality}</Badge>}
          {job.salary && <Badge>{job.salary}</Badge>}
          <Badge style={{ background: sourceColor.bg, color: sourceColor.text }}>{job.source}</Badge>
        </div>

        <Button asChild size="lg" className="w-full mb-5 font-mono">
          <a href={job.url} target="_blank" rel="noopener noreferrer" onClick={handleApplyClick}>
            Aplicar en {job.source} <ArrowUpRight className="h-4 w-4" />
          </a>
        </Button>

        <div className="ticket-seam mb-5" />

        <div className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Publicada</span>
            <span className="text-foreground text-right">{job.dateText || job.publishedAt || "Reciente"}</span>
          </div>
          {otherSources.length > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">También en</span>
              <span className="text-foreground text-right">{otherSources.join(", ")}</span>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground mt-5">
          La descripción completa y el formulario de aplicación están en la página de{" "}
          {job.source} — el botón de arriba te lleva directo.
        </p>
      </div>
    </div>
  );
};
