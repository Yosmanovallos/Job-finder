/**
 * HTTP answers of a detail page that are faults, not "this job has no detail".
 *
 * Before this, fetchLinkedInDetail/fetchComputrabajoDetail did
 * `if (!response.ok) return null`, so a 403, a 429 or LinkedIn's 999 reached
 * the state machine as NO_DETAIL: no fault class, circuit-neutral, and the
 * tick kept asking a host that was refusing it. Production showed exactly that
 * shape (2026-10-25): Computrabajo-CO detail fell from ~50% complete to ~2% on
 * 2026-10-07 with every miss recorded as NO_DETAIL and no fault class.
 *
 * A refusal is reported as the existing FetchBlockedError / FetchRateLimitedError
 * so the shared classifier, the detail circuit and the tick log see it. Nothing
 * here retries differently or tries another route: a refusal stops the source.
 */
import { FetchBlockedError } from "../engine/resilient-fetch.js";
import { FetchRateLimitedError, retryAfterMsFrom } from "../engine/rate-limit.js";

/** 999 is LinkedIn's own "request denied" answer to automated clients. */
const DENY_STATUSES = new Set([401, 403, 999]);

/**
 * Paths a LinkedIn job URL is redirected to when the page is withheld behind
 * sign-in. Answered with 200, so the status alone would read it as a page.
 */
const LINKEDIN_LOGIN_WALL_PATHS = ["/authwall", "/login", "/checkpoint", "/uas/login"];

export interface DetailResponseLike {
  status: number;
  url: string;
  headers: { get(name: string): string | null };
}

/**
 * The error to throw for this response, or null when it is a page whose
 * content should be parsed. A non-deny, non-429 failure (404, 410, 5xx) stays
 * null: the job page itself is gone or the host hiccupped, and the state
 * machine's NO_DETAIL backoff already covers that.
 */
export function detailFaultFor(label: string, response: DetailResponseLike): Error | null {
  if (DENY_STATUSES.has(response.status)) return new FetchBlockedError(label, response.status);
  if (response.status === 429) {
    return new FetchRateLimitedError(label, 429, retryAfterMsFrom(response.headers.get("retry-after")) ?? undefined);
  }
  if (response.status >= 200 && response.status < 300 && isLinkedInLoginWall(response.url)) {
    return new FetchBlockedError(label, response.status);
  }
  return null;
}

export function isLinkedInLoginWall(finalUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(finalUrl);
  } catch {
    return false;
  }
  if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return false;
  return LINKEDIN_LOGIN_WALL_PATHS.some((path) => parsed.pathname === path || parsed.pathname.startsWith(`${path}/`));
}
