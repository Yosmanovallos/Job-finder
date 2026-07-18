import { randomUUID } from "node:crypto";
import { CanonicalJobSchema, type CanonicalJob } from "@job-radar/domain";
import type {
  DiscoveryInput,
  ExtractedJob,
  RawSourceDocument,
  SourceAdapter,
  SourceHealth,
  SourceMetadata,
  SourceReference,
  VerificationResult
} from "../types.js";
import type { HttpGetter } from "../http/http-client.js";
import { SourceRequestError, SourceSchemaError } from "../errors.js";
import { contentHash } from "../util/content-hash.js";
import { AshbyBoardSchema, AshbyJobSchema, type AshbyJob } from "./ashby-schemas.js";

export interface AshbyAdapterOptions {
  /** Source instance id, e.g. "ashby:linear". */
  sourceId: string;
  /** The {jobBoardName} in jobs.ashbyhq.com/{jobBoardName}. */
  jobBoardName: string;
  companyName?: string;
  rateLimitPerMinute?: number;
  concurrency?: number;
}

const API_BASE = "https://api.ashbyhq.com";
/** CDN caches responses for 60s; refetching sooner is pointless. */
const BOARD_CACHE_MS = 60_000;

/** Deterministic country-name → ISO 3166-1 alpha-2 table. No guessing. */
const COUNTRY_NAMES: Record<string, string> = {
  usa: "US",
  "united states": "US",
  "united states of america": "US",
  canada: "CA",
  "united kingdom": "GB",
  uk: "GB",
  colombia: "CO",
  mexico: "MX",
  méxico: "MX",
  spain: "ES",
  españa: "ES",
  germany: "DE",
  france: "FR",
  brazil: "BR",
  brasil: "BR",
  argentina: "AR",
  chile: "CL",
  peru: "PE",
  perú: "PE",
  india: "IN",
  australia: "AU",
  netherlands: "NL",
  ireland: "IE",
  singapore: "SG",
  japan: "JP"
};

interface BoardCache {
  fetchedAt: number;
  fetchedAtIso: string;
  httpStatus: number;
  jobs: Map<string, AshbyJob>;
}

/**
 * Ashby Public Job Postings API adapter (docs/source-catalog/ashby.md).
 * Single endpoint, no per-job detail and no pagination: the adapter fetches
 * the board once per run and serves fetch/verify from that snapshot, so a
 * 12 MB board is downloaded once, not once per job.
 */
export class AshbyAdapter implements SourceAdapter {
  readonly metadata: SourceMetadata;
  private readonly jobBoardName: string;
  private readonly companyName: string | null;
  private readonly http: HttpGetter;
  private cache: BoardCache | null = null;

  constructor(options: AshbyAdapterOptions, http: HttpGetter) {
    this.jobBoardName = options.jobBoardName;
    this.companyName = options.companyName ?? null;
    this.http = http;
    this.metadata = {
      id: options.sourceId,
      adapterName: "ashby",
      kind: "ats",
      tier: "A",
      baseUrl: API_BASE,
      companySlug: options.jobBoardName,
      rateLimitPerMinute: options.rateLimitPerMinute ?? 30,
      concurrency: options.concurrency ?? 1
    };
  }

  private boardUrl(): string {
    return `${API_BASE}/posting-api/job-board/${this.jobBoardName}?includeCompensation=true`;
  }

  private async loadBoard(): Promise<BoardCache> {
    if (this.cache && Date.now() - this.cache.fetchedAt < BOARD_CACHE_MS) {
      return this.cache;
    }
    const url = this.boardUrl();
    const response = await this.http.get(url);
    if (response.status === 404) {
      throw new SourceRequestError(
        this.metadata.id,
        url,
        404,
        `Job board "${this.jobBoardName}" not found — the name may be wrong or the company no longer uses Ashby`
      );
    }
    if (response.status !== 200) {
      throw new SourceRequestError(this.metadata.id, url, response.status, "Job board fetch failed");
    }
    const parsed = AshbyBoardSchema.safeParse(safeJson(response.body));
    if (!parsed.success) {
      throw new SourceSchemaError(this.metadata.id, url, "expected { jobs: [...] }");
    }
    const jobs = new Map<string, AshbyJob>();
    for (const job of parsed.data.jobs) {
      jobs.set(jobKey(job), job);
    }
    this.cache = {
      fetchedAt: Date.now(),
      fetchedAtIso: new Date().toISOString(),
      httpStatus: response.status,
      jobs
    };
    return this.cache;
  }

