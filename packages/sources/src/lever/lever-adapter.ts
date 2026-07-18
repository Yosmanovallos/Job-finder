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
import { htmlToText } from "../util/html-to-text.js";
import { LeverListSchema, LeverPostingSchema, type LeverPosting } from "./lever-schemas.js";

export interface LeverAdapterOptions {
  /** Source instance id, e.g. "lever:spotify". */
  sourceId: string;
  /** Company site slug, the {site} in jobs.lever.co/{site}. */
  site: string;
  companyName?: string;
  rateLimitPerMinute?: number;
  concurrency?: number;
}

const API_BASE = "https://api.lever.co";
const PAGE_SIZE = 100;

/**
 * Lever Postings API adapter (docs/source-catalog/lever.md). Public JSON API,
 * paginated with skip/limit. workplaceType is a structured source field, so
 * workMode mapping is not an inference. Missing fields stay unknown/null.
 */
export class LeverAdapter implements SourceAdapter {
  readonly metadata: SourceMetadata;
  private readonly site: string;
  private readonly companyName: string | null;
  private readonly http: HttpGetter;

  constructor(options: LeverAdapterOptions, http: HttpGetter) {
    this.site = options.site;
    this.companyName = options.companyName ?? null;
    this.http = http;
    this.metadata = {
      id: options.sourceId,
      adapterName: "lever",
      kind: "ats",
      tier: "A",
      baseUrl: API_BASE,
      companySlug: options.site,
      rateLimitPerMinute: options.rateLimitPerMinute ?? 30,
      concurrency: options.concurrency ?? 1
    };
  }

  private listUrl(skip: number, limit: number): string {
    return `${API_BASE}/v0/postings/${this.site}?mode=json&skip=${skip}&limit=${limit}`;
  }

  private detailUrl(externalId: string): string {
    return `${API_BASE}/v0/postings/${this.site}/${externalId}?mode=json`;
  }

  async *discover(input: DiscoveryInput = {}): AsyncIterable<SourceReference> {
    const limit = input.limit ?? Number.POSITIVE_INFINITY;
    let skip = 0;
    let yielded = 0;
    for (;;) {
      const pageSize = Math.min(PAGE_SIZE, Math.max(1, limit - yielded));
      const url = this.listUrl(skip, pageSize);
      const response = await this.http.get(url);
      if (response.status === 404) {
        throw new SourceRequestError(
          this.metadata.id,
          url,
          404,
          `Site "${this.site}" not found — the slug may be wrong or the company no longer uses Lever`
        );
      }
      if (response.status !== 200) {
        throw new SourceRequestError(this.metadata.id, url, response.status, "Postings list failed");
      }
      const parsed = LeverListSchema.safeParse(safeJson(response.body));
      if (!parsed.success) {
        throw new SourceSchemaError(this.metadata.id, url, "expected an array of postings");
      }
      for (const posting of parsed.data) {
        if (yielded >= limit) {
          return;
        }
        yielded += 1;
        yield {
          sourceId: this.metadata.id,
          externalId: posting.id,
          url: this.detailUrl(posting.id),
          titleHint: posting.text,
          discoveredAt: new Date().toISOString()
        };
      }
      if (parsed.data.length < pageSize || yielded >= limit) {
        return;
      }
      skip += parsed.data.length;
    }
  }

  async fetch(reference: SourceReference): Promise<RawSourceDocument> {
    const response = await this.http.get(reference.url);
    if (response.status !== 200 && response.status !== 404) {
      throw new SourceRequestError(
        this.metadata.id,
        reference.url,
        response.status,
        "Posting detail fetch failed"
      );
    }
    return {
      sourceId: this.metadata.id,
      externalId: reference.externalId,
      url: reference.url,
      fetchedAt: new Date().toISOString(),
      contentType: response.contentType,
      httpStatus: response.status,
      body: response.body,
      contentHash: contentHash(response.body)
    };
  }

