import React from "react";

export interface ReputationEntryProps {
  source: string;
  score: number | null;
  scoreScale: string;
  reviewCount: number | null;
  sourceUrl: string;
}

// Text attribution only, never a source's logo — none of the reputation
// sources with real data authorize logo reuse by a third party (see
// docs/COMPANY-REPUTATION-PLAN.md's research summary), so this is the
// deliberate, permanent design, not a placeholder for a future logo.
const SOURCE_LABELS: Record<string, string> = {
  merco: "Merco Talento",
  gptw: "Great Place to Work"
};

export interface ReputationBadgesProps {
  entries: ReputationEntryProps[];
}

// Renders nothing at all when there are no confirmed entries — a job whose
// company has no curated alias must never show an empty placeholder or a
// guessed value (regla 5 de AGENTS.md).
export const ReputationBadges: React.FC<ReputationBadgesProps> = ({ entries }) => {
  if (!entries || entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="font-heading font-semibold text-sm text-foreground mb-2">
        Reputación como empleador
      </h3>
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.source} className="text-sm text-foreground/80">
            <span className="font-medium text-foreground">
              {SOURCE_LABELS[entry.source] || entry.source}
            </span>
            {entry.score !== null ? (
              <>
                : {entry.score} <span className="text-muted-foreground">({entry.scoreScale})</span>
              </>
            ) : (
              <span className="text-muted-foreground"> — certificación</span>
            )}
            {entry.reviewCount !== null && (
              <span className="text-muted-foreground"> · {entry.reviewCount} reseñas</span>
            )}{" "}
            <a
              href={entry.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Ver fuente
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};
