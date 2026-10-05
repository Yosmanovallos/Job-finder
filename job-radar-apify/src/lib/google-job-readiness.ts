/**
 * THE one definition of "good enough for Google" (docs/JOB-SEO-ARCHITECTURE-V2.md §4).
 *
 * evaluateGoogleJobReadiness() is the only code that decides whether a job
 * belongs to the Google SEO corpus. Its verdict is persisted (jobs.seo_ready /
 * seo_reasons) by src/db/job-readiness-repository.ts, and every consumer reads
 * that same stored verdict through isGoogleReadyNow() / SEO_READY_SQL:
 *
 *   robots index/noindex · JobPosting emission · job sitemap · URL_UPDATED
 *
 * USER_VISIBLE is a different concept and is NOT decided here: an active job
 * that fails this gate keeps its 200 page, its source link and its dashboard
 * slot — it just never enters Google's corpus.
 */
import { assessDescription, type DescriptionReason, type DescriptionSignals } from "./job-description-quality.js";
import { toCountryCode, toCountryCodes } from "./country-codes.js";
import { getGoogleJobSourcePolicy } from "./google-job-source-policy.js";
import { jobStaleReason, liveJobSql } from "./job-freshness.js";

export type ReadinessReason =
  | DescriptionReason
  | "INACTIVE"
  | "NON_CANONICAL"
  | "EXPIRED"
  | "INVALID_TITLE"
  | "MISSING_EMPLOYER"
  | "MISSING_LOCATION"
  | "LOCATION_COUNTRY_CONFLICT"
  | "INVALID_REMOTE_LOCATION"
  | "MISSING_APPLICATION_URL"
  | "MISSING_DATE_POSTED"
  | "SOURCE_REQUIRES_JOB_CLASSIFICATION";

export type RemoteType = "fully_remote" | "hybrid" | "onsite";

export interface ReadinessInput {
  source?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  /** jobs.country: the country of the source market the job was listed in (CO/VE), NULL for remote. */
  country?: string | null;
  url?: string | null;
  publishedAt?: string | Date | null;
  description?: string | null;
  requirements?: string[] | null;
  descriptionKind?: string | null;
  remoteType?: string | null;
  applicantCountries?: string[] | null;
  validThrough?: string | Date | null;
  isActive?: boolean | null;
  /** False when a newer active row shares this job's (title, company, location) identity. */
  isCanonical?: boolean | null;
}

export type GoogleLocation =
  | { kind: "remote"; countries: string[] }
  | { kind: "physical"; locality: string; region: string | null; country: string };

export interface ReadinessResult {
  ready: boolean;
  reasons: ReadinessReason[];
  qualitySignals: DescriptionSignals & { descriptionOk: boolean; locationKind: GoogleLocation["kind"] | null };
  location: GoogleLocation | null;
}

const REMOTE_TEXT = /\b(remot[oa]s?|remote|teletrabajo|home ?office|anywhere|worldwide|trabajo desde casa)\b/i;
const HYBRID_TEXT = /\bh[ií]brid[oa]\b|\bhybrid\b/i;
const MODALITY_PREFIX = /^\s*(h[ií]brid[oa]|hybrid|remot[oa]|remote|presencial)\s*[-–—:,|/]\s*/i;
const PLACEHOLDER_TITLES = /^(oportunidad torre|vacante|empleo|job|oferta)$/i;

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Where Google may be told this job is. Only facts the source stated:
 *  - fully remote ONLY with source evidence (remoteType) AND source-stated
 *    eligible countries — Google requires at least one;
 *  - remote-looking text without that evidence is ambiguous, never guessed;
 *  - physical: locality/region split from the source's own location text,
 *    country from the listing market, rejected if the text names another country.
 */
