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
import { SrListSchema, SrPostingSchema, type SrPosting } from "./smartrecruiters-schemas.js";

export interface SmartRecruitersAdapterOptions {
  /** Source instance id, e.g. "smartrecruiters:BoschGroup". */
  sourceId: string;
  companyIdentifier: string;
  companyName?: string;
  rateLimitPerMinute?: number;
  concurrency?: number;
}

const API_BASE = "https://api.smartrecruiters.com";
/** Documented hard maximum; larger values are silently clamped by the API. */
const PAGE_SIZE = 100;

/**
 * Deterministic mapping of the documented experienceLevel ids. Ambiguous ids
 * (associate, mid_senior_level, not_applicable) stay unknown — widening this
 * table requires an ADR (docs/source-catalog/smartrecruiters.md §7).
 */
const SENIORITY_BY_ID: Record<string, CanonicalJob["seniority"]> = {
  internship: "intern",
  entry_level: "entry",
  director: "director",
  executive: "executive"
};

/**
 * SmartRecruiters Posting API adapter (docs/source-catalog/smartrecruiters.md,
 * ADR-0002). Paginated list + per-posting detail. A nonexistent company
 * answers 200 with totalFound 0 — indistinguishable from "no openings".
 */
export class SmartRecruitersAdapter implements SourceAdapter {
  readonly metadata: SourceMetadata;
  private readonly companyIdentifier: string;
  private readonly companyName: string | null;
  private readonly http: HttpGetter;

  constructor(options: SmartRecruitersAdapterOptions, http: HttpGetter) {
    this.companyIdentifier = options.companyIdentifier;
    this.companyName = options.companyName ?? null;
    this.http = http;
    this.metadata = {
      id: options.sourceId,
      adapterName: "smartrecruiters",
      kind: "ats",
      tier: "A",
      baseUrl: API_BASE,
      companySlug: options.companyIdentifier,
      rateLimitPerMinute: options.rateLimitPerMinute ?? 30,
      concurrency: options.concurrency ?? 1
    };
  }

  private listUrl(offset: number, limit: number): string {
    return `${API_BASE}/v1/companies/${this.companyIdentifier}/postings?limit=${limit}&offset=${offset}`;
  }

  private detailUrl(externalId: string): string {
    return `${API_BASE}/v1/companies/${this.companyIdentifier}/postings/${externalId}`;
  }

