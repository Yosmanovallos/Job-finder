import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Star, Check, ArrowRight } from "lucide-react";
import { Job } from "../sources/types.js";
import { getSourceColor } from "../lib/source-colors.js";
import { getModalityLabel } from "../lib/job-filters.js";
import { buildCompanyPath } from "../lib/job-seo.js";
import { useAuth } from "../auth/auth-provider.js";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";
import { cn } from "../lib/utils.js";
import { ReputationEntryProps } from "./ReputationBadges.js";

export interface JobCardProps {
  job: Job & {
    alsoIn?: string[];
    isSaved?: boolean;
    isApplied?: boolean;
    salary?: string;
    reputation?: ReputationEntryProps[];
  };
  onSaveToggle?: (jobId: string) => void;
  onAppliedToggle?: (jobId: string) => void;
  // Anonymous visitors get intercepted here instead of navigating straight
  // to the external posting — the caller (Dashboard) owns the gate modal's
  // open/closed state so it can be shared with the split-pane detail panel.
  onApplyClick?: (job: JobCardProps["job"]) => void;
}

function initialFor(job: JobCardProps["job"]): string {
  const source = (job.company || job.source || "?").trim();
  return source.charAt(0).toUpperCase() || "?";
}

function isFresh(job: JobCardProps["job"]): boolean {
  if (!job.publishedAt) return false;
  const ageHours = (Date.now() - new Date(job.publishedAt).getTime()) / (1000 * 60 * 60);
  return ageHours <= 48;
}

const MODALITY_VARIANT: Record<string, "remote" | "hybrid" | "default"> = {
  Remoto: "remote",
  Híbrido: "hybrid",
  Presencial: "default"
};

export const JobCard: React.FC<JobCardProps> = ({
  job,
  onSaveToggle,
  onAppliedToggle,
  onApplyClick
}) => {
  const { isAuthenticated } = useAuth();
  const [saved, setSaved] = useState(job.isSaved || false);
  const [applied, setApplied] = useState(job.isApplied || false);

  const handleSave = () => {
    setSaved(!saved);
    if (onSaveToggle) onSaveToggle(job.jobId);
  };

  const handleApplied = () => {
    setApplied(!applied);
    if (onAppliedToggle) onAppliedToggle(job.jobId);
  };

  const handleApplyLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isAuthenticated && onApplyClick) {
      e.preventDefault();
      onApplyClick(job);
    }
  };

  const otherSources =
    job.alsoIn || (Array.isArray(job.sources) ? job.sources.filter((s) => s !== job.source) : []);
  const modality = getModalityLabel(job.location);
  const sourceColor = getSourceColor(job.source);

  return (
    <div
      // Same "ticket" language as PaywallCard (hud-corners + colored rail)
      // instead of a plain bordered box — this is the card that repeats
      // dozens of times per dashboard view, so it carries more of the
      // product's visual identity than any single marketing section does.
      // Green rail = unlocked/free, matching the gold rail PaywallCard uses
      // for locked/Pro, so the two states read as siblings, not opposites.
      className={cn(
        "hud-corners grid grid-cols-[4px_1fr] rounded-lg border overflow-hidden transition-colors",
        applied
          ? "border-border bg-muted opacity-60"
          : "border-border bg-card hover:border-border-strong"
      )}
    >
      <div
        className={
          applied
            ? "bg-border-strong"
            : "bg-gradient-to-b from-green-soft via-primary to-green-deep"
        }
      />

      <div className="flex flex-col sm:flex-row gap-4 p-4 sm:p-5 min-w-0">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          {/* Avatar — a plain initial, not a fabricated company logo: job
              postings don't carry a reliable company-website field, and
              guessing one (e.g. "company-name.com") to pull from a
              favicon/logo API risks silently attaching a real brand mark to
              the wrong company. */}
          <div className="shrink-0 w-11 h-11 rounded-lg bg-gradient-to-br from-gold-1 to-gold-2 text-gold-ink font-heading font-semibold text-lg flex items-center justify-center">
            {initialFor(job)}
          </div>

          {/* Body — title, company, location first (the scan path), tags and
              timestamp last and quietest. */}
          <div className="flex-1 min-w-0">
            <h3 className="font-heading font-semibold text-base text-foreground leading-snug mb-1">
              {job.title}
            </h3>

            <p className="text-sm text-foreground/80 mb-2">
              {job.company && job.reputation && job.reputation.length > 0 ? (
                // Only linked when this job's company actually has curated
                // reputation data (company_reputation_alias) — that's the
                // same condition /empresas/:slug's resolveCompanyBySlug()
                // needs to resolve successfully, so this can never be a
                // dead link to a 404 for the ~99% of companies without it.
                <Link
                  to={buildCompanyPath(job.company)}
                  className="hover:underline hover:text-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  {job.company}
                </Link>
              ) : (
                job.company || "Confidencial"
              )}
              <span className="text-muted-foreground"> · {job.location || "Colombia"}</span>
            </p>

            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {modality && <Badge variant={MODALITY_VARIANT[modality]}>{modality}</Badge>}
              {job.salary && <Badge>{job.salary}</Badge>}
              {isFresh(job) && <Badge variant="primary">Nueva</Badge>}
              <Badge style={{ background: sourceColor.bg, color: sourceColor.text }}>
                {job.source}
              </Badge>
            </div>

            <p className="text-[11px] font-mono text-ink-faint">
              {otherSources.length > 0 && <>también en: {otherSources.join(", ")} · </>}
              {job.dateText || job.publishedAt || "Reciente"}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 w-full sm:w-auto">
          <Button asChild size="sm" className="order-2 sm:order-1 font-mono">
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleApplyLinkClick}
            >
              Ver vacante <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </Button>
          <div className="flex items-center gap-1 order-1 sm:order-2">
            <Button
              variant="icon"
              size="icon"
              onClick={handleSave}
              aria-label={saved ? "Quitar de guardados" : "Guardar"}
              className={
                saved ? "bg-gold-1/40 border-gold-2/50 text-gold-ink hover:bg-gold-1/40" : undefined
              }
            >
              <Star className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
            </Button>
            <Button
              variant="icon"
              size="icon"
              onClick={handleApplied}
              aria-label={applied ? "Marcar como no aplicada" : "Marcar aplicada"}
              className={
                applied
                  ? "bg-primary/10 border-primary/40 text-primary hover:bg-primary/10"
                  : undefined
              }
            >
              <Check className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
