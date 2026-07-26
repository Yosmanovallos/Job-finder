import React from 'react';

export interface StatsBarProps {
  totalJobs: number;
  filteredJobs: number;
  lastUpdatedText?: string;
}

export const StatsBar: React.FC<StatsBarProps> = ({
  totalJobs,
  filteredJobs,
  lastUpdatedText = 'Hace instantes'
}) => {
  const verifiedPercentage = totalJobs > 0 ? 100 : 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg bg-[#fafafa] border border-[#e6e8e4] text-xs font-mono text-muted-foreground mb-6">
      <div className="flex flex-wrap items-center gap-4">
        {/* Total Jobs */}
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <strong className="text-foreground font-semibold">{filteredJobs}</strong> de {totalJobs} Vacantes
        </span>

        {/* Verified Rate */}
        <span className="text-ink-faint">|</span>
        <span className="text-primary">
          <strong>{verifiedPercentage}%</strong> Verificadas
        </span>
      </div>

      {/* Sync Timestamp */}
      <span className="text-ink-faint text-[11px]">
        ⏱️ Sincronizado: {lastUpdatedText}
      </span>
    </div>
  );
};
