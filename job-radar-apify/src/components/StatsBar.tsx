import React from 'react';

export interface StatsBarProps {
  totalJobs: number;
  filteredJobs: number;
}

// Deliberately just the count — the previous version also showed a
// hardcoded "100% Verificadas" and a "Sincronizado: hace instantes" that
// never reflected anything real (no verification check backed the first,
// no timestamp backed the second). Neither helped a user decide anything,
// so both are gone rather than kept as decoration.
export const StatsBar: React.FC<StatsBarProps> = ({ totalJobs, filteredJobs }) => {
  return (
    <p className="text-xs font-mono text-muted-foreground mb-4">
      <strong className="text-foreground font-semibold">{filteredJobs}</strong> de {totalJobs} vacantes
    </p>
  );
};
