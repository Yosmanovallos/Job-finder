import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./normalize-url.js";

describe("normalizeUrl", () => {
  it("strips tracking params and keeps identifying ones", () => {
    expect(
      normalizeUrl(
        "https://Jobs.Example.com/acme/jobs/123?utm_source=x&utm_medium=y&gh_src=abc&gh_jid=123"
      )
    ).toBe("https://jobs.example.com/acme/jobs/123?gh_jid=123");
  });

  it("removes trailing slash and fragments", () => {
    expect(normalizeUrl("https://example.com/jobs/123/#apply")).toBe(
      "https://example.com/jobs/123"
    );
  });

  it("sorts remaining params for stability", () => {
    expect(normalizeUrl("https://example.com/j?b=2&a=1")).toBe("https://example.com/j?a=1&b=2");
    expect(normalizeUrl("https://example.com/j?a=1&b=2")).toBe(
      normalizeUrl("https://example.com/j?b=2&a=1")
    );
  });

  it("strips oga and lever-origin", () => {
    expect(normalizeUrl("https://jobs.smartrecruiters.com/x/1-y?oga=true")).toBe(
      "https://jobs.smartrecruiters.com/x/1-y"
    );
  });

  it("returns non-URLs trimmed instead of throwing", () => {
    expect(normalizeUrl(" not-a-url ")).toBe("not-a-url");
  });
});
