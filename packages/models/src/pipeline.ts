import type { CanonicalJob, Profile } from "@job-radar/domain";
import { BudgetExceededError, type ModelGateway } from "./gateway.js";
import {
  fitJudgeV1,
  relevanceGateV1,
  scoreCriticV1,
  type FitAssessment,
  type GateDecision
} from "./prompts.js";

/**
 * Selective LLM pipeline (plan §13.1 etapa 3, D05): cheap gate over the
 * candidate list, judge only for gate survivors, high-reasoning critic only
 * for configured cases (top N or judge/baseline disagreement). Compact
 * summaries only — never the full CV (D05: no enviar CV completo).
 */

export interface LlmCandidate {
  job: CanonicalJob;
  /** Deterministic baseline decision from Fase 4. */
  baselineDecision: "priority" | "consider" | "discard" | "reject";
  baselineScore: number;
  featuresCompact: string;
}

export interface LlmMatchResult {
  jobId: string;
  gate: GateDecision;
  judge?: FitAssessment;
  criticVerdict?: string;
  budgetStopped?: boolean;
}

export function profileCompact(profile: Profile): string {
  return JSON.stringify({
    target_titles: profile.roles.target_titles,
    excluded_titles: profile.roles.excluded_titles,
    seniority: profile.seniority.preferred,
    must_have: profile.skills.must_have,
    strong: profile.skills.strong,
    locations: profile.locations,
    languages: profile.languages
  });
}

export function jobCompact(job: CanonicalJob, maxDescriptionChars = 1500): string {
  return JSON.stringify({
    title: job.titleRaw,
    company: job.companyNameRaw,
    seniority: job.seniority,
    workMode: job.workMode,
    locations: job.locations.map((location) => location.raw),
    employmentTypes: job.employmentTypes,
    compensation: job.compensation,
    description: job.descriptionText.slice(0, maxDescriptionChars)
  });
}

export async function runLlmMatching(options: {
  gateway: ModelGateway;
  profile: Profile;
  candidates: LlmCandidate[];
  scoringPolicy: string;
  candidateFactsCompact: string;
  criticTopN?: number;
}): Promise<LlmMatchResult[]> {
  const { gateway, profile, candidates } = options;
  const criticTopN = options.criticTopN ?? 3;
  const maxJobs = Math.min(candidates.length, gateway.budgets.max_llm_jobs_per_run);
  const results: LlmMatchResult[] = [];
  const compactProfile = profileCompact(profile);

  let processed = 0;
  for (const candidate of candidates) {
    if (processed >= maxJobs) {
      break;
    }
    processed += 1;
    try {
      const { output: gate } = await gateway.run(relevanceGateV1, {
        profileCompact: compactProfile,
        jobCompact: jobCompact(candidate.job)
      });
      const result: LlmMatchResult = { jobId: candidate.job.id, gate };

      if (gate.decision === "continue") {
        const { output: judge } = await gateway.run(fitJudgeV1, {
          candidateFactsCompact: options.candidateFactsCompact,
          preferencesCompact: compactProfile,
          jobCompact: jobCompact(candidate.job, 3000),
          deterministicFeatures: candidate.featuresCompact,
          scoringPolicy: options.scoringPolicy
        });
        result.judge = judge;
      }
      results.push(result);
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        results.push({
          jobId: candidate.job.id,
          gate: {
            decision: "review",
            confidence: 0,
            hard_reasons: [],
            soft_reasons: ["budget exceeded — left for human review"],
            evidence: []
          },
          budgetStopped: true
        });
        break;
      }
      throw error;
    }
  }

  // Critic (reasoning_high) only for configured cases: top N judged results
  // or judge/baseline disagreement — never for every record (plan §11.1.7).
  const judged = results
    .filter((result) => result.judge)
    .sort((a, b) => (b.judge!.score ?? 0) - (a.judge!.score ?? 0));
  const disputed = judged.filter((result) => {
    const candidate = candidates.find((entry) => entry.job.id === result.jobId)!;
    const judgeSaysGood = result.judge!.score >= 70;
    const baselineSaysGood = candidate.baselineDecision === "priority";
    return judgeSaysGood !== baselineSaysGood;
  });
  const criticTargets = [...new Set([...judged.slice(0, criticTopN), ...disputed])];

  for (const target of criticTargets) {
    const candidate = candidates.find((entry) => entry.job.id === target.jobId)!;
    try {
      const { output: verdict } = await gateway.run(scoreCriticV1, {
        profileCompact: compactProfile,
        jobCompact: jobCompact(candidate.job),
        assessmentJson: JSON.stringify(target.judge)
      });
      target.criticVerdict = verdict.verdict;
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        break;
      }
      throw error;
    }
  }

  return results;
}
