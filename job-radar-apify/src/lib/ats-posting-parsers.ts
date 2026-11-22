import { z } from "zod";
import { htmlToText, isoDate, text } from "./ats-text.js";

/**
 * Parsers of the public ATS APIs (ADR 0006 §5), moved here from
 * src/direct/connectors.ts unchanged so the Resume Studio link resolver can
 * read ONE linked posting with the same rules while the web server keeps
 * never importing src/direct/ (ADR 0006 §9). Schemas validate only the
 * fields we read; a field the ATS doesn't state stays null.
 */

export type Workplace = "onsite" | "hybrid" | "remote";

/** One posting as the ATS states it, before the Colombia filter. */
export interface RawAtsPosting {
  externalId: string;
  title: string;
  applyUrl: string;
  /** Every location string the ATS lists for the posting. */
  locationTexts: string[];
  /** ISO-3166 alpha-2 codes the ATS states in a structured field (upper case); [] when it has none. */
  countryCodes: string[];
  /** Structured city when the ATS has one. */
  structuredCity: string | null;
  /** Workplace only when the ATS states it in a field. */
  workplace: Workplace | null;
  descriptionText: string | null;
  department: string | null;
  employmentType: string | null;
  /** Posting date as stated by the ATS; null when it states none. */
  publishedAt: string | null;
  validThrough: string | null;
  /** Employer name as the ATS writes it, when it has one. */
  companyName: string | null;
  /**
   * True when the posting comes from a listing that lacks the detail fields
   * (description, validThrough): storing it must keep what an earlier detail
   * read saved instead of blanking it.
   */
  partial?: boolean;
}

// ---------- Greenhouse: GET /v1/boards/{token}/jobs?content=true ----------

const GreenhouseBoard = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      absolute_url: z.string(),
      location: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
      offices: z.array(z.object({ name: z.string().nullable().optional() })).optional(),
      departments: z.array(z.object({ name: z.string().nullable().optional() })).optional(),
      first_published: z.string().nullable().optional(),
      application_deadline: z.string().nullable().optional(),
      content: z.string().nullable().optional(),
      company_name: z.string().nullable().optional()
    })
  )
});

export function greenhouse(body: unknown): RawAtsPosting[] | null {
  const parsed = GreenhouseBoard.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.jobs.map((job) => {
    const locationTexts = [job.location?.name, ...(job.offices ?? []).map((office) => office.name)]
      .map(text)
      .filter((value): value is string => value !== null);
    return {
      externalId: String(job.id),
      title: job.title.trim(),
      applyUrl: job.absolute_url,
      locationTexts,
      countryCodes: [],
      structuredCity: null,
      workplace: null,
      descriptionText: job.content ? htmlToText(job.content) || null : null,
      department: text(job.departments?.[0]?.name),
      employmentType: null,
      publishedAt: isoDate(job.first_published),
      validThrough: isoDate(job.application_deadline),
      companyName: text(job.company_name)
    };
  });
}

// ---------- Lever: GET /v0/postings/{site}?mode=json ----------

const LeverBoard = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.string(),
    country: z.string().nullable().optional(),
    workplaceType: z.string().nullable().optional(),
    createdAt: z.number().nullable().optional(),
    descriptionPlain: z.string().nullable().optional(),
    categories: z
      .object({
        location: z.string().nullable().optional(),
        allLocations: z.array(z.string()).nullable().optional(),
        commitment: z.string().nullable().optional(),
        department: z.string().nullable().optional(),
        team: z.string().nullable().optional()
      })
      .partial()
      .nullable()
      .optional()
  })
);

const LEVER_WORKPLACE: Record<string, Workplace> = { remote: "remote", hybrid: "hybrid", "on-site": "onsite", onsite: "onsite" };

export function lever(body: unknown): RawAtsPosting[] | null {
  const parsed = LeverBoard.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.map((posting) => {
    const categories = posting.categories ?? {};
    const allLocations = categories.allLocations?.length ? categories.allLocations : [categories.location ?? ""];
    const locationTexts = allLocations.map(text).filter((value): value is string => value !== null);
    // `country` describes only the primary location; with several locations
    // it would wrongly veto a secondary Colombian one, so it's used alone.
    const countryCodes = locationTexts.length <= 1 && text(posting.country) ? [posting.country!.toUpperCase()] : [];
    return {
      externalId: posting.id,
      title: posting.text.trim(),
      applyUrl: posting.hostedUrl,
      locationTexts,
      countryCodes,
      structuredCity: null,
      workplace: LEVER_WORKPLACE[(posting.workplaceType ?? "").toLowerCase()] ?? null,
      descriptionText: text(posting.descriptionPlain),
      department: text(categories.department) ?? text(categories.team),
      employmentType: text(categories.commitment),
      publishedAt: isoDate(posting.createdAt),
      validThrough: null,
      companyName: null
    };
  });
}

// ---------- Ashby: GET /posting-api/job-board/{name} ----------

