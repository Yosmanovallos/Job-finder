import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadFacts, loadProfile } from "@job-radar/domain";
import { runValidation } from "./validate-yaml-file.js";

const dir = mkdtempSync(join(tmpdir(), "cli-validate-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("runValidation", () => {
  it("reports ok for a valid profile", () => {
    const path = join(dir, "profile.yaml");
    writeFileSync(path, "roles:\n  target_titles: [Data Analyst]\n", "utf8");
    expect(runValidation(path, loadProfile)).toEqual({ ok: true, path, issues: [] });
  });

  it("reports issues with paths and hints for an invalid profile", () => {
    const path = join(dir, "bad-profile.yaml");
    writeFileSync(path, "roles:\n  target_titles: []\n", "utf8");
    const report = runValidation(path, loadProfile);
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.path).toBe("roles.target_titles");
  });

  it("reports a missing facts file with the template hint", () => {
    const report = runValidation(join(dir, "missing.yaml"), loadFacts);
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.hint).toContain("cv-facts.example.yaml");
  });

  it("does not echo file values in facts reports", () => {
    const path = join(dir, "facts.yaml");
    writeFileSync(
      path,
      'experience:\n  - id: experience_001\n    company: "Ultra Secret Corp"\n    title: "T"\n    start_date: "2023-13"\n',
      "utf8"
    );
    const report = runValidation(path, loadFacts);
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain("Ultra Secret Corp");
  });
});
