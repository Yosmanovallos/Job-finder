import React from "react";
import { Link } from "react-router-dom";
import { Job } from "../sources/types.js";
import { getModalityLabel } from "../lib/job-filters.js";
import { getSourceColor } from "../lib/source-colors.js";
import { buildJobPath } from "../lib/job-seo.js";
import { buildLocationLabel } from "../countries/index.js";
import { Badge } from "./ui/badge.js";

export interface CategoryJobRowProps {
  job: Job;
}

const MODALITY_VARIANT: Record<string, "remote" | "hybrid" | "default"> = {
  Remoto: "remote",
  Híbrido: "hybrid",
  Presencial: "default"
};

function isFresh(job: Job): boolean {
  if (!job.publishedAt) return false;
  const ageHours = (Date.now() - new Date(job.publishedAt).getTime()) / (1000 * 60 * 60);
  return ageHours <= 48;
}

// Unlike JobCard (dashboard) or JobListItem (split-pane, onClick-based),
// this row's whole point is a real internal <Link> to /empleos/:id/:slug —
// the "hub → item" internal linking the category page exists for (see
// docs/SEO-PLAN.md §4.4) — never straight to the external source URL.
export const CategoryJobRow: React.FC<CategoryJobRowProps> = ({ job }) => {
  const modality = getModalityLabel(job.location);
  const sourceColor = getSourceColor(job.source);

  return (
    <Link
      to={buildJobPath(job)}
      className="block rounded-lg border border-border bg-card p-4 hover:border-border-strong transition-colors"
    >
      <h3 className="font-heading font-semibold text-sm text-foreground leading-snug mb-1">
        {job.title}
      </h3>
      <p className="text-xs text-foreground/80 mb-2 truncate">
        {job.company || "Confidencial"}
        <span className="text-muted-foreground"> · {buildLocationLabel(job)}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {modality && <Badge variant={MODALITY_VARIANT[modality]}>{modality}</Badge>}
        {isFresh(job) && <Badge variant="primary">Nueva</Badge>}
        <Badge style={{ background: sourceColor.bg, color: sourceColor.text }}>{job.source}</Badge>
      </div>
    </Link>
  );
};
