import type { CanonicalJob } from "@job-radar/domain";

/**
 * Adapter contract, verbatim from PLAN_RADAR_EMPLEO_LOCAL.md section 7.4.
 * Rules: discover/fetch/extract/verify are independently testable, adapters
 * never write to the database, every result carries provenance and evidence,
 * and every external call uses timeout, rate limit and retry with jitter.
 */
export interface SourceAdapter {
  readonly metadata: SourceMetadata;

  discover(input: DiscoveryInput): AsyncIterable<SourceReference>;
  fetch(reference: SourceReference): Promise<RawSourceDocument>;
  extract(document: RawSourceDocument): Promise<ExtractedJob[]>;
  verify(job: CanonicalJob): Promise<VerificationResult>;
  healthcheck(): Promise<SourceHealth>;
}

export interface SourceMetadata {
  /** Unique instance id, e.g. "greenhouse:gitlab". */
  id: string;
  /** Adapter implementation name, e.g. "greenhouse". */
  adapterName: string;
  kind: "ats" | "aggregator" | "company_page" | "browser" | "manual";
  /** Source tier per plan section 7.1 (A = public structured ATS). */
  tier: "A" | "B" | "C" | "D" | "E";
  baseUrl: string;
  companySlug: string | null;
  rateLimitPerMinute: number;
  concurrency: number;
}

export interface DiscoveryInput {
  /** Hard cap on references yielded (canary runs use a low limit). */
  limit?: number;
}

/** A pointer to one job posting found during discovery. Not yet normalized. */
export interface SourceReference {
  sourceId: string;
  externalId: string;
  url: string;
  /** Listing-level hint for logs; extraction re-reads it from the source. */
  titleHint?: string;
  discoveredAt: string;
}

/** Raw fetched payload. Phase 3 persists these; adapters never write the DB. */
export interface RawSourceDocument {
  sourceId: string;
  externalId: string;
  url: string;
  fetchedAt: string;
  contentType: string;
  httpStatus: number;
  /** Raw response body, unmodified. */
  body: string;
  /** sha256 hex of body. */
  contentHash: string;
}

export interface ExtractedJob {
  /** Normalized job; fields the source does not state stay unknown/null. */
  job: CanonicalJob;
  provenance: {
    sourceId: string;
    externalId: string | null;
    url: string;
    fetchedAt: string;
    contentHash: string;
    extractionMethod: CanonicalJob["extractionMethod"];
  };
}

export interface VerificationResult {
  status: "active" | "closed" | "unknown";
  checkedAt: string;
  httpStatus: number | null;
  detail: string | null;
}

export interface SourceHealth {
  sourceId: string;
  healthy: boolean;
  checkedAt: string;
  latencyMs: number | null;
  detail: string | null;
}
