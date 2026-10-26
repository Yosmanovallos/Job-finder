import React, { memo } from "react";
import { getModalityLabel } from "../lib/job-filters.js";
import { getSourceColor } from "../lib/source-colors.js";
import { Badge } from "./ui/badge.js";
import { cn } from "../lib/utils.js";
import { Job } from "../sources/types.js";
import { buildLocationLabel } from "../countries/index.js";
import { jobDateLabel } from "../lib/job-date-label.js";
import { isAvailabilityUnverified } from "../lib/job-availability.js";

export interface JobListItemProps {
  job: Job & { salary?: string; alsoIn?: string[] };
  selected: boolean;
  // Stable callback (useCallback in Dashboard) taking the id, so memo()
  // below can skip every row whose job and selection didn't change when a
  // new page is appended.
  onSelect: (jobId: string) => void;
}

const MODALITY_VARIANT: Record<string, "remote" | "hybrid" | "default"> = {
  Remoto: "remote",
  Híbrido: "hybrid",
  Presencial: "default"
};

function isFresh(job: JobListItemProps["job"]): boolean {
  if (isAvailabilityUnverified(job.source)) return false;
  if (!job.publishedAt) return false;
  const ageHours = (Date.now() - new Date(job.publishedAt).getTime()) / (1000 * 60 * 60);
  return ageHours <= 48;
}

export function otherSourcesOf(job: { source: string; sources?: unknown; alsoIn?: string[] }): string[] {
  if (Array.isArray(job.alsoIn)) return job.alsoIn;
  return Array.isArray(job.sources) ? (job.sources as string[]).filter((s) => s !== job.source) : [];
}

// Compact clickable row for the split-pane list column — deliberately
// lighter than JobCard (no save/apply buttons of its own): those actions
// live once in JobDetailPanel, since this row's own click already opens
// that detail. JobCard stays the mobile/stacked-list representation, which
// keeps its own actions since there's no separate detail pane there.
export const JobListItem = memo(function JobListItem({ job, selected, onSelect }: JobListItemProps) {
  const modality = getModalityLabel(job.location);
  const sourceColor = getSourceColor(job.source);
  const others = otherSourcesOf(job);

  return (
    <button
      type="button"
      onClick={() => onSelect(job.jobId)}
      // Off-screen rows skip layout and paint until they're near the
      // viewport; the intrinsic size keeps the scrollbar stable.
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 150px" }}
      className={cn(
        "w-full text-left rounded-2xl border-2 border-foreground p-4 transition-[transform,box-shadow]",
        selected
          ? "bg-green-soft shadow-[4px_4px_0_hsl(var(--primary))]"
          : "bg-white shadow-[3px_3px_0_hsl(var(--foreground))] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_hsl(var(--foreground))]"
      )}
    >
      <h2 className="font-heading font-bold text-[15px] text-foreground leading-snug mb-1 line-clamp-2">
        {job.title}
      </h2>
      <p className="text-xs text-foreground/80 mb-2 truncate">
        {job.company || "Confidencial"}
        <span className="text-muted-foreground"> · {buildLocationLabel(job)}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
        <Badge style={{ background: sourceColor.bg, color: sourceColor.text }}>{job.source}</Badge>
        {others.length > 0 && (
          <Badge title={`También en: ${others.join(", ")}`}>+{others.length} portal{others.length === 1 ? "" : "es"}</Badge>
        )}
        {modality && <Badge variant={MODALITY_VARIANT[modality]}>{modality}</Badge>}
        {job.salary && <Badge>{job.salary}</Badge>}
        {isFresh(job) && <Badge variant="primary">Nueva</Badge>}
      </div>
      <p className="text-[11px] font-mono text-ink-faint">
        {jobDateLabel(job)}
      </p>
    </button>
  );
});
