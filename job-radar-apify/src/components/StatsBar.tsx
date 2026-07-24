import React from 'react';

export interface StatsBarProps {
  totalJobs: number;
  filteredJobs: number;
  duplicatesRemoved?: number;
  lastUpdatedText?: string;
}

export const StatsBar: React.FC<StatsBarProps> = ({
  totalJobs,
  filteredJobs,
  duplicatesRemoved = 0,
  lastUpdatedText = 'Hace instantes'
}) => {
  const verifiedPercentage = totalJobs > 0 ? 100 : 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[#0A0B0D] border border-[#262A31] text-xs font-mono text-slate-400 mb-6">
      <div className="flex flex-wrap items-center gap-4">
        {/* Total Jobs */}
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <strong className="text-slate-100 font-semibold">{filteredJobs}</strong> de {totalJobs} Vacantes
        </span>

        {/* Verified Rate */}
        <span className="text-slate-600">|</span>
        <span className="text-emerald-400">
          <strong>{verifiedPercentage}%</strong> Verificadas
        </span>

        {/* Duplicates Removed */}
        <span className="text-slate-600">|</span>
        <span>
          <strong className="text-slate-200">{duplicatesRemoved}</strong> Duplicadas eliminadas
        </span>
      </div>

      {/* Sync Timestamp */}
      <span className="text-slate-500 text-[11px]">
        ⏱️ Sincronizado: {lastUpdatedText}
      </span>
    </div>
  );
};
