import { describe, expect, it } from "vitest";
import { CanonicalJobSchema } from "@job-radar/domain";
import { buildCanonicalJob, normalizeEmploymentType } from "./boards.js";

const NOW = "2026-07-19T12:00:00.000Z";

describe("buildCanonicalJob", () => {
  it("produces a schema-valid job and marks these boards remote", () => {
    const job = buildCanonicalJob({
      source: "RemoteOK",
      externalId: "12345",
      url: "https://remoteok.com/remote-jobs/qa-engineer-12345",
      title: "Senior QA Engineer",
      company: "Acme",
      descriptionText: "We need a QA engineer with automation experience.",
      tags: ["qa", "testing"],
      location: "Worldwide",
      publishedAt: "2026-07-18T10:00:00.000Z",
      expiresAt: null,
      compMin: null,
      compMax: null,
      compCurrency: null,
      employmentType: null,
      extractionMethod: "api",
      now: NOW
    });
    expect(() => CanonicalJobSchema.parse(job)).not.toThrow();
    expect(job.workMode).toBe("remote");
    expect(job.sourceId).toBe("RemoteOK");
    expect(job.requiredSkills).toContain("qa");
  });

  it("is deterministic: same source+id ⇒ same UUID (idempotency key)", () => {
    const base = {
      source: "Remotive",
      externalId: "abc",
      url: "https://remotive.com/x",
      title: "AI Engineer",
      company: "X",
      descriptionText: "d",
      tags: [],
      location: null,
      publishedAt: null,
      expiresAt: null,
      compMin: null,
      compMax: null,
      compCurrency: null,
      employmentType: null,
      extractionMethod: "api" as const,
      now: NOW
    };
    expect(buildCanonicalJob(base).id).toBe(
      buildCanonicalJob({ ...base, now: "2027-01-01T00:00:00.000Z" }).id
    );
    expect(buildCanonicalJob(base).id).not.toBe(
      buildCanonicalJob({ ...base, externalId: "def" }).id
    );
  });

  it("never invents compensation the source did not state", () => {
    const job = buildCanonicalJob({
      source: "We Work Remotely",
      externalId: "https://weworkremotely.com/remote-jobs/x",
      url: "https://weworkremotely.com/remote-jobs/x",
      title: "QA",
      company: "Y",
      descriptionText: "Base salary: $80k",
      tags: [],
      location: null,
      publishedAt: null,
      expiresAt: null,
      compMin: null,
      compMax: null,
      compCurrency: null,
      employmentType: null,
      extractionMethod: "api",
      now: NOW
    });
    expect(job.compensation.min).toBeNull();
    expect(job.compensation.max).toBeNull();
    expect(job.compensation.source).toBe("unknown");
  });

  it("maps the source-stated employment type into the job (freelance signal)", () => {
    const job = buildCanonicalJob({
      source: "Remotive",
      externalId: "abc",
      url: "https://remotive.com/x",
      title: "Senior Independent AI Engineer",
      company: "A.Team",
      descriptionText: "d",
      tags: [],
      location: null,
      publishedAt: null,
      expiresAt: null,
      compMin: null,
      compMax: null,
      compCurrency: null,
      employmentType: "contract",
      extractionMethod: "api",
      now: NOW
    });
    expect(job.employmentTypes).toEqual(["contract"]);
  });
});

describe("normalizeEmploymentType", () => {
  it("normalizes known variants to a stable vocabulary", () => {
    expect(normalizeEmploymentType("Full-Time")).toEqual(["full_time"]);
    expect(normalizeEmploymentType("contract")).toEqual(["contract"]);
    expect(normalizeEmploymentType("Contractor")).toEqual(["contract"]);
    expect(normalizeEmploymentType("Freelance")).toEqual(["freelance"]);
  });

  it("returns [] for null or unrecognized input instead of inventing a fact", () => {
    expect(normalizeEmploymentType(null)).toEqual([]);
    expect(normalizeEmploymentType("")).toEqual([]);
    expect(normalizeEmploymentType("gig-of-the-week")).toEqual([]);
  });
});
