import { describe, expect, it } from "vitest";
import { evidenceUnion, fillGaps } from "./merge.js";
import { jobFixture } from "./fixtures.js";

describe("fillGaps", () => {
  it("fills only empty fields, never overwriting the master", () => {
    const master = jobFixture({ workMode: "unknown", publishedAt: null });
    const incoming = jobFixture({
      workMode: "remote",
      publishedAt: "2026-07-01T00:00:00.000Z",
      titleRaw: "OTHER TITLE THAT MUST NOT WIN"
    });
    const { merged, filledFields } = fillGaps(master, incoming);
    expect(merged.workMode).toBe("remote");
    expect(merged.publishedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(merged.titleRaw).toBe(master.titleRaw);
    expect(filledFields.sort()).toEqual(["publishedAt", "workMode"]);
  });

  it("keeps master values when both have data", () => {
    const master = jobFixture({ workMode: "hybrid" });
    const incoming = jobFixture({ workMode: "remote" });
    const { merged, filledFields } = fillGaps(master, incoming);
    expect(merged.workMode).toBe("hybrid");
    expect(filledFields).toEqual([]);
  });

  it("fills unknown compensation with explicit compensation", () => {
    const master = jobFixture();
    const incoming = jobFixture({
      compensation: { min: 100, max: 200, currency: "USD", period: "year", source: "explicit" }
    });
    const { merged } = fillGaps(master, incoming);
    expect(merged.compensation.source).toBe("explicit");
  });

  it("is idempotent: applying the same incoming twice changes nothing more", () => {
    const master = jobFixture({ workMode: "unknown" });
    const incoming = jobFixture({ workMode: "remote", sourceId: "lever:acme-example" });
    const first = fillGaps(master, incoming);
    const second = fillGaps(first.merged, incoming);
    expect(second.filledFields).toEqual([]);
    expect(second.evidenceAdded).toBe(0);
    expect(second.merged).toEqual(first.merged);
  });
});

describe("evidenceUnion", () => {
  it("unions by field+quote+sourceUrl without duplicates", () => {
    const base = jobFixture().evidence;
    const extra = [
      ...base,
      { field: "locations", quote: "Bogota", sourceUrl: "https://jobs.lever.co/acme/1" }
    ];
    const result = evidenceUnion(base, extra);
    expect(result).toHaveLength(2);
    expect(evidenceUnion(result, extra)).toHaveLength(2);
  });
});
