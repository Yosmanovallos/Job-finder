import { createHash } from "node:crypto";
import { z } from "zod";
import { CanonicalJobSchema, type CanonicalJob } from "@job-radar/domain";
import type { LabeledItem } from "./evaluate.js";

/**
 * Compact labeled-dataset format for offline evals. Items specify only what
 * matters for the case; the loader expands them into full CanonicalJobs
 * deterministically (ids derived from content, dates fixed) so runs are
 * reproducible.
 */
export const DatasetItemSchema = z
  .object({
    title: z.string(),
    company: z.string().default("Synthetic Corp"),
    description: z.string(),
    workMode: z.enum(["remote", "hybrid", "onsite", "unknown"]).default("unknown"),
    locations: z.array(z.string()).default([]),
    countryCode: z.string().nullable().default(null),
    employmentTypes: z.array(z.string()).default([]),
    languageRequirements: z.array(z.string()).default([]),
    status: z.enum(["active", "possibly_active", "closed", "unknown"]).default("active"),
    publishedDaysAgo: z.number().nullable().default(3),
    label: z.enum(["relevant", "not_relevant"]),
    expect_blocker: z.boolean().default(false)
  })
  .strict();

export const DatasetSchema = z
  .object({
    name: z.string(),
    reference_date: z.string(),
    items: z.array(DatasetItemSchema).min(1)
  })
  .strict();

export type Dataset = z.infer<typeof DatasetSchema>;

function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function expandDataset(dataset: Dataset): { items: LabeledItem[]; referenceDate: Date } {
  const referenceDate = new Date(dataset.reference_date);
  const items = dataset.items.map((item, index): LabeledItem => {
    const id = stableUuid(`${dataset.name}:${index}:${item.title}`);
    const url = `https://synthetic.example.test/jobs/${id}`;
    const publishedAt =
      item.publishedDaysAgo === null
        ? null
        : new Date(referenceDate.getTime() - item.publishedDaysAgo * 86_400_000).toISOString();
    const job: CanonicalJob = CanonicalJobSchema.parse({
      id,
      sourceId: "synthetic:dataset",
      sourceJobId: String(index),
      sourceUrl: url,
      canonicalUrl: url,
      applyUrl: null,
      titleRaw: item.title,
      titleNormalized: item.title.toLowerCase(),
      titleFamily: null,
      seniority: "unknown",
      companyNameRaw: item.company,
      companyId: null,
      companyNameNormalized: item.company.toLowerCase(),
      companyDomain: null,
      descriptionText: item.description,
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      requiredExperienceYears: null,
      educationRequirements: [],
      languageRequirements: item.languageRequirements,
      locations: item.locations.map((raw) => ({
        raw,
        city: null,
        region: null,
        countryCode: item.countryCode
      })),
      workMode: item.workMode,
      remoteRegion: null,
      employmentTypes: item.employmentTypes,
      compensation: { min: null, max: null, currency: null, period: null, source: "unknown" },
      visaSponsorship: "unknown",
      publishedAt,
      expiresAt: null,
      firstSeenAt: referenceDate.toISOString(),
      lastSeenAt: referenceDate.toISOString(),
      lastVerifiedAt: null,
      status: item.status,
      extractionMethod: "api",
      extractionConfidence: 0.95,
      contentHash: stableUuid(`hash:${id}`),
      evidence: [{ field: "titleRaw", quote: item.title, sourceUrl: url }]
    });
    return { job, label: item.label, expect_blocker: item.expect_blocker };
  });
  return { items, referenceDate };
}
