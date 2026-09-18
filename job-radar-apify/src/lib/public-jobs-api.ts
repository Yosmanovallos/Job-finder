import { COUNTRIES, SOURCES_BY_COUNTRY } from "../countries/index.js";
import type { JobFilterParams } from "./job-filters.js";
import { buildJobUrl, isPubliclyDescribable, isUuid } from "./job-seo.js";

export interface PublicJobsQuery {
  filters: JobFilterParams;
  limit: number;
  offset: number;
}

export interface PublicJob {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  source: string;
  sources: string[];
  publishedAt: string;
  country: string | null;
  description: string | null;
  requirements: string[];
  technologies: string[];
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryRaw: string | null;
  applicantCount: number | null;
  canonicalUrl: string;
  applicationUrl: string | null;
}

export type QueryValidationResult =
  | { ok: true; value: PublicJobsQuery }
  | { ok: false; parameter: string; reason: string };

const allowedParameters = new Set(["search", "country", "modality", "freshness", "sources", "cities", "roles", "limit", "offset"]);
const arrayParameters = ["sources", "cities", "roles"] as const;

function scalar(params: URLSearchParams, name: string): string | undefined | null {
  const values = params.getAll(name);
  if (values.length > 1) return null;
  return values[0]?.trim() || undefined;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function parsePublicJobsQuery(params: URLSearchParams): QueryValidationResult {
  for (const name of params.keys()) {
    if (!allowedParameters.has(name)) return { ok: false, parameter: name, reason: "Parámetro no reconocido." };
  }

  const search = scalar(params, "search");
  const country = scalar(params, "country");
  const modality = scalar(params, "modality");
  const freshness = scalar(params, "freshness");
  const rawLimit = scalar(params, "limit");
  const rawOffset = scalar(params, "offset");
  for (const [name, value] of [["search", search], ["country", country], ["modality", modality], ["freshness", freshness], ["limit", rawLimit], ["offset", rawOffset]] as const) {
    if (value === null) return { ok: false, parameter: name, reason: "El parámetro no puede repetirse." };
  }
  if (search && search.length > 120) return { ok: false, parameter: "search", reason: "Máximo 120 caracteres." };
  if (country && !["CO", "VE"].includes(country.toUpperCase())) return { ok: false, parameter: "country", reason: "Usa CO o VE." };
  if (modality && !["remoto", "hibrido", "presencial"].includes(modality.toLowerCase())) return { ok: false, parameter: "modality", reason: "Usa remoto, hibrido o presencial." };
  if (freshness && !["24h", "48h", "7d"].includes(freshness.toLowerCase())) return { ok: false, parameter: "freshness", reason: "Usa 24h, 48h o 7d." };

  const arrays: Record<(typeof arrayParameters)[number], string[]> = { sources: [], cities: [], roles: [] };
  for (const name of arrayParameters) {
    const values = params.getAll(name).map((value) => value.trim());
    if (values.length > 10) return { ok: false, parameter: name, reason: "Máximo 10 valores." };
    if (values.some((value) => value.length === 0 || value.length > 80)) return { ok: false, parameter: name, reason: "Cada valor debe tener entre 1 y 80 caracteres." };
    arrays[name] = values;
  }

  const limit = boundedInteger(rawLimit || undefined, 20, 1, 50);
  const offset = boundedInteger(rawOffset || undefined, 0, 0, 5000);
  if (limit === null) return { ok: false, parameter: "limit", reason: "Usa un entero entre 1 y 50." };
  if (offset === null) return { ok: false, parameter: "offset", reason: "Usa un entero entre 0 y 5000." };

  return {
    ok: true,
    value: {
      filters: {
        search: search || undefined,
        country: country?.toUpperCase(),
        modality: modality?.toLowerCase(),
        freshness: freshness?.toLowerCase(),
        sources: arrays.sources.length ? arrays.sources : undefined,
        cities: arrays.cities.length ? arrays.cities : undefined,
        roles: arrays.roles.length ? arrays.roles : undefined
      },
      limit,
      offset
    }
  };
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maximum) : null;
}

function boundedTextArray(value: unknown, maximumItems: number, maximumTextLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => boundedText(item, maximumTextLength))
    .filter((item): item is string => item !== null)
    .slice(0, maximumItems);
}

function publicHttpUrl(value: unknown): string | null {
  const text = boundedText(value, 2_000);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function toPublicJob(job: any): PublicJob | null {
  if (!isPubliclyDescribable(job)) return null;
  const id = boundedText(job.jobId, 36);
  const title = boundedText(job.title, 300);
  const company = boundedText(job.company, 300);
  const location = boundedText(job.location, 300);
  const source = boundedText(job.source, 100);
  const publishedAt = new Date(job.publishedAt);
  if (!id || !title || !company || !location || !source || !Number.isFinite(publishedAt.getTime())) return null;
  return {
    id,
    title,
    company,
    location,
    source,
    sources: boundedTextArray(job.sources, 25, 100),
    publishedAt: publishedAt.toISOString(),
    country: job.country === "CO" || job.country === "VE" ? job.country : null,
    description: boundedText(job.description, 8_000),
    requirements: boundedTextArray(job.requirements, 100, 500),
    technologies: boundedTextArray(job.technologies, 100, 100),
    employmentType: boundedText(job.employmentType, 100),
    salaryMin: numeric(job.salaryMin),
    salaryMax: numeric(job.salaryMax),
    salaryCurrency: boundedText(job.salaryCurrency, 12),
    salaryRaw: boundedText(job.salaryRaw, 160),
    applicantCount: numeric(job.applicantCount),
    canonicalUrl: buildJobUrl(job),
    applicationUrl: publicHttpUrl(job.url)
  };
}

export async function searchPublicJobs(query: PublicJobsQuery): Promise<{ jobs: PublicJob[]; pagination: { limit: number; offset: number; count: number; total: number; hasMore: boolean } }> {
  const { getJobsPage, maskLockedFields } = await import("../db/job-repository.js");
  const result = await getJobsPage({ filters: query.filters, limit: query.limit, offset: query.offset, includeDetails: true });
  const jobs = maskLockedFields(result.jobs, "free").map(toPublicJob).filter((job): job is PublicJob => job !== null);
  return {
    jobs,
    pagination: {
      limit: query.limit,
      offset: query.offset,
      count: jobs.length,
      total: result.total,
      hasMore: query.offset + result.jobs.length < result.total
    }
  };
}

export async function getPublicJob(jobId: string): Promise<PublicJob | null | "invalid"> {
  if (!isUuid(jobId)) return "invalid";
  const { getJobById, maskLockedFields } = await import("../db/job-repository.js");
  const job = await getJobById(jobId);
  if (!job) return null;
  const [visible] = maskLockedFields([job], "free");
  return toPublicJob(visible);
}

export function listSupportedCountries(): { countries: Array<{ code: string; name: string; cities: string[]; sources: string[] }> } {
  return {
    countries: ["CO", "VE"].map((code) => ({
      code,
      name: COUNTRIES[code]!.name,
      cities: [...COUNTRIES[code]!.cities, "Remoto"],
      sources: [...SOURCES_BY_COUNTRY[code]!]
    }))
  };
}
