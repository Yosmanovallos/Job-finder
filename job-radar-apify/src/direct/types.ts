/**
 * Official vacancies read straight from each employer's ATS
 * (docs/adr/0006-direct-employers.md). A separate corpus from `jobs`: nothing
 * here is ever written to that table.
 */

export const DIRECT_ATS_TYPES = ["greenhouse", "lever", "ashby", "smartrecruiters", "successfactors", "teamtailor", "workday", "phenom", "eightfold", "magneto", "google", "tp", "workeando", "frisby", "altipal"] as const;
export type DirectAtsType = (typeof DIRECT_ATS_TYPES)[number];

import type { RawAtsPosting, Workplace } from "../lib/ats-posting-parsers.js";
export type { RawAtsPosting, Workplace } from "../lib/ats-posting-parsers.js";


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
  /** See RawAtsPosting.partial. */
  partial: boolean;
}

/**
 * A board listing. `complete` is true only when every page came back 200
 * with the expected shape — closures are applied only to complete listings.
 */
export type BoardListing =
  | {
      kind: "complete";
      boardTotal: number;
      postings: RawAtsPosting[];
      /**
       * New postings left out of this read because the per-board detail
       * budget ran out: they never were stored, so leaving them out closes
       * nothing, and the next read fetches them.
       */
      deferred?: number;
    }
  | { kind: "not_found"; detail: string }
  | { kind: "error"; detail: string };

/**
 * What a read already knows. Connectors whose listing lacks a date or a
 * description fetch the posting's own page only for ids not stored yet,
 * at most `detailBudget` per read.
 */
export interface ListOptions {
  knownIds?: ReadonlySet<string>;
  detailBudget?: number;
}

export interface EmployerSourceRef {
  atsType: DirectAtsType;
  atsRef: string;
}

/** Minimal HTTP surface the connectors need, injectable for tests. */
export interface HttpResponse {
  status: number;
  body: string;
  /** Only pagination headers used by public WordPress collection endpoints. */
  headers?: { "x-wp-total"?: string; "x-wp-totalpages"?: string };
}
/**
 * GET by default. `json` turns it into a POST with a JSON body (Workday's
 * public search endpoint only answers POST); `accept` asks for HTML/XML
 * (career sites read through their sitemap or JSON-LD).
 */
export interface HttpRequestInit {
  json?: unknown;
  /** Asks for HTML/XML. Such requests never follow redirects: a 3xx comes back as is. */
  accept?: string;
}
export type HttpGet = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;
