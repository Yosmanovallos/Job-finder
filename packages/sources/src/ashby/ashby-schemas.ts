import { z } from "zod";

/**
 * Tolerant schemas for the Ashby Public Job Postings API
 * (docs/source-catalog/ashby.md). Fields may be null OR missing entirely;
 * unknown keys are ignored.
 */

const PostalAddressSchema = z.object({
  addressLocality: z.string().optional(),
  addressRegion: z.string().optional(),
  addressCountry: z.string().optional()
});

const AshbyAddressSchema = z.object({
  postalAddress: PostalAddressSchema.optional()
});

const AshbySecondaryLocationSchema = z.object({
  location: z.string(),
  address: AshbyAddressSchema.optional()
});

const AshbyCompensationComponentSchema = z.object({
  compensationType: z.string(),
  interval: z.string().nullable().optional(),
  currencyCode: z.string().nullable().optional(),
  minValue: z.number().nullable().optional(),
  maxValue: z.number().nullable().optional()
});

const AshbyCompensationSchema = z.object({
  compensationTierSummary: z.string().nullable().optional(),
  summaryComponents: z.array(AshbyCompensationComponentSchema).optional()
});

export const AshbyJobSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  department: z.string().optional(),
  team: z.string().optional(),
  employmentType: z.string().optional(),
  location: z.string(),
  secondaryLocations: z.array(AshbySecondaryLocationSchema).optional(),
  isRemote: z.boolean().nullable().optional(),
  workplaceType: z.string().nullable().optional(),
  address: AshbyAddressSchema.optional(),
  descriptionPlain: z.string().optional(),
  publishedAt: z.string().optional(),
  jobUrl: z.string().url(),
  applyUrl: z.string().url().optional(),
  compensation: AshbyCompensationSchema.optional()
});

export const AshbyBoardSchema = z.object({
  jobs: z.array(AshbyJobSchema)
});

export type AshbyJob = z.infer<typeof AshbyJobSchema>;
