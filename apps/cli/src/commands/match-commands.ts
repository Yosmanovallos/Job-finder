import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProfile, type Profile } from "@job-radar/domain";
import {
  DatasetSchema,
  defaultScoringConfig,
  evaluateMatching,
  expandDataset,
  loadScoringConfig,
  renderEvalMarkdown,
  type ScoringConfig
} from "@job-radar/matching";

export function resolveProfile(root: string, profileId: string): Profile {
  const local = join(root, "config/profile.local.yaml");
  if (profileId === "default" && !existsSync(local)) {
    return loadProfile(join(root, "config/profile.example.yaml"));
  }
  return loadProfile(local);
}

export function resolveScoring(root: string): ScoringConfig {
  const local = join(root, "config/scoring.local.yaml");
  return existsSync(local) ? loadScoringConfig(local) : defaultScoringConfig();
}

export interface EvalRunPaths {
  jsonPath: string;
  markdownPath: string;
}

/** Runs the offline baseline eval and writes timestamped reports. */
export function runMatchingEval(root: string): { summary: Record<string, unknown> } & EvalRunPaths {
  const profile = resolveProfile(root, "default");
  const config = resolveScoring(root);
  const dataset = DatasetSchema.parse(
    JSON.parse(readFileSync(join(root, "evals/datasets/matching-synthetic.json"), "utf8"))
  );
  const { items, referenceDate } = expandDataset(dataset);
  const metrics = evaluateMatching(profile, config, items, referenceDate);

  const reportsDir = join(root, "evals/reports");
  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(reportsDir, `${stamp}-matching.json`);
  const markdownPath = join(reportsDir, `${stamp}-matching.md`);
  writeFileSync(jsonPath, JSON.stringify(metrics, null, 2));
  writeFileSync(markdownPath, renderEvalMarkdown(metrics));

  return {
    summary: {
      dataset: dataset.name,
      scoring_version: metrics.scoring_version,
      precision_at_10: metrics.precision_at_10,
      precision_at_25: metrics.precision_at_25,
      false_positives_top25: metrics.false_positives_top25,
      escaped_blockers: `${metrics.escaped_blockers}/${metrics.expected_blockers}`
    },
    jsonPath,
    markdownPath
  };
}

export function latestReport(root: string): string | null {
  const reportsDir = join(root, "evals/reports");
  if (!existsSync(reportsDir)) {
    return null;
  }
  const reports = readdirSync(reportsDir)
    .filter((name) => name.endsWith(".md"))
    .sort();
  const latest = reports[reports.length - 1];
  return latest ? readFileSync(join(reportsDir, latest), "utf8") : null;
}

/** Imports human labels from CSV (job_id,label,reason) into evals/datasets. */
export function importLabels(root: string, csvPath: string): { imported: number; outPath: string } {
  const lines = readFileSync(csvPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const [header, ...rows] = lines;
  if (!header || !/^job_id\s*,\s*label(\s*,\s*reason)?$/i.test(header)) {
    throw new Error('Expected CSV header "job_id,label[,reason]"');
  }
  const labels = rows.map((row, index) => {
    const [jobId, label, ...reason] = row.split(",");
    if (!jobId || !label || !["relevant", "not_relevant"].includes(label.trim())) {
      throw new Error(`Row ${index + 2}: expected "job_id,label[,reason]" with label relevant|not_relevant`);
    }
    return {
      job_id: jobId.trim(),
      label: label.trim() as "relevant" | "not_relevant",
      reason: reason.join(",").trim() || null,
      imported_at: new Date().toISOString()
    };
  });
  const outPath = join(root, "evals/datasets/human-labels.json");
  const existing: unknown[] = existsSync(outPath)
    ? (JSON.parse(readFileSync(outPath, "utf8")) as unknown[])
    : [];
  writeFileSync(outPath, JSON.stringify([...existing, ...labels], null, 2));
  return { imported: labels.length, outPath };
}
