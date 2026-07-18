import { z } from "zod";

/**
 * Tolerant schemas for the SmartRecruiters Posting API
 * (docs/source-catalog/smartrecruiters.md). The official spec marks every
 * property optional — treat everything as potentially absent.
 */

const IdLabelSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  label: z.string().optional()
});

const SrLocationSchema = z.object({
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  remote: z.boolean().optional(),
  hybrid: z.boolean().optional(),
  fullLocation: z.string().optional()
});

export const SrListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  releasedDate: z.string().optional(),
  location: SrLocationSchema.optional(),
  company: z.object({ identifier: z.string().optional(), name: z.string().optional() }).optional(),
  experienceLevel: IdLabelSchema.optional(),
  typeOfEmployment: IdLabelSchema.optional()
});

export const SrListSchema = z.object({
  offset: z.number(),
  limit: z.number(),
  totalFound: z.number(),
  content: z.array(SrListItemSchema)
});

const SrJobAdSectionSchema = z.object({
  title: z.string().optional(),
  text: z.string().optional()
});

const SrJobAdSchema = z.object({
  sections: z
    .object({
      companyDescription: SrJobAdSectionSchema.optional(),
      jobDescription: SrJobAdSectionSchema.optional(),
      qualifications: SrJobAdSectionSchema.optional(),
      additionalInformation: SrJobAdSectionSchema.optional()
    })
    .optional()
});

const SrCompensationSchema = z.object({
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  period: z.string().nullable().optional()
});

export const SrPostingSchema = z.object({
  id: z.string(),
  name: z.string(),
  releasedDate: z.string().optional(),
  location: SrLocationSchema.optional(),
  company: z.object({ identifier: z.string().optional(), name: z.string().optional() }).optional(),
  experienceLevel: IdLabelSchema.optional(),
  typeOfEmployment: IdLabelSchema.optional(),
  postingUrl: z.string().url().optional(),
  applyUrl: z.string().url().optional(),
  active: z.boolean().optional(),
  jobAd: SrJobAdSchema.optional(),
  compensation: SrCompensationSchema.optional()
});

export type SrPosting = z.infer<typeof SrPostingSchema>;
