import { createHash } from "node:crypto";
import type { CanonicalJob } from "@job-radar/domain";

/** Bump when normalization/dedupe semantics change (stored per run). */
export const DEDUPE_VERSION = "1";

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Legal suffixes removed only for comparison, never for display (§11.2). */
const LEGAL_SUFFIXES =
  /\b(inc|inc\.|llc|ltd|ltd\.|gmbh|s\.a\.s|sas|s\.a|sa|corp|corp\.|co|co\.|plc|bv|ab|oy|srl|s\.r\.l)\.?$/i;

export function normalizeCompanyName(name: string): string {
  let normalized = normalizeText(name).replace(/[.,]+$/, "");
  const withoutSuffix = normalized.replace(LEGAL_SUFFIXES, "").trim();
  if (withoutSuffix.length > 0) {
    normalized = withoutSuffix;
  }
  return normalized;
}

export function normalizedLocations(job: CanonicalJob): string[] {
  return job.locations
    .map((location) => normalizeText(location.raw))
    .filter((raw) => raw.length > 0)
    .sort();
}

/** Layer-4 exact key: company | title | sorted locations | description. */
export function dedupeKey(job: CanonicalJob): string {
  const material = [
    normalizeCompanyName(job.companyNameRaw),
    normalizeText(job.titleRaw),
    normalizedLocations(job).join(";"),
    normalizeText(job.descriptionText)
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/** Volatile/provenance fields excluded from content-change detection. */
export function canonicalContentHash(job: CanonicalJob): string {
  const material = {
    titleRaw: job.titleRaw,
    seniority: job.seniority,
    companyNameNormalized: normalizeCompanyName(job.companyNameRaw),
    descriptionText: job.descriptionText,
    responsibilities: job.responsibilities,
    requiredSkills: job.requiredSkills,
    preferredSkills: job.preferredSkills,
    requiredExperienceYears: job.requiredExperienceYears,
    educationRequirements: job.educationRequirements,
    languageRequirements: job.languageRequirements,
    locations: job.locations,
    workMode: job.workMode,
    remoteRegion: job.remoteRegion,
    employmentTypes: job.employmentTypes,
    compensation: job.compensation,
    visaSponsorship: job.visaSponsorship,
    publishedAt: job.publishedAt,
    expiresAt: job.expiresAt
  };
  return createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex");
}
