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
import type { HttpResponse } from "../http/http-client.js";
import { SourceRequestError, SourceSchemaError } from "../errors.js";
import { contentHash } from "../util/content-hash.js";
import { decodeHtmlEntities, htmlToText } from "../util/html-to-text.js";
import {
  GreenhouseJobDetailSchema,
  GreenhouseListSchema,
  type GreenhouseJobDetail
} from "./greenhouse-schemas.js";

export interface GreenhouseAdapterOptions {
  /** Source instance id, e.g. "greenhouse:gitlab". */
  sourceId: string;
  boardToken: string;
  /** Fallback company name when the API omits company_name. */
  companyName?: string;
  rateLimitPerMinute?: number;
  concurrency?: number;
}

/** Injected so contract tests can run against fixtures without a network. */
export interface HttpGetter {
  get(url: string): Promise<HttpResponse>;
}

const API_BASE = "https://boards-api.greenhouse.io";

/**
 * Greenhouse Job Board API adapter (docs/source-catalog/greenhouse.md).
 * Public API, no auth, no pagination on /jobs. Fields the source does not
 * state are emitted as unknown/null/[] — never inferred (plan §9.1).
 */
export class GreenhouseAdapter implements SourceAdapter {
  readonly metadata: SourceMetadata;
  private readonly boardToken: string;
  private readonly companyName: string | null;
  private readonly http: HttpGetter;

  constructor(options: GreenhouseAdapterOptions, http: HttpGetter) {
    this.boardToken = options.boardToken;
    this.companyName = options.companyName ?? null;
    this.http = http;
    this.metadata = {
      id: options.sourceId,
      adapterName: "greenhouse",
      kind: "ats",
      tier: "A",
      baseUrl: API_BASE,
      companySlug: options.boardToken,
      rateLimitPerMinute: options.rateLimitPerMinute ?? 30,
      concurrency: options.concurrency ?? 1
    };
  }

  private listUrl(): string {
    return `${API_BASE}/v1/boards/${this.boardToken}/jobs`;
  }

  private detailUrl(externalId: string): string {
    return `${API_BASE}/v1/boards/${this.boardToken}/jobs/${externalId}?pay_transparency=true`;
  }

  /** Lists the board (single request — the API does not paginate /jobs). */
  async *discover(input: DiscoveryInput = {}): AsyncIterable<SourceReference> {
    const url = this.listUrl();
    const response = await this.http.get(url);
    if (response.status === 404) {
      throw new SourceRequestError(
        this.metadata.id,
        url,
        404,
        `Board "${this.boardToken}" not found — the token may be wrong or the company no longer uses Greenhouse`
      );
    }
    if (response.status !== 200) {
      throw new SourceRequestError(this.metadata.id, url, response.status, "Board listing failed");
    }
    const parsed = GreenhouseListSchema.safeParse(safeJson(response.body));
    if (!parsed.success) {
      throw new SourceSchemaError(this.metadata.id, url, "expected { jobs: [...] }");
    }
    const limit = input.limit ?? Number.POSITIVE_INFINITY;
    let yielded = 0;
    for (const job of parsed.data.jobs) {
      if (yielded >= limit) {
        break;
      }
      yielded += 1;
      yield {
        sourceId: this.metadata.id,
        externalId: String(job.id),
        url: this.detailUrl(String(job.id)),
        titleHint: job.title,
        discoveredAt: new Date().toISOString()
      };
    }
  }

  async fetch(reference: SourceReference): Promise<RawSourceDocument> {
    const response = await this.http.get(reference.url);
    if (response.status !== 200 && response.status !== 404) {
      throw new SourceRequestError(
        this.metadata.id,
        reference.url,
        response.status,
        "Job detail fetch failed"
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
    const parsed = GreenhouseJobDetailSchema.safeParse(safeJson(document.body));
    if (!parsed.success) {
      throw new SourceSchemaError(this.metadata.id, document.url, "expected a job detail object");
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
        detail: "Job no longer published on the board (404 is ambiguous if the whole board moved)"
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
    const url = this.listUrl();
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
          detail: `Board listing returned ${response.status}`
        };
      }
      const parsed = GreenhouseListSchema.safeParse(safeJson(response.body));
      if (!parsed.success) {
        return {
          sourceId: this.metadata.id,
          healthy: false,
          checkedAt,
          latencyMs,
          detail: "Board listing has an unexpected shape"
        };
      }
      return {
        sourceId: this.metadata.id,
        healthy: true,
        checkedAt,
        latencyMs,
        detail: `${parsed.data.jobs.length} jobs listed`
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

  private toCanonical(detail: GreenhouseJobDetail, document: RawSourceDocument): CanonicalJob {
    const companyNameRaw = detail.company_name ?? this.companyName ?? this.boardToken;
    const descriptionText =
      detail.content === undefined ? "" : htmlToText(decodeHtmlEntities(detail.content));
    return {
      id: randomUUID(),
      sourceId: this.metadata.id,
      sourceJobId: String(detail.id),
      sourceUrl: document.url,
      canonicalUrl: detail.absolute_url,
      applyUrl: detail.absolute_url,

      titleRaw: detail.title,
      titleNormalized: normalizeWhitespaceLower(detail.title),
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

      locations:
        detail.location == null
          ? []
          : [{ raw: detail.location.name, city: null, region: null, countryCode: null }],
      workMode: "unknown",
      remoteRegion: null,

      employmentTypes: [],
      compensation: mapCompensation(detail.pay_input_ranges),

      visaSponsorship: "unknown",
      publishedAt: toUtcIso(detail.first_published),
      expiresAt: toUtcIso(detail.application_deadline),
      firstSeenAt: document.fetchedAt,
      lastSeenAt: document.fetchedAt,
      lastVerifiedAt: null,
      status: "active",

      extractionMethod: "api",
      extractionConfidence: 0.95,
      contentHash: document.contentHash,
      evidence: buildEvidence(detail, descriptionText)
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

function toUtcIso(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Maps pay_input_ranges without inventing: a single currency yields the
 * explicit min/max across ranges; mixed currencies or no ranges stay unknown.
 */
function mapCompensation(
  ranges: { min_cents: number; max_cents: number; currency_type: string }[] | undefined
): CanonicalJob["compensation"] {
  if (ranges === undefined || ranges.length === 0) {
    return { min: null, max: null, currency: null, period: null, source: "unknown" };
  }
  const currencies = new Set(ranges.map((range) => range.currency_type));
  if (currencies.size > 1) {
    return { min: null, max: null, currency: null, period: null, source: "unknown" };
  }
  return {
    min: Math.min(...ranges.map((range) => range.min_cents)) / 100,
    max: Math.max(...ranges.map((range) => range.max_cents)) / 100,
    currency: ranges[0]!.currency_type,
    // The API does not document a pay period for ranges; never guess one.
    period: null,
    source: "explicit"
  };
}

function buildEvidence(detail: GreenhouseJobDetail, descriptionText: string): CanonicalJob["evidence"] {
  const evidence: CanonicalJob["evidence"] = [
    { field: "titleRaw", quote: detail.title, sourceUrl: detail.absolute_url }
  ];
  if (detail.location != null) {
    evidence.push({
      field: "locations",
      quote: detail.location.name,
      sourceUrl: detail.absolute_url
    });
  }
  if (descriptionText.length > 0) {
    evidence.push({
      field: "descriptionText",
      quote: descriptionText.slice(0, 200),
      sourceUrl: detail.absolute_url
    });
  }
  return evidence;
}