  async *discover(input: DiscoveryInput = {}): AsyncIterable<SourceReference> {
    const limit = input.limit ?? Number.POSITIVE_INFINITY;
    let offset = 0;
    let yielded = 0;
    for (;;) {
      const url = this.listUrl(offset, Math.min(PAGE_SIZE, Math.max(1, limit - yielded)));
      const response = await this.http.get(url);
      if (response.status !== 200) {
        throw new SourceRequestError(this.metadata.id, url, response.status, "Postings list failed");
      }
      const parsed = SrListSchema.safeParse(safeJson(response.body));
      if (!parsed.success) {
        throw new SourceSchemaError(
          this.metadata.id,
          url,
          "expected { offset, limit, totalFound, content }"
        );
      }
      for (const item of parsed.data.content) {
        if (yielded >= limit) {
          return;
        }
        yielded += 1;
        yield {
          sourceId: this.metadata.id,
          externalId: item.id,
          url: this.detailUrl(item.id),
          titleHint: item.name,
          discoveredAt: new Date().toISOString()
        };
      }
      offset += parsed.data.content.length;
      if (
        yielded >= limit ||
        parsed.data.content.length === 0 ||
        offset >= parsed.data.totalFound
      ) {
        return;
      }
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
    const parsed = SrPostingSchema.safeParse(safeJson(document.body));
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
        detail: "Posting no longer published"
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
      const parsed = SrListSchema.safeParse(safeJson(response.body));
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
          parsed.data.totalFound === 0
            ? "totalFound is 0 — either no openings or a wrong companyIdentifier (the API cannot tell them apart)"
            : `${parsed.data.totalFound} postings reported`
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

  private toCanonical(posting: SrPosting, document: RawSourceDocument): CanonicalJob {
    const companyNameRaw = posting.company?.name ?? this.companyName ?? this.companyIdentifier;
    const canonicalUrl = posting.postingUrl ?? document.url;
    const descriptionText = buildDescription(posting);
    return {
      id: randomUUID(),
      sourceId: this.metadata.id,
      sourceJobId: posting.id,
      sourceUrl: document.url,
      canonicalUrl,
      applyUrl: posting.applyUrl ?? null,

      titleRaw: posting.name,
      titleNormalized: normalizeWhitespaceLower(posting.name),
      titleFamily: null,
      seniority: mapSeniority(posting.experienceLevel?.id),

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

      locations: buildLocations(posting),
      workMode: mapWorkMode(posting.location),
      remoteRegion: null,

      employmentTypes: posting.typeOfEmployment?.label ? [posting.typeOfEmployment.label] : [],
      compensation: mapCompensation(posting.compensation),

      visaSponsorship: "unknown",
      publishedAt: toUtcIso(posting.releasedDate),
      expiresAt: null,
      firstSeenAt: document.fetchedAt,
      lastSeenAt: document.fetchedAt,
      lastVerifiedAt: null,
      status: "active",

      extractionMethod: "api",
      extractionConfidence: 0.95,
      contentHash: document.contentHash,
      evidence: buildEvidence(posting, canonicalUrl, descriptionText)
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

function toUtcIso(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function mapSeniority(id: string | number | undefined): CanonicalJob["seniority"] {
  if (typeof id !== "string") {
    return "unknown";
  }
  return SENIORITY_BY_ID[id] ?? "unknown";
}

/** remote/hybrid are structured booleans; the API models REMOTE|HYBRID|ONSITE. */
function mapWorkMode(location: SrPosting["location"]): CanonicalJob["workMode"] {
  if (location?.remote === undefined || location.hybrid === undefined) {
    return "unknown";
  }
  if (location.remote && !location.hybrid) {
    return "remote";
  }
  if (location.hybrid && !location.remote) {
    return "hybrid";
  }
  if (!location.remote && !location.hybrid) {
    return "onsite";
  }
  return "unknown";
}

function buildLocations(posting: SrPosting): CanonicalJob["locations"] {
  const location = posting.location;
  if (!location) {
    return [];
  }
  const raw =
    location.fullLocation ??
    [location.city, location.region, location.country?.toUpperCase()]
      .filter((part): part is string => Boolean(part))
      .join(", ");
  if (!raw) {
    return [];
  }
  return [
    {
      raw,
      city: location.city ?? null,
      region: location.region ?? null,
      countryCode: location.country ? location.country.toUpperCase() : null
    }
  ];
}

function buildDescription(posting: SrPosting): string {
  const sections = posting.jobAd?.sections;
  if (!sections) {
    return "";
  }
  const ordered = [
    sections.companyDescription,
    sections.jobDescription,
    sections.qualifications,
    sections.additionalInformation
  ];
  return ordered
    .flatMap((section) => {
      if (!section?.text) {
        return [];
      }
      const text = htmlToText(section.text);
      return section.title ? [`${section.title}\n${text}`] : [text];
    })
    .join("\n");
}

function mapCompensation(
  compensation: SrPosting["compensation"]
): CanonicalJob["compensation"] {
  if (
    !compensation ||
    compensation.min == null ||
    compensation.max == null ||
    !compensation.currency
  ) {
    return { min: null, max: null, currency: null, period: null, source: "unknown" };
  }
  return {
    min: compensation.min,
    max: compensation.max,
    currency: compensation.currency,
    period: compensation.period ? compensation.period.toLowerCase() : null,
    source: "explicit"
  };
}

function buildEvidence(
  posting: SrPosting,
  canonicalUrl: string,
  descriptionText: string
): CanonicalJob["evidence"] {
  const evidence: CanonicalJob["evidence"] = [
    { field: "titleRaw", quote: posting.name, sourceUrl: canonicalUrl }
  ];
  const locationQuote = posting.location?.fullLocation ?? posting.location?.city;
  if (locationQuote) {
    evidence.push({ field: "locations", quote: locationQuote, sourceUrl: canonicalUrl });
  }
  if (posting.experienceLevel?.id && typeof posting.experienceLevel.id === "string") {
    evidence.push({
      field: "seniority",
      quote: posting.experienceLevel.id,
      sourceUrl: canonicalUrl
    });
  }
  if (descriptionText.length > 0) {
    evidence.push({
      field: "descriptionText",
      quote: descriptionText.slice(0, 200),
      sourceUrl: canonicalUrl
    });
  }
  return evidence;
}
