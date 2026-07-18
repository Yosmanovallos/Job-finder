import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DomainFileError, DomainValidationError } from "@job-radar/domain";
import { loadSourcesConfig, SourcesFileSchema } from "./sources-config.js";

const dir = mkdtempSync(join(tmpdir(), "sources-config-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("SourcesFileSchema", () => {
  it("accepts a greenhouse source with defaults", () => {
    const parsed = SourcesFileSchema.parse({
      sources: [{ id: "greenhouse:acme", adapter: "greenhouse", board_token: "acme" }]
    });
    expect(parsed.sources[0]).toMatchObject({
      enabled: true,
      rate_limit_per_minute: 30,
      concurrency: 1
    });
  });

  it("rejects duplicate source ids", () => {
    const result = SourcesFileSchema.safeParse({
      sources: [
        { id: "greenhouse:acme", adapter: "greenhouse", board_token: "acme" },
        { id: "greenhouse:acme", adapter: "greenhouse", board_token: "acme2" }
      ]
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown adapters and unknown keys", () => {
    expect(
      SourcesFileSchema.safeParse({
        sources: [{ id: "x", adapter: "linkedin-scraper", board_token: "x" }]
      }).success
    ).toBe(false);
    expect(
      SourcesFileSchema.safeParse({
        sources: [{ id: "x", adapter: "greenhouse", board_token: "x", browser: true }]
      }).success
    ).toBe(false);
  });
});

describe("loadSourcesConfig", () => {
  it("suggests copying the example when the config is missing", () => {
    const attempt = () => loadSourcesConfig(join(dir, "nope.yaml"));
    expect(attempt).toThrow(DomainFileError);
    expect(attempt).toThrow(/sources\.example\.yaml/);
  });

  it("loads a valid file and reports invalid ones with paths", () => {
    const good = join(dir, "sources.yaml");
    writeFileSync(
      good,
      "sources:\n  - id: greenhouse:acme\n    adapter: greenhouse\n    board_token: acme\n",
      "utf8"
    );
    expect(loadSourcesConfig(good).sources).toHaveLength(1);

    const bad = join(dir, "bad.yaml");
    writeFileSync(bad, "sources:\n  - id: greenhouse:acme\n    adapter: greenhouse\n", "utf8");
    expect(() => loadSourcesConfig(bad)).toThrow(DomainValidationError);
  });
});
