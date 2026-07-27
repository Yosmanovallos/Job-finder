import React, { useState } from 'react';
import { Job } from '../sources/types.js';
import { getSourceColor } from '../lib/source-colors.js';
import { getModalityLabel } from '../lib/job-filters.js';

export interface JobCardProps {
  job: Job & {
    alsoIn?: string[];
    isSaved?: boolean;
    isApplied?: boolean;
    salary?: string;
  };
  onSaveToggle?: (jobId: string) => void;
  onAppliedToggle?: (jobId: string) => void;
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

const MODALITY_STYLE: Record<string, string> = {
  Remoto: "bg-green-soft text-green-deep",
  Híbrido: "bg-gold-1/40 text-gold-ink",
  Presencial: "bg-[#f1f2f0] text-muted-foreground"
};

export const JobCard: React.FC<JobCardProps> = ({ job, onSaveToggle, onAppliedToggle }) => {
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

  const otherSources = job.alsoIn || (Array.isArray(job.sources) ? job.sources.filter(s => s !== job.source) : []);
  const modality = getModalityLabel(job.location);
  const sourceColor = getSourceColor(job.source);

  return (
    <div
      className={`flex flex-col sm:flex-row gap-4 p-4 sm:p-5 rounded-xl border transition-colors ${
        applied ? 'border-[#e6e8e4] bg-[#fafafa] opacity-70' : 'border-[#e6e8e4] bg-[#ffffff] hover:border-[#d3d6cf]'
      }`}
    >
      <div className="flex items-start gap-4 flex-1 min-w-0">
        {/* Avatar */}
        <div className="shrink-0 w-11 h-11 rounded-lg bg-gold-1/50 text-gold-ink font-heading font-semibold text-lg flex items-center justify-center">
          {initialFor(job)}
        </div>

        {/* Body — title, company, location first (the scan path), tags and
            timestamp last and quietest. */}
        <div className="flex-1 min-w-0">
          <h3 className="font-heading font-semibold text-base text-foreground leading-snug mb-1">
            {job.title}
          </h3>

          <p className="text-sm text-foreground/80 mb-2">
            {job.company || 'Confidencial'}
            <span className="text-muted-foreground"> · {job.location || 'Colombia'}</span>
          </p>

          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {modality && (
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-medium ${MODALITY_STYLE[modality]}`}
              >
                {modality}
              </span>
            )}
            {job.salary && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-[#f1f2f0] text-foreground">
                {job.salary}
              </span>
            )}
            {isFresh(job) && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-primary/10 text-primary">
                Nueva
              </span>
            )}
            <span
              className="px-2 py-0.5 rounded-full text-[11px] font-mono font-medium"
              style={{ background: sourceColor.bg, color: sourceColor.text }}
            >
              {job.source}
            </span>
          </div>

          <p className="text-[11px] font-mono text-ink-faint">
            {otherSources.length > 0 && <>también en: {otherSources.join(', ')} · </>}
            {job.dateText || job.publishedAt || 'Reciente'}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 w-full sm:w-auto">
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-xs font-mono transition-opacity hover:opacity-90 whitespace-nowrap order-2 sm:order-1"
        >
          Ver vacante <span>→</span>
        </a>
        <div className="flex items-center gap-1 order-1 sm:order-2">
          <button
            onClick={handleSave}
            aria-label={saved ? "Quitar de guardados" : "Guardar"}
            className={`w-8 h-8 rounded-md border flex items-center justify-center text-sm transition-colors ${
              saved
                ? 'bg-gold-1/40 border-gold-2/50 text-gold-ink'
                : 'border-[#e6e8e4] text-muted-foreground hover:text-foreground hover:bg-[#f1f2f0]'
            }`}
          >
            {saved ? '★' : '☆'}
          </button>
          <button
            onClick={handleApplied}
            aria-label={applied ? "Marcar como no aplicada" : "Marcar aplicada"}
            className={`w-8 h-8 rounded-md border flex items-center justify-center text-sm transition-colors ${
              applied
                ? 'bg-primary/10 border-primary/40 text-primary'
                : 'border-[#e6e8e4] text-muted-foreground hover:text-foreground hover:bg-[#f1f2f0]'
            }`}
          >
            ✓
          </button>
        </div>
      </div>
    </div>
  );
};
