import { z } from "zod";

/**
 * Canonical job schema, verbatim from PLAN_RADAR_EMPLEO_LOCAL.md section 9.
 * Unknown-field policy (section 9.1): "unknown"/null are valid values —
 * never infer remote, sponsorship, salary or dates that the source did not
 * state. Any change to this contract requires an ADR.
 */
export const CanonicalJobSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string(),
  sourceJobId: z.string().nullable(),
  sourceUrl: z.string().url(),
  canonicalUrl: z.string().url(),
  applyUrl: z.string().url().nullable(),

  titleRaw: z.string(),
  titleNormalized: z.string(),
  titleFamily: z.string().nullable(),
  seniority: z.enum([
    "intern",
    "entry",
    "junior",
    "mid",
    "senior",
    "lead",
    "manager",
    "director",
    "executive",
    "unknown"
  ]),

  companyNameRaw: z.string(),
  companyId: z.string().uuid().nullable(),
  companyNameNormalized: z.string(),
  companyDomain: z.string().nullable(),

  descriptionText: z.string(),
  responsibilities: z.array(z.string()),
  requiredSkills: z.array(z.string()),
  preferredSkills: z.array(z.string()),
  requiredExperienceYears: z.number().nullable(),
  educationRequirements: z.array(z.string()),
  languageRequirements: z.array(z.string()),

  locations: z.array(
    z.object({
      raw: z.string(),
      city: z.string().nullable(),
      region: z.string().nullable(),
      countryCode: z.string().nullable()
    })
  ),
  workMode: z.enum(["remote", "hybrid", "onsite", "unknown"]),
  remoteRegion: z.string().nullable(),

  employmentTypes: z.array(z.string()),
  compensation: z.object({
    min: z.number().nullable(),
    max: z.number().nullable(),
    currency: z.string().nullable(),
    period: z.string().nullable(),
    source: z.enum(["explicit", "estimated", "unknown"])
  }),

  visaSponsorship: z.enum(["yes", "no", "unknown"]),
  publishedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  lastVerifiedAt: z.string().datetime().nullable(),
  status: z.enum(["active", "possibly_active", "closed", "unknown"]),

  extractionMethod: z.enum(["api", "jsonld", "html", "browser", "llm"]),
  extractionConfidence: z.number().min(0).max(1),
  contentHash: z.string(),
  evidence: z.array(
    z.object({
      field: z.string(),
      quote: z.string(),
      sourceUrl: z.string().url()
    })
  )
});

export type CanonicalJob = z.infer<typeof CanonicalJobSchema>;
