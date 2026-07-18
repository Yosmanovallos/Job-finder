import { describe, expect, it } from "vitest";
import { jobFixture } from "./fixtures.js";
import {
  canonicalContentHash,
  dedupeKey,
  normalizeCompanyName,
  normalizeText
} from "./keys.js";

describe("normalizeCompanyName", () => {
  it("lowercases and strips legal suffixes for comparison only", () => {
    expect(normalizeCompanyName("Acme Example Inc.")).toBe("acme example");
    expect(normalizeCompanyName("ACME  Example GmbH")).toBe("acme example");
    expect(normalizeCompanyName("Acme")).toBe("acme");
  });

  it("never normalizes a name into emptiness", () => {
    expect(normalizeCompanyName("Inc.")).toBe("inc");
  });
});

describe("dedupeKey (layer 4)", () => {
  it("matches the same vacancy seen from two sources", () => {
    const fromGreenhouse = jobFixture();
    const fromLever = jobFixture({
      id: "99999999-9999-4999-8999-999999999999",
      sourceId: "lever:acme-example",
      sourceJobId: "abc-uuid",
      sourceUrl: "https://api.lever.co/v0/postings/acme-example/abc-uuid",
      canonicalUrl: "https://jobs.lever.co/acme-example/abc-uuid",
      companyNameRaw: "ACME Example",
      titleRaw: "Data  Analyst"
    });
    expect(dedupeKey(fromGreenhouse)).toBe(dedupeKey(fromLever));
  });

  it("does not merge similar jobs from different companies", () => {
    const acme = jobFixture();
    const other = jobFixture({ companyNameRaw: "Globex Corp" });
    expect(dedupeKey(acme)).not.toBe(dedupeKey(other));
  });

  it("does not merge the same title in different locations", () => {
    const bogota = jobFixture();
    const medellin = jobFixture({
      locations: [{ raw: "Medellin, Colombia", city: null, region: null, countryCode: null }]
    });
    expect(dedupeKey(bogota)).not.toBe(dedupeKey(medellin));
  });
});

describe("canonicalContentHash", () => {
  it("ignores volatile provenance fields", () => {
    const a = jobFixture();
    const b = jobFixture({
      id: "99999999-9999-4999-8999-999999999999",
      sourceId: "lever:acme-example",
      sourceUrl: "https://api.lever.co/v0/postings/acme-example/abc",
      firstSeenAt: "2026-07-19T10:00:00.000Z",
      lastSeenAt: "2026-07-19T10:00:00.000Z",
      contentHash: "different-raw-hash",
      extractionConfidence: 0.5,
      evidence: []
    });
    expect(canonicalContentHash(a)).toBe(canonicalContentHash(b));
  });

  it("changes when the description changes", () => {
    const original = jobFixture();
    const updated = jobFixture({
      descriptionText: original.descriptionText + " Now with Snowflake experience required."
    });
    expect(canonicalContentHash(original)).not.toBe(canonicalContentHash(updated));
  });

  it("normalizeText collapses whitespace deterministically", () => {
    expect(normalizeText("  Data\n Analyst \t II ")).toBe("data analyst ii");
  });
});
