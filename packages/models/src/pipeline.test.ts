import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { CanonicalJob } from "@job-radar/domain";
import { loadProfile } from "@job-radar/domain";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelGateway } from "./gateway.js";
import { ModelsConfigSchema } from "./model-config.js";
import { runLlmMatching, type LlmCandidate } from "./pipeline.js";
import type { CompletionRequest, CompletionResult, ModelClient } from "./client.js";

const dir = mkdtempSync(join(tmpdir(), "llm-pipeline-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const profile = loadProfile(resolve(repoRoot, "config/profile.example.yaml"));

const config = ModelsConfigSchema.parse({
  aliases: { reasoning_high: "big", general_balanced: "mid", fast_structured: "small", local_fast: "small" },
  pricing: {},
  tasks: {
    relevance_gate: { model_alias: "local_fast", max_output_tokens: 500 },
    fit_judge: { model_alias: "general_balanced", max_output_tokens: 1800 },
    disputed_review: { model_alias: "reasoning_high", max_output_tokens: 2200 }
  },
  budgets: {
    max_llm_jobs_per_run: 2,
    max_reasoning_high_calls_per_run: 5,
    max_daily_cloud_cost_usd: 5,
    stop_on_budget_exceeded: true
  }
});

/** Deterministic mock: routes by task-specific markers in the system prompt. */
function mockClient(): ModelClient & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    requests,
    async complete(request): Promise<CompletionResult> {
      requests.push(request);
      let text: string;
      if (request.system.includes("análisis profundo")) {
        const jobBlock = /<JOB_SUMMARY>([\s\S]*?)<\/JOB_SUMMARY>/.exec(request.user)?.[1] ?? "";
        const relevant = /analyst|sql/i.test(jobBlock);
        text = JSON.stringify({
          decision: relevant ? "continue" : "reject",
          confidence: 0.8,
          hard_reasons: relevant ? [] : ["off-target title"],
          soft_reasons: [],
          evidence: ["quote"]
        });
      } else if (request.system.includes("encaje laboral")) {
        text = JSON.stringify({
          score: 80,
          confidence: 0.8,
          requirements: [
            { requirement: "SQL", status: "met", candidate_evidence: ["skill_sql"], job_evidence: ["SQL"] }
          ],
          hard_blockers: [],
          summary: "fit"
        });
      } else {
        text = JSON.stringify({ verdict: "accept", corrections: [], confidence: 0.9 });
      }
      return { text, inputTokens: 500, outputTokens: 100 };
    }
  };
}

function jobFor(title: string, description: string): CanonicalJob {
  const now = new Date().toISOString();
  const url = `https://x.example.test/${randomUUID()}`;
  return {
    id: randomUUID(),
    sourceId: "stub:a",
    sourceJobId: "1",
    sourceUrl: url,
    canonicalUrl: url,
    applyUrl: null,
    titleRaw: title,
    titleNormalized: title.toLowerCase(),
    titleFamily: null,
    seniority: "unknown",
    companyNameRaw: "Acme",
    companyId: null,
    companyNameNormalized: "acme",
    companyDomain: null,
    descriptionText: description,
    responsibilities: [],
    requiredSkills: [],
    preferredSkills: [],
    requiredExperienceYears: null,
    educationRequirements: [],
    languageRequirements: [],
    locations: [],
    workMode: "unknown",
    remoteRegion: null,
    employmentTypes: [],
    compensation: { min: null, max: null, currency: null, period: null, source: "unknown" },
    visaSponsorship: "unknown",
    publishedAt: null,
    expiresAt: null,
    firstSeenAt: now,
    lastSeenAt: now,
    lastVerifiedAt: null,
    status: "active",
    extractionMethod: "api",
    extractionConfidence: 0.9,
    contentHash: "h",
    evidence: []
  };
}

describe("runLlmMatching", () => {
  it("gates every candidate, judges only survivors, critic only for top/disputes", async () => {
    const client = mockClient();
    const gateway = new ModelGateway({
      config,
      client,
      varDir: mkdtempSync(join(dir, "var-")),
      allowInactive: true
    });
    const candidates: LlmCandidate[] = [
      {
        job: jobFor("Data Analyst", "SQL dashboards"),
        baselineDecision: "priority",
        baselineScore: 80,
        featuresCompact: "{}"
      },
      {
        job: jobFor("Chef", "cooking"),
        baselineDecision: "discard",
        baselineScore: 10,
        featuresCompact: "{}"
      }
    ];

    const results = await runLlmMatching({
      gateway,
      profile,
      candidates,
      scoringPolicy: "{}",
      candidateFactsCompact: JSON.stringify({ skills: ["SQL"] }),
      criticTopN: 1
    });

    expect(results).toHaveLength(2);
    expect(results[0]!.gate.decision).toBe("continue");
    expect(results[0]!.judge?.score).toBe(80);
    expect(results[0]!.criticVerdict).toBe("accept");
    expect(results[1]!.gate.decision).toBe("reject");
    expect(results[1]!.judge).toBeUndefined();
  });

  it("respects max_llm_jobs_per_run", async () => {
    const client = mockClient();
    const gateway = new ModelGateway({
      config,
      client,
      varDir: mkdtempSync(join(dir, "var-")),
      allowInactive: true
    });
    const candidates: LlmCandidate[] = [1, 2, 3, 4].map((n) => ({
      job: jobFor(`Chef ${n}`, "cooking"),
      baselineDecision: "discard" as const,
      baselineScore: 5,
      featuresCompact: "{}"
    }));
    const results = await runLlmMatching({
      gateway,
      profile,
      candidates,
      scoringPolicy: "{}",
      candidateFactsCompact: "{}"
    });
    expect(results).toHaveLength(2);
  });
});
