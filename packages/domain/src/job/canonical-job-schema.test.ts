import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CanonicalJobSchema, type CanonicalJob } from "./canonical-job-schema.js";

function validJob(): CanonicalJob {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    sourceId: "greenhouse",
    sourceJobId: "12345",
    sourceUrl: "https://boards.greenhouse.io/acme/jobs/12345",
    canonicalUrl: "https://boards.greenhouse.io/acme/jobs/12345",
    applyUrl: null,
    titleRaw: "Data Analyst (Remote)",
    titleNormalized: "data analyst",
    titleFamily: null,
    seniority: "unknown",
    companyNameRaw: "ACME Inc.",
    companyId: null,
    companyNameNormalized: "acme",
    companyDomain: null,
    descriptionText: "Analyze data.",
    responsibilities: [],
    requiredSkills: ["SQL"],
    preferredSkills: [],
    requiredExperienceYears: null,
    educationRequirements: [],
    languageRequirements: [],
    locations: [{ raw: "Bogotá, Colombia", city: "Bogota", region: null, countryCode: "CO" }],
    workMode: "unknown",
    remoteRegion: null,
    employmentTypes: [],
    compensation: { min: null, max: null, currency: null, period: null, source: "unknown" },
    visaSponsorship: "unknown",
    publishedAt: null,
    expiresAt: null,
    firstSeenAt: now,
    lastSeenAt: now,
    lastVerifiedAt: null,
    status: "active",
    extractionMethod: "api",
    extractionConfidence: 0.9,
    contentHash: "abc123",
    evidence: [
      {
        field: "requiredSkills",
        quote: "Strong SQL skills required",
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/12345"
      }
    ]
  };
}

describe("CanonicalJobSchema", () => {
  it("accepts a job where every unknowable field is unknown/null (section 9.1)", () => {
    expect(CanonicalJobSchema.parse(validJob())).toMatchObject({
      workMode: "unknown",
      visaSponsorship: "unknown",
      publishedAt: null
    });
  });

  it("rejects seniority values outside the plan's enum", () => {
    const job = { ...validJob(), seniority: "principal" };
    expect(CanonicalJobSchema.safeParse(job).success).toBe(false);
  });

  it("rejects extraction confidence outside [0, 1]", () => {
    const job = { ...validJob(), extractionConfidence: 1.5 };
    expect(CanonicalJobSchema.safeParse(job).success).toBe(false);
  });

  it("rejects non-ISO datetime strings", () => {
    const job = { ...validJob(), firstSeenAt: "yesterday" };
    expect(CanonicalJobSchema.safeParse(job).success).toBe(false);
  });
});
