import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatasetSchema, defaultScoringConfig, evaluateMatching, expandDataset } from "@job-radar/matching";
import {
  estimateDailyCost,
  ModelGateway,
  ModelsConfigSchema,
  runLlmMatching,
  type CompletionRequest,
  type CompletionResult,
  type ModelClient,
  type ModelsConfig
} from "@job-radar/models";
import { loadModelsConfig } from "@job-radar/models";
import { resolveProfile } from "./match-commands.js";

export function resolveModelsConfig(root: string): ModelsConfig {
  const local = join(root, "config/models.local.yaml");
  if (existsSync(local)) {
    return loadModelsConfig(local);
  }
  return loadModelsConfig(join(root, "config/models.example.yaml"));
}

/**
 * Deterministic heuristic stand-in for a model. Lets the eval harness and
 * budgets be exercised offline. Its results NEVER count toward activation
 * gates — those require real model runs (plan §24.5).
 */
export function heuristicMockClient(): ModelClient {
  return {
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      let text: string;
      if (request.system.includes("análisis profundo")) {
        const relevant = /(analyst|analista|\bsql\b|dashboards)/i.test(request.user);
        const excluded = /(director|head of|unpaid)/i.test(request.user);
        text = JSON.stringify({
          decision: excluded ? "reject" : relevant ? "continue" : "review",
          confidence: 0.7,
          hard_reasons: excluded ? ["excluded seniority/title"] : [],
          soft_reasons: [],
          evidence: []
        });
      } else if (request.system.includes("encaje laboral")) {
        const sql = /\bsql\b/i.test(request.user);
        text = JSON.stringify({
          score: sql ? 75 : 45,
          confidence: 0.6,
          requirements: [],
          hard_blockers: [],
          summary: "mock assessment"
        });
      } else {
        text = JSON.stringify({ verdict: "accept", corrections: [], confidence: 0.6 });
      }
      return { text, inputTokens: 800, outputTokens: 150 };
    }
  };
}

/** Offline comparative eval (mock model) vs the deterministic baseline. */
export async function runLlmMockEval(root: string): Promise<{
  summary: Record<string, unknown>;
  markdownPath: string;
}> {
  const profile = resolveProfile(root, "default");
  const scoring = defaultScoringConfig();
  const dataset = DatasetSchema.parse(
    JSON.parse(readFileSync(join(root, "evals/datasets/matching-synthetic.json"), "utf8"))
  );
  const { items, referenceDate } = expandDataset(dataset);
  const baseline = evaluateMatching(profile, scoring, items, referenceDate);

  const config = resolveModelsConfig(root);
  const gateway = new ModelGateway({
    config: ModelsConfigSchema.parse({
      ...config,
      budgets: { ...config.budgets, max_llm_jobs_per_run: items.length, max_daily_cloud_cost_usd: 1000 }
    }),
    client: heuristicMockClient(),
    varDir: join(root, "var/mock-eval"),
    allowInactive: true
  });

  const results = await runLlmMatching({
    gateway,
    profile,
    candidates: items.map((item) => {
      const base = baseline.results.find((r) => r.jobId === item.job.id)!;
      return {
        job: item.job,
        baselineDecision: base.decision,
        baselineScore: base.score,
        featuresCompact: "{}"
      };
    }),
    scoringPolicy: JSON.stringify(scoring.weights),
    candidateFactsCompact: JSON.stringify({ note: "mock eval — no real facts sent" })
  });

  const byId = new Map(items.map((item) => [item.job.id, item]));
  let gateCorrect = 0;
  for (const result of results) {
    const item = byId.get(result.jobId)!;
    const predictedRelevant = result.gate.decision !== "reject";
    if (predictedRelevant === (item.label === "relevant")) {
      gateCorrect += 1;
    }
  }

  const summary = {
    mode: "MOCK (heurística determinista — NO cuenta para gates de activación)",
    dataset: dataset.name,
    baseline_precision_at_10: baseline.precision_at_10,
    baseline_escaped_blockers: baseline.escaped_blockers,
    gate_agreement_with_labels: Math.round((gateCorrect / results.length) * 1000) / 1000,
    llm_calls: gateway.stats.calls,
    estimated_cost_usd_if_real: Math.round(gateway.stats.costUsd * 10000) / 10000,
    gates_passed: false,
    activation: "Los prompts permanecen inactivos: la evaluación real requiere ANTHROPIC_API_KEY."
  };

  const reportsDir = join(root, "evals/reports");
  mkdirSync(reportsDir, { recursive: true });
  const markdownPath = join(
    reportsDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-llm-mock.md`
  );
  writeFileSync(
    markdownPath,
    [
      "# Eval LLM (MOCK) vs baseline determinista",
      "",
      "> Ejecutada con un cliente heurístico determinista, sin llamadas cloud.",
      "> NO satisface los gates del plan §24.5 — sirve para validar el harness,",
      "> los presupuestos y los schemas. La comparación real requiere API key.",
      "",
      ...Object.entries(summary).map(([key, value]) => `- ${key}: ${String(value)}`)
    ].join("\n")
  );
  return { summary, markdownPath };
}

export function llmCostEstimate(root: string) {
  const config = resolveModelsConfig(root);
  const estimate = estimateDailyCost(config);
  return {
    budgets: config.budgets,
    lines: estimate.lines.map((line) => ({
      ...line,
      costUsd: Math.round(line.costUsd * 10000) / 10000
    })),
    total_usd: Math.round(estimate.totalUsd * 10000) / 10000,
    within_daily_budget: estimate.withinDailyBudget
  };
}
