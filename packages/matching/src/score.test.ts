import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProfile } from "@job-radar/domain";
import { DatasetSchema, expandDataset } from "./dataset.js";
import { evaluateMatching } from "./evaluate.js";
import { defaultScoringConfig } from "./scoring-config.js";
import { rankResults, scoreJob } from "./score.js";
import { seniorityFromTitle, skillInText, titleMatches } from "./taxonomy.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const profile = loadProfile(resolve(repoRoot, "config/profile.example.yaml"));
const config = defaultScoringConfig();
const dataset = DatasetSchema.parse(
  JSON.parse(readFileSync(resolve(repoRoot, "evals/datasets/matching-synthetic.json"), "utf8"))
);
const { items, referenceDate } = expandDataset(dataset);

function itemByTitle(title: string, description?: string) {
  const found = items.find(
    (item) =>
      item.job.titleRaw === title &&
      (description === undefined || item.job.descriptionText.includes(description))
  );
  if (!found) {
    throw new Error(`No dataset item titled ${title}`);
  }
  return found;
}

describe("taxonomy", () => {
  it("finds skills through synonyms with word boundaries", () => {
    expect(skillInText("Power BI", "We use PowerBI daily")).toBe(true);
    expect(skillInText("SQL", "PostgreSQL modeling")).toBe(true);
    expect(skillInText("R", "We use R language here")).toBe(true);
    expect(skillInText("SQL", "sequel prose without the skill")).toBe(false);
  });

  it("derives seniority features from titles without touching the record", () => {
    expect(seniorityFromTitle("Senior Data Analyst")).toBe("senior");
    expect(seniorityFromTitle("Jr. Analyst")).toBe("junior");
    expect(seniorityFromTitle("Data Analyst")).toBeNull();
  });

  it("matches titles token-wise", () => {
    expect(titleMatches("Data Analyst", "Data Analyst (Marketing)")).toBe(true);
    expect(titleMatches("Senior Director", "Senior Director of Analytics")).toBe(true);
    expect(titleMatches("Data Analyst", "Backend Engineer")).toBe(false);
  });
});

describe("scoreJob (guide scenario)", () => {
  it("scores a strong remote match as priority with explanations", () => {
    const { job } = itemByTitle("Data Analyst", "Remote for LATAM");
    const result = scoreJob(profile, job, config, referenceDate);
    expect(result.decision).toBe("priority");
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.matched_requirements.join(" ")).toContain("SQL");
    expect(result.hard_blockers).toEqual([]);
    expect(result.recommended_action).toBe("review_and_tailor_cv");
    expect(Object.keys(result.score_breakdown)).toContain("must_have_skills");
  });

  it("rejects excluded titles (Senior Director)", () => {
    const { job } = itemByTitle("Senior Director of Analytics");
    const result = scoreJob(profile, job, config, referenceDate);
    expect(result.decision).toBe("reject");
    expect(result.hard_blockers.join(" ")).toContain("excluded title");
  });

  it("rejects onsite-only jobs when the profile does not accept onsite", () => {
    const { job } = itemByTitle("Data Analyst", "Munich");
    const result = scoreJob(profile, job, config, referenceDate);
    expect(result.decision).toBe("reject");
  });

  it("rejects unpaid-only employment and closed jobs", () => {
    expect(
      scoreJob(profile, itemByTitle("Unpaid Data Intern").job, config, referenceDate).decision
    ).toBe("reject");
    expect(
      scoreJob(profile, itemByTitle("Data Analyst", "was filled").job, config, referenceDate)
        .hard_blockers
    ).toContain("job is closed");
  });

  it("keeps unknowns as uncertainty, not blockers", () => {
    const { job } = itemByTitle("Data Analyst", "no stated location");
    const result = scoreJob(profile, job, config, referenceDate);
    expect(result.decision).not.toBe("reject");
    expect(result.uncertain_requirements.join(" ")).toContain("publication date");
    expect(result.confidence).toBeLessThan(0.9);
  });

  it("ranks targeted titles above skill-heavy but untargeted roles", () => {
    const analyst = scoreJob(
      profile,
      itemByTitle("Data Analyst", "Remote for LATAM").job,
      config,
      referenceDate
    );
    const engineer = scoreJob(
      profile,
      itemByTitle("Data Engineer").job,
      config,
      referenceDate
    );
    expect(analyst.score).toBeGreaterThan(engineer.score);
  });

  it("high_precision view only keeps priority decisions", () => {
    const results = items.map((item) => scoreJob(profile, item.job, config, referenceDate));
    const precise = rankResults(results, "high_precision");
    expect(precise.every((result) => result.decision === "priority")).toBe(true);
    const recall = rankResults(results, "high_recall");
    expect(recall.length).toBeGreaterThan(precise.length);
  });
});

describe("evaluateMatching baseline", () => {
  it("meets the baseline quality bar on the synthetic dataset", () => {
    const metrics = evaluateMatching(profile, config, items, referenceDate);
    expect(metrics.dataset_size).toBe(20);
    expect(metrics.escaped_blockers).toBe(0);
    expect(metrics.precision_at_10).toBeGreaterThanOrEqual(0.8);
    expect(metrics.results.every((result) => result.evidence.length > 0)).toBe(true);
  });
});
