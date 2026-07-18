import { describe, expect, it } from "vitest";
import type { SourceConfig } from "@job-radar/sources";
import { selectSources } from "./source-commands.js";

const configs: SourceConfig[] = [
  {
    id: "greenhouse:gitlab",
    adapter: "greenhouse",
    enabled: true,
    board_token: "gitlab",
    rate_limit_per_minute: 30,
    concurrency: 1
  },
  {
    id: "greenhouse:cloudflare",
    adapter: "greenhouse",
    enabled: false,
    board_token: "cloudflare",
    rate_limit_per_minute: 30,
    concurrency: 1
  }
];

describe("selectSources", () => {
  it("matches every enabled source by adapter name", () => {
    expect(selectSources(configs, "greenhouse").map((c) => c.id)).toEqual(["greenhouse:gitlab"]);
  });

  it("matches a single source by full id", () => {
    expect(selectSources(configs, "greenhouse:gitlab")).toHaveLength(1);
  });

  it("never selects disabled sources, even by exact id", () => {
    expect(selectSources(configs, "greenhouse:cloudflare")).toEqual([]);
  });

  it("returns empty for unknown selectors", () => {
    expect(selectSources(configs, "lever")).toEqual([]);
  });
});
