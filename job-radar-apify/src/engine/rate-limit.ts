/**
 * Rate limiting (P4, spec SRC-005).
 *
 * `executeWithResilience` takes `fetcher: () => Promise<T[]>`, so it never
 * sees an HTTP response and cannot read `Retry-After` on its own. Rather than
 * change that shared signature (the reputation pipeline depends on it), this
 * follows the precedent already in the codebase for the twin case: a typed
 * error the wrapper understands, exactly like `FetchBlockedError` carries
 * 401/403 up from a scraper.
 *
 * Honored through `sleepWithContext`, which already clamps to the remaining
 * budget — so respecting `Retry-After` can never push a tick past its
 * deadline. If a source asks for longer than we have left, the attempt is
 * abandoned instead of sleeping through the end of the tick.
 *
 * Verified by unit test only, and deliberately so: production logged ZERO
 * `rate_limited` attempts in 7 days, and provoking one against a real source
 * would mean abusing it. The spec states this up front rather than promising
 * canary evidence that cannot honestly be produced.
 */

export class FetchRateLimitedError extends Error {
  constructor(
    readonly label: string,
    readonly statusCode: number,
    readonly retryAfterMs: number
  ) {
    super(`[${label}] Rate limited: HTTP ${statusCode} (espera solicitada: ${retryAfterMs}ms)`);
    this.name = "FetchRateLimitedError";
  }
}

const MAX_PARSEABLE_MS = 24 * 60 * 60 * 1000;

/**
 * Parses a `Retry-After` header in either RFC 9110 form: delta-seconds
 * ("30") or an HTTP date ("Wed, 16 Sep 2026 12:00:00 GMT").
 *
 * Returns null — never a guess — when the header is absent, unparseable, or
 * describes a moment already past. Null means "fall back to the existing
 * exponential backoff", which is the pre-P4 behavior.
 */
export function retryAfterMsFrom(header: string | null | undefined): number | null {
  if (header === null || header === undefined) return null;
  const raw = header.trim();
  if (raw.length === 0) return null;

  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    const ms = seconds * 1000;
    return ms > MAX_PARSEABLE_MS ? MAX_PARSEABLE_MS : ms;
  }

  // A negative delta-seconds is not a wait. Guarded explicitly because
  // Date.parse's behavior on strings like "-5" is engine-dependent, and a
  // stray year-like parse here would turn nonsense into a real sleep.
  if (/^[+-]/.test(raw)) return null;

  const asDate = Date.parse(raw);
  if (Number.isNaN(asDate)) return null;
  const delta = asDate - Date.now();
  // A date in the past means "you may retry now", not "wait forever".
  if (delta <= 0) return 0;
  return delta > MAX_PARSEABLE_MS ? MAX_PARSEABLE_MS : delta;
}
