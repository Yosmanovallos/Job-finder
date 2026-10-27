import React, { memo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Job } from "../sources/types.js";
import { getSourceColor } from "../lib/source-colors.js";
import { getModalityLabel } from "../lib/job-filters.js";
import { buildCompanyPath, buildJobPath } from "../lib/job-seo.js";
import { isPlaceholderEmployer } from "../lib/company-key.js";
import { buildLocationLabel } from "../countries/index.js";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";
import { cn } from "../lib/utils.js";
import { ReputationEntryProps } from "./ReputationBadges.js";
import { jobDateLabel } from "../lib/job-date-label.js";
import { isAvailabilityUnverified } from "../lib/job-availability.js";
import { JobMarkButtons } from "./JobMarkButtons.js";

export interface JobCardProps {
  job: Job & {
    alsoIn?: string[];
    isSaved?: boolean;
    isApplied?: boolean;
    salary?: string;
    reputation?: ReputationEntryProps[];
  };
  // Passed apart from `job` so the Dashboard can hand over the same job
  // object on every render and memo() can skip unchanged cards.
  isSaved?: boolean;
  isApplied?: boolean;
  onSaveToggle?: (jobId: string) => void;
  onAppliedToggle?: (jobId: string) => void;
  // Which dashboard context this card is rendered in ("CO" default, "VE" on
  // /ve/dashboard) — NOT the same as job.country (which can be null for a
  // shared remote posting). The company link below must stay inside
  // whichever country page the visitor is already on, so it uses this, not
  // job.country: a remote job shown on /ve/dashboard still links to
  // /ve/empresas/:slug, never back out to the Colombia-scoped page.
  country?: string;
}

function initialFor(job: JobCardProps["job"]): string {
  const source = (job.company || job.source || "?").trim();
  return source.charAt(0).toUpperCase() || "?";
}

function isFresh(job: JobCardProps["job"]): boolean {
  if (isAvailabilityUnverified(job.source)) return false;
  if (!job.publishedAt) return false;
  const ageHours = (Date.now() - new Date(job.publishedAt).getTime()) / (1000 * 60 * 60);
  return ageHours <= 48;
}

const MODALITY_VARIANT: Record<string, "remote" | "hybrid" | "default"> = {
  Remoto: "remote",
  Híbrido: "hybrid",
  Presencial: "default"
};

export const JobCard = memo(function JobCard({
  job,
  isSaved,
  isApplied,
  onSaveToggle,
  onAppliedToggle,
  country
}: JobCardProps) {
  // Controlled by the parent (the account's marks), so a change made on
  // another page or after signing in shows up here too.
  const saved = isSaved ?? job.isSaved ?? false;
  const applied = isApplied ?? job.isApplied ?? false;

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
        "grid grid-cols-[6px_1fr] rounded-2xl border-2 overflow-hidden transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_240px]",
        applied
          ? "border-foreground/30 bg-muted opacity-60"
          : "border-foreground bg-white shadow-[3px_3px_0_hsl(var(--foreground))]"
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
            <h2 className="font-heading font-bold text-base text-foreground leading-snug mb-1">
              {job.title}
            </h2>

            <p className="text-sm text-foreground/80 mb-2">
              {job.company && !isPlaceholderEmployer(job.company) ? (
                // Every real company gets a working /empresas/:slug page —
                // resolveCompanyNameFromJobs() in server.ts falls back to
                // matching any company from the live job corpus when it's
                // not one of the curated reputation companies, so this is
                // never a dead link (see docs/COMPANY-REPUTATION-PLAN.md §8).
                <Link
                  to={buildCompanyPath(job.company, country)}
                  className="hover:underline hover:text-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  {job.company}
                </Link>
              ) : (
                job.company || "Confidencial"
              )}
              <span className="text-muted-foreground"> · {buildLocationLabel(job, country)}</span>
            </p>

            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <Badge style={{ background: sourceColor.bg, color: sourceColor.text }}>
                {job.source}
              </Badge>
              {modality && <Badge variant={MODALITY_VARIANT[modality]}>{modality}</Badge>}
              {job.salary && <Badge>{job.salary}</Badge>}
              {isFresh(job) && <Badge variant="primary">Nueva</Badge>}
            </div>

            <p className="text-[11px] font-mono text-ink-faint">
              {otherSources.length > 0 && <>también en: {otherSources.join(", ")} · </>}
              {jobDateLabel(job)}
            </p>
          </div>
        </div>

        {/* Actions */}
        {/* Phone: the two marks, then "Ver vacante" full width on its own
            row (three buttons in one row overflowed at 390px). */}
        <div className="shrink-0 flex flex-row flex-wrap sm:flex-nowrap sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 w-full sm:w-auto">
          <Button asChild size="sm" className="order-2 sm:order-1 font-mono basis-full sm:basis-auto">
            <Link to={buildJobPath(job)}>
              Ver vacante <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <JobMarkButtons
            className="order-1 sm:order-2"
            saved={saved}
            applied={applied}
            onSave={() => onSaveToggle?.(job.jobId)}
            onApplied={() => onAppliedToggle?.(job.jobId)}
          />
        </div>
      </div>
    </div>
  );
});
