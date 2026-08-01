// Shapes for the company-reputation pipeline (docs/COMPANY-REPUTATION-PLAN.md).
// Mirrors sources/types.ts's Job/SourceAdapter split, but for reputation
// scores instead of job postings.

export interface ReputationScoreInput {
  // The name EXACTLY as the source publishes it — never normalized/guessed
  // against jobs.company here. The curated alias table (Fase R2) owns that
  // matching; this stays a faithful copy of what the source actually says.
  companyName: string;
  source: string;
  // null for sources that only offer a binary badge, not a continuous
  // score (e.g. Great Place to Work's certified/not-certified).
  score: number | null;
  // Free text, not a shared numeric range — scales are never comparable
  // across sources (Merco's 0-10000 index vs. Computrabajo's 1-5 vs.
  // GPTW's "certified") and must never be normalized into one number.
  scoreScale: string;
  reviewCount: number | null;
  // Required: the real page this came from — the UI cites this instead of
  // rendering the source's logo (no source with real data authorizes logo
  // reuse, see the plan's research summary).
  sourceUrl: string;
}

export interface ReputationSourceAdapter {
  readonly name: string;
  fetch(): Promise<ReputationScoreInput[]>;
}
