import React from "react";
import { Link } from "react-router-dom";
import { Job } from "../sources/types.js";
import { getModalityLabel } from "../lib/job-filters.js";
import { getSourceColor } from "../lib/source-colors.js";
import { buildJobPath } from "../lib/job-seo.js";
import { buildLocationLabel } from "../countries/index.js";
import { jobDateLabel } from "../lib/job-date-label.js";
import { jobOriginState, type JobOrigin } from "../lib/job-origin.js";

export interface CategoryJobRowProps {
  job: Job;
  /** The hub this card sits on, so the job page's back link returns to it. */
  origin?: JobOrigin;
  /** Off on a company page, where every card is the same company. */
  showCompany?: boolean;
}

// One job card for every hub page (city, role, company), in the homepage's
// ink style. Unlike JobCard (dashboard) or JobListItem (split-pane,
// onClick-based), its whole point is a real internal <Link> to
// /empleos/:id/:slug — the "hub → item" internal linking these pages exist
// for (see docs/SEO-PLAN.md §4.4) — never straight to the external source URL.
export const CategoryJobRow: React.FC<CategoryJobRowProps> = ({ job, origin, showCompany = true }) => {
  const modality = getModalityLabel(job.location);
  const color = getSourceColor(job.source);

  return (
    <Link
      to={buildJobPath(job)}
      state={origin ? jobOriginState(origin) : undefined}
      className="ink-card-sm ink-lift h-full rounded-2xl bg-white p-4 md:p-5 flex flex-col gap-2.5 text-foreground no-underline"
    >
      <h3 className="font-heading font-bold text-base md:text-lg leading-snug line-clamp-2">{job.title}</h3>
      <p className="text-sm text-[#3d413e] truncate">
        {showCompany ? `${job.company || "Confidencial"} · ` : ""}
        {buildLocationLabel(job)}
      </p>
      <div className="mt-auto flex flex-wrap gap-1.5">
        <span className="rounded-full px-2 py-0.5 font-mono text-[11px]" style={{ backgroundColor: color.bg, color: color.text }}>{job.source}</span>
        {modality ? <span className="rounded-full px-2 py-0.5 font-mono text-[11px] bg-[#efe9fd] text-[#6d28d9]">{modality}</span> : null}
        <span className="rounded-full px-2 py-0.5 font-mono text-[11px] bg-green-soft text-primary">{jobDateLabel(job)}</span>
      </div>
    </Link>
  );
};
