/**
 * Official vacancies read straight from each employer's ATS
 * (docs/adr/0006-direct-employers.md). A separate corpus from `jobs`: nothing
 * here is ever written to that table.
 */

export const DIRECT_ATS_TYPES = ["greenhouse", "lever", "ashby", "smartrecruiters"] as const;
export type DirectAtsType = (typeof DIRECT_ATS_TYPES)[number];

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
}

/** A posting that passed the Colombia filter, ready to store. */
export interface DirectPosting {
  externalId: string;
  title: string;
  applyUrl: string;
  locationRaw: string;
  city: string | null;
  country: "CO";
  workplace: Workplace | null;
  descriptionText: string | null;
  department: string | null;
  employmentType: string | null;
  publishedAt: string | null;
  validThrough: string | null;
  contentHash: string;
}

/**
 * A board listing. `complete` is true only when every page came back 200
 * with the expected shape — closures are applied only to complete listings.
 */
export type BoardListing =
  | { kind: "complete"; boardTotal: number; postings: RawAtsPosting[] }
  | { kind: "not_found"; detail: string }
  | { kind: "error"; detail: string };

export interface EmployerSourceRef {
  atsType: DirectAtsType;
  atsRef: string;
}

/** Minimal HTTP surface the connectors need, injectable for tests. */
export interface HttpResponse {
  status: number;
  body: string;
}
/**
 * GET by default. `json` turns it into a POST with a JSON body (Workday's
 * public search endpoint only answers POST); `accept` asks for HTML/XML
 * (career sites read through their sitemap or JSON-LD).
 */
export interface HttpRequestInit {
  json?: unknown;
  accept?: string;
}
export type HttpGet = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;
