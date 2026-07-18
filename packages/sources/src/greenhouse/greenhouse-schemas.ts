import { z } from "zod";

/**
 * Tolerant schemas for Greenhouse Job Board API payloads: they validate only
 * the fields the adapter uses and ignore unknown keys, because Greenhouse
 * adds fields without notice (see docs/source-catalog/greenhouse.md §10.6).
 */

export const GreenhouseListJobSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  absolute_url: z.string().url(),
  updated_at: z.string().optional()
});

export const GreenhouseListSchema = z.object({
  jobs: z.array(GreenhouseListJobSchema),
  meta: z.object({ total: z.number() }).optional()
});

export const GreenhousePayRangeSchema = z.object({
  min_cents: z.number(),
  max_cents: z.number(),
  currency_type: z.string()
});

export const GreenhouseJobDetailSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  absolute_url: z.string().url(),
  location: z.object({ name: z.string() }).nullable().optional(),
  company_name: z.string().optional(),
  first_published: z.string().nullable().optional(),
  application_deadline: z.string().nullable().optional(),
  content: z.string().optional(),
  pay_input_ranges: z.array(GreenhousePayRangeSchema).optional()
});

export type GreenhouseJobDetail = z.infer<typeof GreenhouseJobDetailSchema>;
