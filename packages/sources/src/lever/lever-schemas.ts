import { z } from "zod";

/**
 * Tolerant schemas for the Lever Postings API (docs/source-catalog/lever.md).
 * Only the fields the adapter uses are validated; unknown keys are ignored.
 */

export const LeverListItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string().url()
});

export const LeverListSchema = z.array(LeverListItemSchema);

const LeverCategoriesSchema = z.object({
  commitment: z.string().optional(),
  department: z.string().optional(),
  location: z.string().optional(),
  team: z.string().optional(),
  allLocations: z.array(z.string()).optional()
});

const LeverListEntrySchema = z.object({
  text: z.string(),
  content: z.string()
});

const LeverSalaryRangeSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  currency: z.string().optional(),
  interval: z.string().optional()
});

export const LeverPostingSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string().url(),
  applyUrl: z.string().url().optional(),
  createdAt: z.number().optional(),
  workplaceType: z.string().optional(),
  country: z.string().optional(),
  categories: LeverCategoriesSchema.optional(),
  description: z.string().optional(),
  descriptionPlain: z.string().optional(),
  descriptionBodyPlain: z.string().optional(),
  additionalPlain: z.string().optional(),
  lists: z.array(LeverListEntrySchema).optional(),
  salaryRange: LeverSalaryRangeSchema.optional()
});

export type LeverPosting = z.infer<typeof LeverPostingSchema>;
