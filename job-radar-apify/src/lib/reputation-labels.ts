/**
 * Employer reputation as text (docs/COMPANY-REPUTATION-PLAN.md §1: text
 * attribution only, never a source's logo — none of these sources license
 * logo reuse). One copy shared by ReputationBadges.tsx and the server-rendered
 * company and job pages, so the raw HTML and the hydrated DOM say the same.
 */
export interface ReputationText {
  source: string;
  score: number | null;
  scoreScale: string;
  reviewCount: number | null;
}

export const REPUTATION_SOURCE_LABELS: Record<string, string> = {
  merco: "Merco Talento",
  gptw: "Great Place to Work",
  computrabajo: "Computrabajo"
};

export function reputationLabel(source: string): string {
  return REPUTATION_SOURCE_LABELS[source] || source;
}

/** "7.5 (0-10)", or "Certificación" when the source certifies without a score. */
export function reputationScoreText(entry: Pick<ReputationText, "score" | "scoreScale">): string {
  return entry.score !== null ? `${entry.score} (${entry.scoreScale})` : "Certificación";
}

/** " · 318 reseñas", only when the source published a review count. */
export function reputationReviewText(entry: Pick<ReputationText, "reviewCount">): string {
  return entry.reviewCount !== null ? ` · ${entry.reviewCount} reseñas` : "";
}
