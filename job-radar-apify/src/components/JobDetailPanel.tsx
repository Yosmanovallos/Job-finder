import React from "react";
import { Link } from "react-router-dom";
import { Star, Check, ArrowUpRight, Search, Sparkles } from "lucide-react";
import { Job } from "../sources/types.js";
import { getSourceColor } from "../lib/source-colors.js";
import { getModalityLabel } from "../lib/job-filters.js";
import { extractTechnologies } from "../lib/extract-technologies.js";
import { buildCompanyPath } from "../lib/job-seo.js";
import { buildLocationLabel } from "../countries/index.js";
import { useAuth } from "../auth/auth-provider.js";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";
import { ReputationBadges, ReputationEntryProps } from "./ReputationBadges.js";

export interface JobDetailPanelProps {
  job:
    | (Job & {
        alsoIn?: string[];
        isSaved?: boolean;
        isApplied?: boolean;
        salary?: string;
        reputation?: ReputationEntryProps[];
        // Poblados hoy solo para un subconjunto pequeño de vacantes (las
        // fuentes cuya respuesta original ya trae el dato — ver
        // job-repository.ts's getJobs()) — la mayoría siguen sin esto,
        // así que cada campo es opcional a propósito y cada sección de
        // abajo solo renderiza cuando el dato realmente existe.
        description?: string;
        requirements?: string[];
        technologies?: string[];
        employmentType?: string;
        applicantCount?: number;
      })
    | null;
  onSaveToggle?: (jobId: string) => void;
  onAppliedToggle?: (jobId: string) => void;
  onApplyClick?: (job: any) => void;
  // Fase 6 (docs/CV-GENERATION-PLAN.md §9.1/§9.2) — opens CvAdjustOverlay.
  // Only wired from Dashboard.tsx's desktop panel (confirmed scope,
  // 2026-08-07): JobCard/mobile doesn't get this entry point in this phase.
  onCvAdjustClick?: (job: any) => void;
  // Dashboard context ("CO"/"VE") — see JobCard.tsx's identical prop for why
  // this, not job.country, decides the company link's prefix.
  country?: string;
  // This panel is shared between Dashboard.tsx (a side pane next to a list
  // of other jobs — must never be an <h1>, or the page would have several)
  // and JobLanding.tsx (the dedicated /empleos/:id page, where the job
  // title IS the page's one real heading). Defaults to "h2" — the
  // pre-existing tag, unchanged for the Dashboard case — so only
  // JobLanding.tsx needs to opt in.
  headingLevel?: "h1" | "h2";
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
// actually know about the selected job. Descripción/Requisitos/Habilidades/
// Tipo de empleo/Postulantes only render when the underlying field is
// present — most sources still don't return them (see job-repository.ts's
// getJobs()), so most jobs still fall back to the plain infoBlock. The
// footer note below still points to the source site as the place the full
// posting (and its application form) actually lives.
export const JobDetailPanel: React.FC<JobDetailPanelProps> = ({
  job,
  onSaveToggle,
  onAppliedToggle,
  onApplyClick,
  onCvAdjustClick,
  country,
  headingLevel = "h2"
}) => {
  const { isAuthenticated } = useAuth();
  const TitleTag = headingLevel;

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
    job.alsoIn ||
    (Array.isArray((job as any).sources)
      ? (job as any).sources.filter((s: string) => s !== job.source)
      : []);
  const modality = getModalityLabel(job.location);
  const sourceColor = getSourceColor(job.source);
  // Bug real encontrado 2026-08-12 (reporte directo del usuario, "Desarrollador
  // De Software AI First"): job.technologies es el campo `skills` que cada
  // fuente arma a su manera — en Magneto resultó ser una lista genérica de
  // CATEGORÍAS ("Desarrollo de software", "Arquitectura de software") que no
  // coincidía con NINGUNA tecnología concreta mencionada en la descripción
  // real (Node.js, Python, TypeScript, Cursor...), aunque sí venía poblado.
  // extractTechnologies() solo devuelve nombres del catálogo que aparecen
  // literalmente, palabra completa, en description/requirements — por
  // construcción SIEMPRE coincide con lo que la vacante realmente dice, así
  // que ahora es la fuente primaria; job.technologies (el campo crudo de la
  // fuente) solo se usa si el extractor no encontró nada ahí.
  const extractedTechnologies = extractTechnologies(
    [job.description, ...(job.requirements || [])].filter(Boolean).join("\n")
  );
  const technologies = extractedTechnologies.length > 0 ? extractedTechnologies : job.technologies || [];

  // Reused as-is in both layouts below: standalone near the bottom of the
  // panel when there's no description (today's default for every real
  // job), or as the right column next to Habilidades once a source starts
  // populating job.description.
  const infoBlock = (
    <div className="space-y-3 text-sm">
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Fuente</span>
        <span className="text-foreground text-right">{job.source}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Publicada</span>
        <span className="text-foreground text-right">
          {job.dateText || job.publishedAt || "Reciente"}
        </span>
      </div>
      {otherSources.length > 0 && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">También en</span>
          <span className="text-foreground text-right">{otherSources.join(", ")}</span>
        </div>
      )}
      {typeof job.applicantCount === "number" && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Postulantes</span>
          <span className="text-foreground text-right">{job.applicantCount}</span>
        </div>
      )}
    </div>
  );

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
              <TitleTag className="font-heading font-semibold text-lg text-foreground leading-snug">
                {job.title}
              </TitleTag>
              <p className="text-sm text-foreground/80">
                {job.company ? (
                  // Every real company resolves — see JobCard.tsx's
                  // identical link for the reasoning.
                  <Link
                    to={buildCompanyPath(job.company, country)}
                    className="hover:underline hover:text-primary"
                  >
                    {job.company}
                  </Link>
                ) : (
                  "Confidencial"
                )}
                <span className="text-muted-foreground"> · {buildLocationLabel(job, country)}</span>
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
                job.isSaved
                  ? "bg-gold-1/40 border-gold-2/50 text-gold-ink hover:bg-gold-1/40"
                  : undefined
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
          {job.employmentType && <Badge>{job.employmentType}</Badge>}
          {job.salary && <Badge>{job.salary}</Badge>}
          <Badge style={{ background: sourceColor.bg, color: sourceColor.text }}>
            {job.source}
          </Badge>
          {job.dateText && <Badge variant="outline">{job.dateText}</Badge>}
        </div>

        {/* Fase 6 (docs/CV-GENERATION-PLAN.md §9.1) puesta en pausa
            (2026-08-12): la generación de CV todavía no está lista para
            usuarios reales, así que el CTA queda deshabilitado como teaser
            ("Muy pronto") en vez de un botón funcional — no hay
            onClick/navegación, nadie puede activarlo por accidente
            mientras el pipeline no esté verificado de punta a punta. */}
        <div className="rounded-lg border border-border bg-muted/30 p-4 mb-3 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-muted-foreground shrink-0" /> Genera un CV para
              esta vacante
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Adaptamos tu CV a esta posición con IA: reordenamos tu experiencia real, alineamos
              palabras clave y revisamos compatibilidad ATS. Nunca inventamos información.
            </p>
          </div>
          <Button type="button" variant="outline" size="lg" className="font-mono shrink-0" disabled>
            Muy pronto
          </Button>
        </div>

        <Button asChild size="lg" className="w-full mb-5 font-mono">
          <a href={job.url} target="_blank" rel="noopener noreferrer" onClick={handleApplyClick}>
            Aplicar en {job.source} <ArrowUpRight className="h-4 w-4" />
          </a>
        </Button>

        <div className="ticket-seam mb-5" />

        {job.description ? (
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5 mb-5">
            <div className="min-w-0">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase mb-2">
                Descripción
              </h3>
              <p className="text-sm text-foreground/90 whitespace-pre-line">{job.description}</p>

              {job.requirements && job.requirements.length > 0 && (
                <>
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase mt-4 mb-2">
                    Requisitos
                  </h3>
                  <ul className="list-disc list-outside pl-4 space-y-1 text-sm text-foreground/90">
                    {job.requirements.map((requirement, i) => (
                      <li key={i}>{requirement}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="min-w-0 space-y-5">
              {technologies.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase mb-2">
                    Habilidades
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {technologies.map((tech) => (
                      <Badge key={tech} variant="outline">
                        {tech}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {infoBlock}
            </div>
          </div>
        ) : (
          infoBlock
        )}

        {job.reputation && job.reputation.length > 0 && (
          <div className="mt-5">
            <ReputationBadges entries={job.reputation} />
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-5">
          La descripción completa y el formulario de aplicación están en la página de {job.source} —
          el botón de arriba te lleva directo.
        </p>
      </div>
    </div>
  );
};
