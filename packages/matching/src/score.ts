import type { CanonicalJob, Profile } from "@job-radar/domain";
import { computeFeatures, type MatchFeatures } from "./features.js";
import type { ScoringConfig } from "./scoring-config.js";

/** Output contract per plan §13.3. Every claim carries evidence. */
export interface MatchResult {
  jobId: string;
  score: number;
  confidence: number;
  decision: "priority" | "consider" | "discard" | "reject";
  matched_requirements: string[];
  missing_requirements: string[];
  uncertain_requirements: string[];
  hard_blockers: string[];
  evidence: { field: string; quote: string; sourceUrl: string }[];
  why_apply: string[];
  why_not_apply: string[];
  recommended_action: string;
  score_breakdown: Record<string, number>;
}

/** Stage-1 deterministic filters (plan §13.1). */
export function hardBlockers(profile: Profile, job: CanonicalJob, features: MatchFeatures): string[] {
  const blockers: string[] = [];
  if (features.titleExcluded) {
    blockers.push("title matches an excluded title");
  }
  if (features.geo === "incompatible") {
    blockers.push(`location incompatible: ${features.geoReason}`);
  }
  if (features.employmentRejected) {
    blockers.push(`employment type rejected: ${job.employmentTypes.join(", ")}`);
  }
  if (features.missingMustHave.length > 0 && features.matchedMustHave.length === 0 && profile.skills.must_have.length > 0) {
    blockers.push(`no must-have skill found (${features.missingMustHave.join(", ")})`);
  }
  if (features.seniorityDelta !== null && features.seniorityDelta >= 3) {
    blockers.push(`seniority far above preference (${features.effectiveSeniority ?? "?"})`);
  }
  if (features.compensationBelowMinimum) {
    blockers.push("stated compensation below configured minimum");
  }
  if (job.status === "closed") {
    blockers.push("job is closed");
  }
  return blockers;
}

function fraction(part: number, whole: number, fallback = 0.5): number {
  return whole === 0 ? fallback : part / whole;
}

export function scoreJob(
  profile: Profile,
  job: CanonicalJob,
  config: ScoringConfig,
  now = new Date()
): MatchResult {
  const features = computeFeatures(profile, job, now);
  const blockers = hardBlockers(profile, job, features);
  const w = config.weights;
  const breakdown: Record<string, number> = {};

  breakdown.responsibilities =
    w.responsibilities *
    fraction(features.matchedResponsibilities.length, profile.responsibilities.preferred.length);

  breakdown.must_have_skills =
    w.must_have_skills * fraction(features.matchedMustHave.length, profile.skills.must_have.length, 1);

  const preferredTotal = profile.skills.strong.length + profile.skills.nice_to_have.length;
  breakdown.preferred_skills =
    w.preferred_skills * fraction(features.matchedPreferred.length, preferredTotal);

  if (features.seniorityDelta === null) {
    breakdown.seniority = w.seniority * 0.5;
  } else if (features.seniorityDelta === 0) {
    breakdown.seniority = w.seniority;
  } else if (Math.abs(features.seniorityDelta) === 1) {
    breakdown.seniority = w.seniority * 0.6;
  } else {
    breakdown.seniority = 0;
  }

  breakdown.location =
    features.geo === "compatible" ? w.location : features.geo === "unknown" ? w.location * 0.5 : 0;

  breakdown.industry = w.industry * 0.5;

  breakdown.compensation =
    job.compensation.source === "explicit" && !features.compensationBelowMinimum
      ? w.compensation
      : features.compensationBelowMinimum
        ? 0
        : w.compensation * 0.5;

  breakdown.language =
    job.languageRequirements.length === 0
      ? w.language * 0.5
      : features.languagesUnmet.length === 0
        ? w.language
        : 0;

  breakdown.freshness =
    features.freshnessDays === null
      ? w.freshness * 0.5
      : features.freshnessDays <= profile.search.preferred_age_days
        ? w.freshness
        : features.freshnessDays <= profile.search.max_age_days
          ? w.freshness * 0.6
          : 0;

  breakdown.data_quality =
    w.data_quality * (features.descriptionSufficient ? job.extractionConfidence : 0.3);

  // Title relevance gates the whole score multiplicatively: a great skill
  // match on an untargeted title should not outrank targeted roles.
  const titleFactor = features.titleTargeted ? 1 : features.titleAdjacent ? 0.8 : 0.45;

  let score = Object.values(breakdown).reduce((sum, value) => sum + value, 0) * titleFactor;

  if (job.status === "possibly_active") {
    score -= config.penalties.possibly_closed;
  }
  if (blockers.length > 0) {
    score -= config.penalties.probable_blocker;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  const unknownSignals = [
    job.workMode === "unknown",
    job.seniority === "unknown" && features.effectiveSeniority === null,
    job.publishedAt === null,
    !features.descriptionSufficient
  ].filter(Boolean).length;
  const confidence = Math.round((0.95 - unknownSignals * 0.15) * 100) / 100;

  const decision: MatchResult["decision"] =
    blockers.length > 0
      ? "reject"
      : score >= config.thresholds.priority
        ? "priority"
        : score >= config.thresholds.consider
          ? "consider"
          : "discard";

  const matched = [
    ...features.matchedMustHave.map((skill) => `must-have skill present: ${skill}`),
    ...features.matchedPreferred.map((skill) => `preferred skill present: ${skill}`),
    ...(features.geo === "compatible" ? [`location: ${features.geoReason}`] : []),
    ...(features.seniorityDelta === 0 ? ["seniority matches preference"] : [])
  ];
  const missing = [
    ...features.missingMustHave.map((skill) => `must-have skill not found: ${skill}`),
    ...features.missingPreferred.map((skill) => `preferred skill not found: ${skill}`)
  ];
  const uncertain = [
    ...(features.geo === "unknown" ? [`location: ${features.geoReason}`] : []),
    ...(job.workMode === "unknown" ? ["work mode not stated"] : []),
    ...(job.publishedAt === null ? ["publication date not stated"] : []),
    ...(features.effectiveSeniority === null ? ["seniority not stated"] : [])
  ];

  return {
    jobId: job.id,
    score,
    confidence: Math.max(0.1, confidence),
    decision,
    matched_requirements: matched,
    missing_requirements: missing,
    uncertain_requirements: uncertain,
    hard_blockers: blockers,
    evidence: job.evidence,
    why_apply: matched.slice(0, 5),
    why_not_apply: [...blockers, ...missing.slice(0, 3)],
    recommended_action:
      decision === "priority"
        ? "review_and_tailor_cv"
        : decision === "consider"
          ? "review_manually"
          : decision === "reject"
            ? "skip"
            : "ignore_unless_curious",
    score_breakdown: breakdown
  };
}

/** Ranking with the two views of plan §13.4 — no re-scraping, just filtering. */
export function rankResults(
  results: MatchResult[],
  view: "high_precision" | "high_recall"
): MatchResult[] {
  const eligible =
    view === "high_precision"
      ? results.filter((result) => result.decision === "priority")
      : results.filter((result) => result.decision !== "reject");
  return [...eligible].sort((a, b) => b.score - a.score || b.confidence - a.confidence);
}
