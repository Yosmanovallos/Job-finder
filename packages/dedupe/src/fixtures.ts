import { randomUUID } from "node:crypto";
import type { CanonicalJob } from "@job-radar/domain";

/** Builds a valid CanonicalJob for tests; override what the case needs. */
export function jobFixture(overrides: Partial<CanonicalJob> = {}): CanonicalJob {
  const now = "2026-07-18T00:00:00.000Z";
  return {
    id: randomUUID(),
    sourceId: "greenhouse:acme-example",
    sourceJobId: "1001",
    sourceUrl: "https://boards-api.greenhouse.io/v1/boards/acme-example/jobs/1001",
    canonicalUrl: "https://job-boards.greenhouse.io/acme-example/jobs/1001",
    applyUrl: null,
    titleRaw: "Data Analyst",
    titleNormalized: "data analyst",
    titleFamily: null,
    seniority: "unknown",
    companyNameRaw: "Acme Example Inc.",
    companyId: null,
    companyNameNormalized: "acme example",
    companyDomain: null,
    descriptionText:
      "We are looking for a data analyst to build SQL models, own our reporting " +
      "pipelines, partner with stakeholders across finance and operations, and ship " +
      "dashboards that people actually use every single week. You will work with " +
      "modern tooling, document your analyses carefully, and help the team make " +
      "better decisions with trustworthy numbers and clear communication.",
    responsibilities: [],
    requiredSkills: [],
    preferredSkills: [],
    requiredExperienceYears: null,
    educationRequirements: [],
    languageRequirements: [],
    locations: [{ raw: "Bogota, Colombia", city: null, region: null, countryCode: null }],
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
    extractionConfidence: 0.95,
    contentHash: "raw-body-hash",
    evidence: [
      {
        field: "titleRaw",
        quote: "Data Analyst",
        sourceUrl: "https://job-boards.greenhouse.io/acme-example/jobs/1001"
      }
    ],
    ...overrides
  };
}
