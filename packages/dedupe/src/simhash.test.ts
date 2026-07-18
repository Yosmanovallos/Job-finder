import { describe, expect, it } from "vitest";
import {
  fromSignedBigint,
  hammingDistance64,
  simhash64,
  SIMHASH_HAMMING_THRESHOLD,
  toSignedBigint
} from "./simhash.js";
import { jobFixture } from "./fixtures.js";

const LONG_TEXT = jobFixture().descriptionText;

describe("simhash64", () => {
  it("is deterministic", () => {
    expect(simhash64(LONG_TEXT)).toBe(simhash64(LONG_TEXT));
  });

  it("returns null for short texts (collision-prone)", () => {
    expect(simhash64("too short to hash")).toBeNull();
  });

  it("keeps near-identical descriptions within the threshold", () => {
    const tweaked = LONG_TEXT.replace("dashboards", "reports").replace("weekly", "daily");
    const a = simhash64(LONG_TEXT)!;
    const b = simhash64(tweaked)!;
    expect(hammingDistance64(a, b)).toBeLessThanOrEqual(SIMHASH_HAMMING_THRESHOLD);
  });

  it("separates genuinely different descriptions", () => {
    const other =
      "Senior platform engineer role focused on Kubernetes clusters, Terraform " +
      "modules, incident response rotations, golang microservices, capacity " +
      "planning, cost optimization, and mentoring a distributed infrastructure " +
      "team across several regions with strong reliability culture and modern " +
      "observability tooling everywhere in the organization today. You will " +
      "design deployment pipelines, harden network policies, automate disaster " +
      "recovery drills, review architecture proposals, and own the internal " +
      "developer platform roadmap together with product leadership every quarter.";
    const a = simhash64(LONG_TEXT)!;
    const b = simhash64(other)!;
    expect(hammingDistance64(a, b)).toBeGreaterThan(SIMHASH_HAMMING_THRESHOLD);
  });

  it("round-trips through signed storage", () => {
    const hash = simhash64(LONG_TEXT)!;
    expect(fromSignedBigint(toSignedBigint(hash))).toBe(hash);
  });
});