  async extract(document: RawSourceDocument): Promise<ExtractedJob[]> {
    if (document.httpStatus === 404) {
      return [];
    }
    const parsed = LeverPostingSchema.safeParse(safeJson(document.body));
    if (!parsed.success) {
      throw new SourceSchemaError(this.metadata.id, document.url, "expected a posting object");
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
    const response = await this.http.get(job.sourceUrl);
    const checkedAt = new Date().toISOString();
    if (response.status === 200) {
      return { status: "active", checkedAt, httpStatus: 200, detail: null };
    }
    if (response.status === 404) {
      return {
        status: "closed",
        checkedAt,
        httpStatus: 404,
        detail: "Posting no longer published (404 is ambiguous if the whole site moved)"
      };
    }
    return {
      status: "unknown",
      checkedAt,
      httpStatus: response.status,
      detail: `Unexpected status ${response.status}`
    };
  }

  async healthcheck(): Promise<SourceHealth> {
    const url = this.listUrl(0, 1);
    const startedAt = Date.now();
    try {
      const response = await this.http.get(url);
      const latencyMs = Date.now() - startedAt;
      const checkedAt = new Date().toISOString();
      if (response.status !== 200) {
        return {
          sourceId: this.metadata.id,
          healthy: false,
          checkedAt,
          latencyMs,
          detail: `Postings list returned ${response.status}`
        };
      }
      const parsed = LeverListSchema.safeParse(safeJson(response.body));
      if (!parsed.success) {
        return {
          sourceId: this.metadata.id,
          healthy: false,
          checkedAt,
          latencyMs,
          detail: "Postings list has an unexpected shape"
        };
      }
      return {
        sourceId: this.metadata.id,
        healthy: true,
        checkedAt,
        latencyMs,
        detail:
          parsed.data.length === 0
            ? "Site responds but lists 0 postings (empty board, not an error)"
            : "Postings list responds"
      };
    } catch (error) {
      return {
        sourceId: this.metadata.id,
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: null,
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private toCanonical(posting: LeverPosting, document: RawSourceDocument): CanonicalJob {
    const companyNameRaw = this.companyName ?? this.site;
    const descriptionText = buildDescription(posting);
    const locations = buildLocations(posting);
    return {
      id: randomUUID(),
      sourceId: this.metadata.id,
      sourceJobId: posting.id,
      sourceUrl: document.url,
      canonicalUrl: posting.hostedUrl,
      applyUrl: posting.applyUrl ?? posting.hostedUrl,

      titleRaw: posting.text,
      titleNormalized: normalizeWhitespaceLower(posting.text),
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

      locations,
      workMode: mapWorkMode(posting.workplaceType),
      remoteRegion: null,

      employmentTypes: posting.categories?.commitment ? [posting.categories.commitment] : [],
      compensation: mapCompensation(posting.salaryRange),

      visaSponsorship: "unknown",
      publishedAt: posting.createdAt === undefined ? null : new Date(posting.createdAt).toISOString(),
      expiresAt: null,
      firstSeenAt: document.fetchedAt,
      lastSeenAt: document.fetchedAt,
      lastVerifiedAt: null,
      status: "active",

      extractionMethod: "api",
      extractionConfidence: 0.95,
      contentHash: document.contentHash,
      evidence: buildEvidence(posting, descriptionText)
    };
  }
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

/** workplaceType is a structured Lever field; anything else stays unknown. */
function mapWorkMode(workplaceType: string | undefined): CanonicalJob["workMode"] {
  switch (workplaceType) {
    case "remote":
      return "remote";
    case "hybrid":
      return "hybrid";
    case "onsite":
    case "on-site":
      return "onsite";
    default:
      return "unknown";
  }
}

function buildDescription(posting: LeverPosting): string {
  const parts: string[] = [];
  if (posting.descriptionPlain) {
    parts.push(posting.descriptionPlain);
  } else if (posting.description) {
    parts.push(htmlToText(posting.description));
  }
  if (posting.descriptionBodyPlain) {
    parts.push(posting.descriptionBodyPlain);
  }
  for (const section of posting.lists ?? []) {
    parts.push(section.text);
    parts.push(htmlToText(section.content));
  }
  if (posting.additionalPlain) {
    parts.push(posting.additionalPlain);
  }
  return parts.filter((part) => part.trim().length > 0).join("\n");
}

function buildLocations(posting: LeverPosting): CanonicalJob["locations"] {
  const raws =
    posting.categories?.allLocations && posting.categories.allLocations.length > 0
      ? posting.categories.allLocations
      : posting.categories?.location
        ? [posting.categories.location]
        : [];
  // country is a posting-level ISO-2 field; only attributable with one location.
  const countryCode =
    raws.length === 1 && posting.country && /^[A-Za-z]{2}$/.test(posting.country)
      ? posting.country.toUpperCase()
      : null;
  return raws.map((raw) => ({ raw, city: null, region: null, countryCode }));
}

function mapCompensation(
  range: LeverPosting["salaryRange"]
): CanonicalJob["compensation"] {
  if (range === undefined || range.min === undefined || range.max === undefined || !range.currency) {
    return { min: null, max: null, currency: null, period: null, source: "unknown" };
  }
  return {
    min: range.min,
    max: range.max,
    currency: range.currency,
    // Source-stated interval label passed through; never normalized by guess.
    period: range.interval ?? null,
    source: "explicit"
  };
}

function buildEvidence(posting: LeverPosting, descriptionText: string): CanonicalJob["evidence"] {
  const evidence: CanonicalJob["evidence"] = [
    { field: "titleRaw", quote: posting.text, sourceUrl: posting.hostedUrl }
  ];
  const location = posting.categories?.location ?? posting.categories?.allLocations?.[0];
  if (location) {
    evidence.push({ field: "locations", quote: location, sourceUrl: posting.hostedUrl });
  }
  if (posting.workplaceType) {
    evidence.push({ field: "workMode", quote: posting.workplaceType, sourceUrl: posting.hostedUrl });
  }
  if (descriptionText.length > 0) {
    evidence.push({
      field: "descriptionText",
      quote: descriptionText.slice(0, 200),
      sourceUrl: posting.hostedUrl
    });
  }
  return evidence;
}
