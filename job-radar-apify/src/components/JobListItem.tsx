import React from "react";
import { getModalityLabel } from "../lib/job-filters.js";
import { Badge } from "./ui/badge.js";
import { cn } from "../lib/utils.js";
import { Job } from "../sources/types.js";
import { buildLocationLabel } from "../countries/index.js";

export interface JobListItemProps {
  job: Job & { salary?: string };
  selected: boolean;
  onClick: () => void;
}

const MODALITY_VARIANT: Record<string, "remote" | "hybrid" | "default"> = {
  Remoto: "remote",
  Híbrido: "hybrid",
  Presencial: "default"
};

function isFresh(job: JobListItemProps["job"]): boolean {
  if (!job.publishedAt) return false;
  const ageHours = (Date.now() - new Date(job.publishedAt).getTime()) / (1000 * 60 * 60);
  return ageHours <= 48;
}

// Compact clickable row for the split-pane list column — deliberately
// lighter than JobCard (no save/apply buttons of its own): those actions
// live once in JobDetailPanel, since this row's own click already opens
// that detail. JobCard stays the mobile/stacked-list representation, which
// keeps its own actions since there's no separate detail pane there.
export const JobListItem: React.FC<JobListItemProps> = ({ job, selected, onClick }) => {
  const modality = getModalityLabel(job.location);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg border p-4 transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:border-border-strong"
      )}
    >
      <h3 className="font-heading font-semibold text-sm text-foreground leading-snug mb-1 line-clamp-2">
        {job.title}
      </h3>
      <p className="text-xs text-foreground/80 mb-2 truncate">
        {job.company || "Confidencial"}
        <span className="text-muted-foreground"> · {buildLocationLabel(job)}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
        {modality && <Badge variant={MODALITY_VARIANT[modality]}>{modality}</Badge>}
        {job.salary && <Badge>{job.salary}</Badge>}
        {isFresh(job) && <Badge variant="primary">Nueva</Badge>}
      </div>
      <p className="text-[11px] font-mono text-ink-faint">
        {job.dateText || job.publishedAt || "Reciente"}
      </p>
    </button>
  );
};
