import { z } from "zod";

export const SenioritySchema = z.enum([
  "intern",
  "entry",
  "junior",
  "mid",
  "senior",
  "lead",
  "manager",
  "director",
  "executive"
]);

export const LanguageLevelSchema = z.enum(["native", "A1", "A2", "B1", "B2", "C1", "C2"]);

export const EmploymentTypeSchema = z.enum([
  "full_time",
  "part_time",
  "contract",
  "temporary",
  "internship",
  "unpaid"
]);

export const DiscoveryModeSchema = z.enum(["high_recall", "balanced", "high_precision"]);

const NonEmptyString = z.string().min(1, "Must not be empty");

const CountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "Must be an ISO 3166-1 alpha-2 code in uppercase, e.g. CO");

/** Email, phone and address must stay out of Git — only a display name here. */
const IdentitySchema = z
  .object({
    display_name: NonEmptyString.default("Candidato")
  })
  .strict();

const RolesSchema = z
  .object({
    target_titles: z.array(NonEmptyString).min(1, "List at least one target job title"),
    title_synonyms: z.array(NonEmptyString).default([]),
    adjacent_titles: z.array(NonEmptyString).default([]),
    excluded_titles: z.array(NonEmptyString).default([])
  })
  .strict();

const SenioritySectionSchema = z
  .object({
    preferred: z.array(SenioritySchema).default([]),
    accepted: z.array(SenioritySchema).default([]),
    years_experience_min: z.number().int().min(0).nullable().default(null),
    years_experience_max: z.number().int().min(0).nullable().default(null)
  })
  .strict();

const SkillsSchema = z
  .object({
    must_have: z.array(NonEmptyString).default([]),
    strong: z.array(NonEmptyString).default([]),
    nice_to_have: z.array(NonEmptyString).default([]),
    exclusions: z.array(NonEmptyString).default([])
  })
  .strict();

const ResponsibilitiesSchema = z
  .object({
    preferred: z.array(NonEmptyString).default([]),
    excluded: z.array(NonEmptyString).default([])
  })
  .strict();

const LocationsSchema = z
  .object({
    countries: z.array(CountryCodeSchema).default([]),
    cities: z.array(NonEmptyString).default([]),
    remote_worldwide: z.boolean().default(false),
    remote_latam: z.boolean().default(false),
    hybrid: z.boolean().default(false),
    onsite: z.boolean().default(false)
  })
  .strict();

const WorkAuthorizationSchema = z
  .object({
    countries_authorized: z.array(CountryCodeSchema).default([]),
    requires_sponsorship: z.boolean().default(false),
    accept_contracting: z.boolean().default(true)
  })
  .strict();

const CompensationSchema = z
  .object({
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "Must be an ISO 4217 currency code in uppercase, e.g. COP")
      .default("COP"),
    minimum_monthly: z.number().positive().nullable().default(null),
    minimum_annual_usd_remote: z.number().positive().nullable().default(null),
    reject_if_below_minimum: z.boolean().default(false)
  })
  .strict();

const EmploymentSchema = z
  .object({
    types: z.array(EmploymentTypeSchema).default(["full_time", "contract"]),
    reject_types: z.array(EmploymentTypeSchema).default(["unpaid"])
  })
  .strict();

const IndustriesSchema = z
  .object({
    preferred: z.array(NonEmptyString).default([]),
    excluded: z.array(NonEmptyString).default([])
  })
  .strict();

const CompaniesSchema = z
  .object({
    include: z.array(NonEmptyString).default([]),
    exclude: z.array(NonEmptyString).default([]),
    watchlist: z.array(NonEmptyString).default([])
  })
  .strict();

/** auto_apply is a literal false: automatic applications are prohibited. */
const ApplicationPolicySchema = z
  .object({
    auto_apply: z.literal(false, {
      errorMap: () => ({
        message:
          "auto_apply must be false — automatic applications are prohibited by project policy (AGENTS.md rule 7)"
      })
    }),
    generate_materials: z.boolean().default(true),
    require_human_approval: z.boolean().default(true),
    max_priority_jobs_per_day: z.number().int().positive().default(25)
  })
  .strict();

/**
 * Paths into private/**. They are opaque strings by design: the loader must
 * never read, resolve or check these paths on disk.
 */
const CvSchema = z
  .object({
    master_path: NonEmptyString.default("private/cv/master.md"),
    variants_directory: NonEmptyString.default("private/cv/variants"),
    facts_path: NonEmptyString.default("private/cv/facts.yaml")
  })
  .strict();

const SearchSchema = z
  .object({
    languages: z.array(NonEmptyString).default(["es", "en"]),
    max_age_days: z.number().int().positive().default(30),
    preferred_age_days: z.number().int().positive().default(7),
    include_unknown_date: z.boolean().default(true),
    discovery_mode: DiscoveryModeSchema.default("high_recall")
  })
  .strict();

export const ProfileSchema = z
  .object({
    profile_id: NonEmptyString.default("default"),
    locale: NonEmptyString.default("es-CO"),
    timezone: NonEmptyString.default("America/Bogota"),
    identity: IdentitySchema.default({}),
    roles: RolesSchema,
    seniority: SenioritySectionSchema.default({}),
    skills: SkillsSchema.default({}),
    responsibilities: ResponsibilitiesSchema.default({}),
    locations: LocationsSchema.default({}),
    work_authorization: WorkAuthorizationSchema.default({}),
    languages: z.record(NonEmptyString, LanguageLevelSchema).default({}),
    compensation: CompensationSchema.default({}),
    employment: EmploymentSchema.default({}),
    industries: IndustriesSchema.default({}),
    companies: CompaniesSchema.default({}),
    application_policy: ApplicationPolicySchema.default({ auto_apply: false }),
    cv: CvSchema.default({}),
    search: SearchSchema.default({})
  })
  .strict()
  .superRefine((profile, ctx) => {
    const { years_experience_min: min, years_experience_max: max } = profile.seniority;
    if (min !== null && max !== null && min > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["seniority", "years_experience_min"],
        message: "years_experience_min must be less than or equal to years_experience_max"
      });
    }
    if (profile.search.preferred_age_days > profile.search.max_age_days) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["search", "preferred_age_days"],
        message: "preferred_age_days must be less than or equal to max_age_days"
      });
    }
  });

export type Profile = z.infer<typeof ProfileSchema>;