  async *discover(input: DiscoveryInput = {}): AsyncIterable<SourceReference> {
    const board = await this.loadBoard();
    const limit = input.limit ?? Number.POSITIVE_INFINITY;
    let yielded = 0;
    for (const [key, job] of board.jobs) {
      if (yielded >= limit) {
        break;
      }
      yielded += 1;
      yield {
        sourceId: this.metadata.id,
        externalId: key,
        url: this.boardUrl(),
        titleHint: job.title,
        discoveredAt: board.fetchedAtIso
      };
    }
  }

  /**
   * There is no per-job endpoint: the "raw document" is the job object from
   * the cached board snapshot, serialized verbatim.
   */
  async fetch(reference: SourceReference): Promise<RawSourceDocument> {
    const board = await this.loadBoard();
    const job = board.jobs.get(reference.externalId);
    const body = job === undefined ? "" : JSON.stringify(job);
    return {
      sourceId: this.metadata.id,
      externalId: reference.externalId,
      url: this.boardUrl(),
      fetchedAt: board.fetchedAtIso,
      contentType: "application/json",
      httpStatus: job === undefined ? 404 : 200,
      body,
      contentHash: contentHash(body)
    };
  }

  async extract(document: RawSourceDocument): Promise<ExtractedJob[]> {
    if (document.httpStatus === 404) {
      return [];
    }
    const parsed = AshbyJobSchema.safeParse(safeJson(document.body));
    if (!parsed.success) {
      throw new SourceSchemaError(this.metadata.id, document.url, "expected a job object");
    }
    const job = this.toCanonical(parsed.data, document);
    const validated = CanonicalJobSchema.safeParse(job);
    if (!validated.success) {
      throw new SourceSchemaError(
        this.metadata.id,
        document.url,
        `canonical mapping failed: ${validated.error.issues
          .map((issue) => issue.path.join("."))
          .join(", ")}`
      );
    }
    return [
      {
        job: validated.data,
        provenance: {
          sourceId: this.metadata.id,
          externalId: document.externalId,
          url: document.url,
          fetchedAt: document.fetchedAt,
          contentHash: document.contentHash,
          extractionMethod: "api"
        }
      }
    ];
  }

