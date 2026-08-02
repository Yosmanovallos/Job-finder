import React from "react";
import { ExternalLink } from "lucide-react";

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
  gptw: "Great Place to Work",
  computrabajo: "Computrabajo"
};

// Per-source accent color for the badge chip, same spirit as
// lib/source-colors.ts for job-portal badges — distinguishes reputation
// sources at a glance, not a trademark claim.
const REPUTATION_COLORS: Record<string, { bg: string; text: string }> = {
  merco: { bg: "rgba(212,169,58,0.16)", text: "#8a6d1a" },
  gptw: { bg: "rgba(15,107,76,0.12)", text: "#0f6b4c" },
  computrabajo: { bg: "rgba(242,101,34,0.10)", text: "#F26522" }
};
const DEFAULT_REPUTATION_COLOR = { bg: "#f1f2f0", text: "#5b5f5c" };

export interface ReputationBadgesProps {
  entries: ReputationEntryProps[];
}

// Renders nothing at all when there are no confirmed entries — a job whose
// company has no curated alias must never show an empty placeholder or a
// guessed value (regla 5 de AGENTS.md). Shared by JobDetailPanel's narrow
// split-pane and CompanyLanding's full-width page, so this stays a compact
// row-per-source chip, not a card sized for one context.
export const ReputationBadges: React.FC<ReputationBadgesProps> = ({ entries }) => {
  if (!entries || entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="font-heading font-semibold text-sm text-foreground mb-3">
        Reputación como empleador
      </h3>
      <div className="space-y-2">
        {entries.map((entry) => {
          const color = REPUTATION_COLORS[entry.source] || DEFAULT_REPUTATION_COLOR;
          return (
            <a
              key={entry.source}
              href={entry.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Ver fuente: ${SOURCE_LABELS[entry.source] || entry.source}`}
              className="flex items-center gap-2.5 rounded-md border border-border bg-background/60 px-3 py-2 hover:border-border-strong transition-colors"
            >
              <span
                className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium"
                style={{ background: color.bg, color: color.text }}
              >
                {SOURCE_LABELS[entry.source] || entry.source}
              </span>
              <span className="text-sm text-foreground/80 flex-1 min-w-0">
                {entry.score !== null ? (
                  <>
                    {entry.score}{" "}
                    <span className="text-muted-foreground">({entry.scoreScale})</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Certificación</span>
                )}
                {entry.reviewCount !== null && (
                  <span className="text-muted-foreground"> · {entry.reviewCount} reseñas</span>
                )}
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
          );
        })}
      </div>
    </div>
  );
};
