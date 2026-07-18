import { costUsd, resolveModel, type ModelsConfig } from "./model-config.js";

export interface CostEstimateLine {
  task: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface CostEstimate {
  lines: CostEstimateLine[];
  totalUsd: number;
  withinDailyBudget: boolean;
}

/**
 * Estimated cost of one daily run in economic mode (D05 deliverable).
 * Assumptions are explicit and conservative; real numbers come from the
 * usage ledger once prompts are activated.
 */
export function estimateDailyCost(
  config: ModelsConfig,
  assumptions = {
    gateCalls: config.budgets.max_llm_jobs_per_run,
    gateInputTokens: 900,
    gateOutputTokens: 150,
    judgeShare: 0.4,
    judgeInputTokens: 2500,
    judgeOutputTokens: 700,
    criticCalls: config.budgets.max_reasoning_high_calls_per_run,
    criticInputTokens: 2000,
    criticOutputTokens: 500
  }
): CostEstimate {
  const lines: CostEstimateLine[] = [];

  const push = (task: string, calls: number, inTok: number, outTok: number) => {
    const { model } = resolveModel(config, task);
    lines.push({
      task,
      model,
      calls,
      inputTokens: calls * inTok,
      outputTokens: calls * outTok,
      costUsd: costUsd(config, model, calls * inTok, calls * outTok)
    });
  };

  push("relevance_gate", assumptions.gateCalls, assumptions.gateInputTokens, assumptions.gateOutputTokens);
  push(
    "fit_judge",
    Math.round(assumptions.gateCalls * assumptions.judgeShare),
    assumptions.judgeInputTokens,
    assumptions.judgeOutputTokens
  );
  push("disputed_review", assumptions.criticCalls, assumptions.criticInputTokens, assumptions.criticOutputTokens);

  const totalUsd = lines.reduce((sum, line) => sum + line.costUsd, 0);
  return {
    lines,
    totalUsd,
    withinDailyBudget: totalUsd <= config.budgets.max_daily_cloud_cost_usd
  };
}