export function resolveGoogleLocation(
  input: Pick<ReadinessInput, "location" | "country" | "remoteType" | "applicantCountries">
): { location: GoogleLocation | null; reason: ReadinessReason | null } {
  const raw = (input.location || "").trim();
  if (input.remoteType === "fully_remote") {
    const countries = toCountryCodes(input.applicantCountries ?? []);
    return countries.length > 0
      ? { location: { kind: "remote", countries }, reason: null }
      : { location: null, reason: "INVALID_REMOTE_LOCATION" };
  }
  if (!raw) return { location: null, reason: "MISSING_LOCATION" };

  const hybrid = input.remoteType === "hybrid" || HYBRID_TEXT.test(raw);
  if (!hybrid && REMOTE_TEXT.test(raw)) return { location: null, reason: "INVALID_REMOTE_LOCATION" };

  const parts = raw
    .replace(MODALITY_PREFIX, "")
    .split(",")
    .map((part) => part.replace(MODALITY_PREFIX, "").trim())
    .filter((part) => part && !HYBRID_TEXT.test(part) && !REMOTE_TEXT.test(part));
  const namedCountries = parts.map(toCountryCode).filter((code): code is string => code !== null);
  const places = parts.filter((part) => toCountryCode(part) === null);
  const listed = input.country ? input.country.toUpperCase() : null;
  const named = namedCountries[0] ?? null;
  if (listed && named && listed !== named) return { location: null, reason: "LOCATION_COUNTRY_CONFLICT" };
  const country = listed ?? named;
  if (!country || places.length === 0) return { location: null, reason: "MISSING_LOCATION" };
  const locality = places[0];
  const region = places.length > 1 ? places[places.length - 1] : null;
  return { location: { kind: "physical", locality, region: region !== locality ? region : null, country }, reason: null };
}

export function evaluateGoogleJobReadiness(input: ReadinessInput, now: Date = new Date()): ReadinessResult {
  const reasons: ReadinessReason[] = [];
  const sourcePolicy = getGoogleJobSourcePolicy(input.source);
  if (sourcePolicy.googleJobsEligibility === "blocked_pending_review" && sourcePolicy.reason) {
    reasons.push(sourcePolicy.reason);
  }
  if (input.isActive === false) reasons.push("INACTIVE");
  if (input.isCanonical === false) reasons.push("NON_CANONICAL");

  const title = (input.title || "").trim();
  if (title.length < 3 || !/\p{L}/u.test(title) || PLACEHOLDER_TITLES.test(title)) reasons.push("INVALID_TITLE");
  if (!(input.company || "").trim()) reasons.push("MISSING_EMPLOYER");
  if (!isHttpUrl(input.url)) reasons.push("MISSING_APPLICATION_URL");
  if (!parseDate(input.publishedAt)) reasons.push("MISSING_DATE_POSTED");

  const validThrough = parseDate(input.validThrough);
  if (validThrough && validThrough.getTime() <= now.getTime()) reasons.push("EXPIRED");

  const { location, reason: locationReason } = resolveGoogleLocation(input);
  if (locationReason) reasons.push(locationReason);

  const description = assessDescription(input);
  reasons.push(...description.reasons);

  return {
    ready: reasons.length === 0,
    reasons,
    qualitySignals: { ...description.signals, descriptionOk: description.ok, locationKind: location?.kind ?? null },
    location
  };
}

// --- Stored-verdict readers ---------------------------------------------------
//
// The persisted verdict cannot know that time has passed, so the one
// time-dependent condition (a source-stated validThrough) is re-checked on
// read — identically in TS and SQL. tests/validate-job-seo-v2.ts asserts both
// agree on every fixture.

export interface StoredReadiness {
  seoReady?: boolean | null;
  isActive?: boolean | null;
  validThrough?: string | Date | null;
  publishedAt?: string | Date | null;
}

// Since 2026-10-04 the time-dependent part is the shared freshness rule
// (src/lib/job-freshness.ts): past validThrough OR published more than a
// month ago. A posting that is no longer shown is never "ready" for Google
// either, so nothing re-queues or sends a URL_UPDATED for it.
export function isGoogleReadyNow(row: StoredReadiness, now: Date = new Date()): boolean {
  if (row.seoReady !== true || row.isActive === false) return false;
  return jobStaleReason(row.publishedAt, row.validThrough, now) === null;
}

/** SQL twin of isGoogleReadyNow(). `alias` is the jobs table alias in the calling query. */
export function seoReadySql(alias = "jobs"): string {
  return `(${alias}.seo_ready = TRUE AND ${alias}.is_active = TRUE AND ${liveJobSql(alias)})`;
}

/**
 * SQL: this row is the canonical one of its identity group. content_fingerprint
 * is SHA-256 of the same (title, company, location-or-country) key that
 * getJobById()/the sitemap's DISTINCT ON compare with lower(trim()), and it is
 * indexed (idx_jobs_content_fingerprint), so this is an index probe per row.
 */
export function canonicalSql(alias = "jobs"): string {
  return `(${alias}.content_fingerprint IS NULL OR NOT EXISTS (
    SELECT 1 FROM jobs newer
    WHERE newer.content_fingerprint = ${alias}.content_fingerprint
      AND newer.is_active = TRUE AND ${liveJobSql("newer")} AND newer.id <> ${alias}.id
      AND (newer.published_at, newer.id) > (${alias}.published_at, ${alias}.id)
  ))`;
}