const AshbyAddress = z
  .object({
    postalAddress: z
      .object({
        addressCountry: z.string().nullable().optional(),
        addressLocality: z.string().nullable().optional()
      })
      .partial()
      .nullable()
      .optional()
  })
  .partial()
  .nullable()
  .optional();

const AshbyBoard = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      jobUrl: z.string(),
      location: z.string().nullable().optional(),
      secondaryLocations: z
        .array(z.object({ location: z.string().nullable().optional(), address: AshbyAddress }).partial())
        .nullable()
        .optional(),
      address: AshbyAddress,
      isListed: z.boolean().nullable().optional(),
      isRemote: z.boolean().nullable().optional(),
      workplaceType: z.string().nullable().optional(),
      publishedAt: z.string().nullable().optional(),
      descriptionPlain: z.string().nullable().optional(),
      employmentType: z.string().nullable().optional(),
      department: z.string().nullable().optional()
    })
  )
});

const ASHBY_WORKPLACE: Record<string, Workplace> = { remote: "remote", hybrid: "hybrid", onsite: "onsite" };

/** Ashby writes the country as a name ("Colombia"); only Colombia matters here. */
function ashbyCountryCode(country: string | null | undefined): string | null {
  const value = text(country);
  if (!value) return null;
  const folded = value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return folded === "colombia" || folded === "co" ? "CO" : value.toUpperCase();
}

export function ashby(body: unknown): RawAtsPosting[] | null {
  const parsed = AshbyBoard.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.jobs
    .filter((job) => job.isListed !== false)
    .map((job) => {
      const secondary = job.secondaryLocations ?? [];
      const locationTexts = [job.location, ...secondary.map((entry) => entry.location)]
        .map(text)
        .filter((value): value is string => value !== null);
      const countries = [job.address, ...secondary.map((entry) => entry.address)]
        .map((address) => ashbyCountryCode(address?.postalAddress?.addressCountry))
        .filter((value): value is string => value !== null);
      const primaryIsColombia = ashbyCountryCode(job.address?.postalAddress?.addressCountry) === "CO";
      return {
        externalId: job.id,
        title: job.title.trim(),
        applyUrl: job.jobUrl,
        locationTexts,
        // A board that leaves some addresses empty can't veto by country.
        countryCodes: countries.length === 1 + secondary.length ? [...new Set(countries)] : [],
        structuredCity: primaryIsColombia ? text(job.address?.postalAddress?.addressLocality) : null,
        workplace:
          ASHBY_WORKPLACE[(job.workplaceType ?? "").toLowerCase().replace(/[^a-z]/g, "")] ??
          (job.isRemote === true ? "remote" : null),
        descriptionText: text(job.descriptionPlain),
        department: text(job.department),
        employmentType: text(job.employmentType),
        publishedAt: isoDate(job.publishedAt),
        validThrough: null,
        companyName: null
      };
    });
}

// ---------- SmartRecruiters: GET /v1/companies/{id}/postings?country=co ----------
// Disabled by default per docs/adr/0002 (robots.txt vs documented public API).

export const SmartRecruitersPage = z.object({
  totalFound: z.number(),
  content: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      releasedDate: z.string().nullable().optional(),
      company: z.object({ name: z.string().nullable().optional() }).partial().nullable().optional(),
      location: z
        .object({
          city: z.string().nullable().optional(),
          country: z.string().nullable().optional(),
          fullLocation: z.string().nullable().optional(),
          remote: z.boolean().nullable().optional(),
          hybrid: z.boolean().nullable().optional()
        })
        .partial()
        .nullable()
        .optional(),
      department: z.object({ label: z.string().nullable().optional() }).partial().nullable().optional(),
      typeOfEmployment: z.object({ label: z.string().nullable().optional() }).partial().nullable().optional()
    })
  )
});

export function smartRecruitersPosting(
  identifier: string,
  posting: z.infer<typeof SmartRecruitersPage>["content"][number]
): RawAtsPosting {
  const location = posting.location ?? {};
  const workplace: Workplace | null =
    location.remote === true ? "remote" : location.hybrid === true ? "hybrid" : location.remote === false && location.hybrid === false ? "onsite" : null;
  return {
    externalId: posting.id,
    title: posting.name.trim(),
    applyUrl: `https://jobs.smartrecruiters.com/${identifier}/${posting.id}`,
    locationTexts: [text(location.fullLocation) ?? text(location.city)].filter((value): value is string => value !== null),
    countryCodes: text(location.country) ? [location.country!.toUpperCase()] : [],
    structuredCity: text(location.city),
    workplace,
    // The listing has no body; the detail call is left for a later phase.
    descriptionText: null,
    department: text(posting.department?.label),
    employmentType: text(posting.typeOfEmployment?.label),
    publishedAt: isoDate(posting.releasedDate),
    validThrough: null,
    companyName: text(posting.company?.name)
  };
}
