import React, { useState } from 'react';
import { Job } from '../sources/types.js';

export interface JobCardProps {
  job: Job & {
    alsoIn?: string[];
    isSaved?: boolean;
    isApplied?: boolean;
  };
  onSaveToggle?: (jobId: string) => void;
  onAppliedToggle?: (jobId: string) => void;
}

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

  // Merge sources
  const otherSources = job.alsoIn || (Array.isArray(job.sources) ? job.sources.filter(s => s !== job.source) : []);

  return (
    <div className={`group relative rounded-xl border p-5 transition-all duration-200 ${
      applied 
        ? 'border-emerald-500/20 bg-[#111317]/60 opacity-75' 
        : 'border-[#262A31] bg-[#131519] hover:border-emerald-500/40 hover:bg-[#16191E]'
    }`}>
      {/* Top Meta Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-3 font-mono">
        <div className="flex items-center gap-2">
          {/* Status Badge */}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Verificada
          </span>

          {/* Primary Source Badge */}
          <span className="px-2 py-0.5 rounded bg-[#1F232B] text-slate-300 font-medium border border-[#2B303B]">
            {job.source}
          </span>

          {/* Additional Sources Badge */}
          {otherSources.length > 0 && (
            <span className="text-slate-400 font-sans text-[11px]">
              también en: <strong className="text-emerald-400 font-mono">{otherSources.join(', ')}</strong>
            </span>
          )}
        </div>

        {/* Date Text */}
        <span className="text-slate-500 text-[11px]">
          {job.dateText || job.publishedAt || 'Reciente'}
        </span>
      </div>

      {/* Main Title */}
      <h3 className="font-heading font-semibold text-lg text-slate-100 group-hover:text-emerald-400 transition-colors leading-snug mb-2">
        {job.title}
      </h3>

      {/* Company & Location Details */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 font-mono mb-4">
        <span className="text-slate-200 font-medium">🏢 {job.company || 'Confidencial'}</span>
        <span>📍 {job.location || 'Colombia'}</span>
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-[#22262E] text-xs">
        <div className="flex items-center gap-2 font-mono">
          {/* Bookmark Button */}
          <button
            onClick={handleSave}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              saved
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'border-[#2B303B] text-slate-400 hover:text-slate-200 hover:bg-[#1D2128]'
            }`}
          >
            {saved ? '★ Guardado' : '☆ Guardar'}
          </button>

          {/* Applied Toggle Button */}
          <button
            onClick={handleApplied}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              applied
                ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                : 'border-[#2B303B] text-slate-400 hover:text-slate-200 hover:bg-[#1D2128]'
            }`}
          >
            {applied ? '✓ Aplicada' : 'Marcar aplicada'}
          </button>
        </div>

        {/* Apply Link CTA */}
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold transition-all shadow-sm shadow-emerald-500/20 font-sans"
        >
          Aplicar
          <span className="font-mono text-sm">→</span>
        </a>
      </div>
    </div>
  );
};