  async verify(job: CanonicalJob): Promise<VerificationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const board = await this.loadBoard();
      const present = job.sourceJobId !== null && board.jobs.has(job.sourceJobId);
      return present
        ? { status: "active", checkedAt, httpStatus: 200, detail: null }
        : {
            status: "closed",
            checkedAt,
            httpStatus: 200,
            detail: "Job no longer listed on the board"
          };
    } catch (error) {
      if (error instanceof SourceRequestError && error.status === 404) {
        return {
          status: "unknown",
          checkedAt,
          httpStatus: 404,
          detail: "Whole board is gone (404) — cannot distinguish closed job from moved board"
        };
      }
      throw error;
    }
  }

  async healthcheck(): Promise<SourceHealth> {
    const startedAt = Date.now();
    try {
      this.cache = null;
      const board = await this.loadBoard();
      return {
        sourceId: this.metadata.id,
        healthy: true,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        detail: `${board.jobs.size} jobs listed`
      };
    } catch (error) {
      return {
        sourceId: this.metadata.id,
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private toCanonical(job: AshbyJob, document: RawSourceDocument): CanonicalJob {
    const companyNameRaw = this.companyName ?? this.jobBoardName;
    const descriptionText = job.descriptionPlain ?? "";
    return {
      id: randomUUID(),
      sourceId: this.metadata.id,
      sourceJobId: jobKey(job),
      sourceUrl: document.url,
      canonicalUrl: job.jobUrl,
      applyUrl: job.applyUrl ?? job.jobUrl,

      titleRaw: job.title,
      titleNormalized: normalizeWhitespaceLower(job.title),
      titleFamily: null,
      seniority: "unknown",

      companyNameRaw,
      companyId: null,
      companyNameNormalized: normalizeWhitespaceLower(companyNameRaw),
      companyDomain: null,

      descriptionText,
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      requiredExperienceYears: null,
      educationRequirements: [],
      languageRequirements: [],

      locations: buildLocations(job),
      workMode: mapWorkMode(job),
      remoteRegion: null,

      employmentTypes: job.employmentType ? [job.employmentType] : [],
      compensation: mapCompensation(job),

      visaSponsorship: "unknown",
      publishedAt: toUtcIso(job.publishedAt),
      expiresAt: null,
      firstSeenAt: document.fetchedAt,
      lastSeenAt: document.fetchedAt,
      lastVerifiedAt: null,
      status: "active",

      extractionMethod: "api",
      extractionConfidence: 0.95,
      contentHash: document.contentHash,
      evidence: buildEvidence(job, descriptionText)
    };
  }
}

/** Stable per-job key: the observed id, else the UUID embedded in jobUrl. */
function jobKey(job: AshbyJob): string {
  if (job.id) {
    return job.id;
  }
  const segments = new URL(job.jobUrl).pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? job.jobUrl;
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function normalizeWhitespaceLower(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function toUtcIso(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** workplaceType/isRemote are structured fields; isRemote=false stays unknown. */
function mapWorkMode(job: AshbyJob): CanonicalJob["workMode"] {
  switch (job.workplaceType) {
    case "Remote":
      return "remote";
    case "Hybrid":
      return "hybrid";
    case "OnSite":
      return "onsite";
    default:
      return job.isRemote === true ? "remote" : "unknown";
  }
}

function countryCode(address: AshbyJob["address"]): string | null {
  const name = address?.postalAddress?.addressCountry;
  if (!name) {
    return null;
  }
  return COUNTRY_NAMES[name.toLowerCase().trim()] ?? null;
}

function buildLocations(job: AshbyJob): CanonicalJob["locations"] {
  const primary = {
    raw: job.location,
    city: job.address?.postalAddress?.addressLocality ?? null,
    region: job.address?.postalAddress?.addressRegion ?? null,
    countryCode: countryCode(job.address)
  };
  const secondaries = (job.secondaryLocations ?? []).map((entry) => ({
    raw: entry.location,
    city: entry.address?.postalAddress?.addressLocality ?? null,
    region: entry.address?.postalAddress?.addressRegion ?? null,
    countryCode: countryCode(entry.address)
  }));
  return [primary, ...secondaries];
}

/** Values are absolute amounts (not cents). Only the Salary component maps. */
function mapCompensation(job: AshbyJob): CanonicalJob["compensation"] {
  const salary = job.compensation?.summaryComponents?.find(
    (component) =>
      component.compensationType === "Salary" &&
      component.minValue != null &&
      component.maxValue != null &&
      component.currencyCode != null
  );
  if (!salary) {
    return { min: null, max: null, currency: null, period: null, source: "unknown" };
  }
  return {
    min: salary.minValue!,
    max: salary.maxValue!,
    currency: salary.currencyCode!,
    period: mapInterval(salary.interval ?? null),
    source: "explicit"
  };
}

function mapInterval(interval: string | null): string | null {
  switch (interval) {
    case "1 YEAR":
      return "year";
    case "1 MONTH":
      return "month";
    case "1 HOUR":
      return "hour";
    default:
      return interval;
  }
}

function buildEvidence(job: AshbyJob, descriptionText: string): CanonicalJob["evidence"] {
  const evidence: CanonicalJob["evidence"] = [
    { field: "titleRaw", quote: job.title, sourceUrl: job.jobUrl }
  ];
  evidence.push({ field: "locations", quote: job.location, sourceUrl: job.jobUrl });
  if (job.workplaceType) {
    evidence.push({ field: "workMode", quote: job.workplaceType, sourceUrl: job.jobUrl });
  }
  const tierSummary = job.compensation?.compensationTierSummary;
  if (tierSummary) {
    evidence.push({ field: "compensation", quote: tierSummary, sourceUrl: job.jobUrl });
  }
  if (descriptionText.length > 0) {
    evidence.push({
      field: "descriptionText",
      quote: descriptionText.slice(0, 200),
      sourceUrl: job.jobUrl
    });
  }
  return evidence;
}
