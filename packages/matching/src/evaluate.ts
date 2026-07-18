import type { CanonicalJob, Profile } from "@job-radar/domain";
import { rankResults, scoreJob, type MatchResult } from "./score.js";
import type { ScoringConfig } from "./scoring-config.js";

export interface LabeledItem {
  job: CanonicalJob;
  /** Human/synthetic ground truth. */
  label: "relevant" | "not_relevant";
  /** True when a hard filter is expected to reject the job. */
  expect_blocker?: boolean;
}

export interface EvalMetrics {
  scoring_version: string;
  dataset_size: number;
  precision_at_10: number;
  precision_at_25: number;
  false_positives_top25: number;
  escaped_blockers: number;
  expected_blockers: number;
  results: (MatchResult & { label: string; title: string })[];
}

function precisionAtK(
  ranked: (MatchResult & { label: string })[],
  k: number
): number {
  const top = ranked.slice(0, k);
  if (top.length === 0) {
    return 0;
  }
  const relevant = top.filter((item) => item.label === "relevant").length;
  return Math.round((relevant / top.length) * 1000) / 1000;
}

/** Offline baseline evaluation (plan §24, D04): deterministic and reproducible. */
export function evaluateMatching(
  profile: Profile,
  config: ScoringConfig,
  items: LabeledItem[],
  now = new Date()
): EvalMetrics {
  const scored = items.map((item) => ({
    ...scoreJob(profile, item.job, config, now),
    label: item.label,
    title: item.job.titleRaw,
    expectBlocker: item.expect_blocker ?? false
  }));

  const ranked = rankResults(scored, "high_recall") as (MatchResult & {
    label: string;
    title: string;
    expectBlocker: boolean;
  })[];

  const expectedBlockers = scored.filter((item) => item.expectBlocker);
  const escaped = expectedBlockers.filter((item) => item.decision !== "reject");

  return {
    scoring_version: config.scoring_version,
    dataset_size: items.length,
    precision_at_10: precisionAtK(ranked, 10),
    precision_at_25: precisionAtK(ranked, 25),
    false_positives_top25: ranked
      .slice(0, 25)
      .filter((item) => item.label === "not_relevant").length,
    escaped_blockers: escaped.length,
    expected_blockers: expectedBlockers.length,
    results: scored.map(({ expectBlocker: _expectBlocker, ...rest }) => rest)
  };
}

export function renderEvalMarkdown(metrics: EvalMetrics): string {
  const lines = [
    `# Informe baseline de matching (${metrics.scoring_version})`,
    "",
    `- Dataset: ${metrics.dataset_size} vacantes etiquetadas`,
    `- precision@10: **${metrics.precision_at_10}**`,
    `- precision@25: **${metrics.precision_at_25}**`,
    `- Falsos positivos en top 25: ${metrics.false_positives_top25}`,
    `- Blockers escapados: ${metrics.escaped_blockers} / ${metrics.expected_blockers}`,
    "",
    "| Score | Decisión | Etiqueta | Vacante | Blockers |",
    "|---|---|---|---|---|"
  ];
  for (const result of [...metrics.results].sort((a, b) => b.score - a.score)) {
    lines.push(
      `| ${result.score} | ${result.decision} | ${result.label} | ${result.title} | ${
        result.hard_blockers.join("; ") || "—"
      } |`
    );
  }
  return lines.join("\n");
}
