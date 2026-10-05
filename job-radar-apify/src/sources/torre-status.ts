/**
 * Torre source-side status check — the closure signal the listing never had.
 *
 * Bug reported 2026-10-04: Torre postings closed at the source for weeks were
 * still live on BuscoTrabajo (e.g. kWR9GX7r, deadline 2026-09-25, and
 * JdmMGOKd, deadline 2026-09-10, both `status: "closed"` on Torre). The only
 * expiration path in this codebase is `purgeOldJobs()` — "not re-seen for 30
 * days" — and `scrapeTorre()` stops re-seeing a posting at 14 days of age, so
 * a Torre row lived up to ~44 days regardless of what Torre said about it.
 *
 * This asks Torre directly, one opportunity at a time, through the same
 * public, unauthenticated JSON endpoint torre.ai's own job pages read
 * (`/api/suite/opportunities/:id`). No auth, no anti-bot evasion, no HTML.
 *
 * Known and accepted (owner decision, 2026-10-04): torre.ai's robots.txt has
 * `Disallow: /api/`. The robots-allowed alternative is the public page
 * `/post/:id`, whose SSR state carries the same `status="closed"`, at ~460 KB
 * per posting instead of a small JSON body. Revisit if Torre objects.
 *
 * Classification is evidence-only (never inferred):
 *   - 200 + `status === "open"`        → open
 *   - 200 + any other explicit status  → closed (the source says so)
 *   - 404                               → not_found (caller decides; a 404
 *                                          storm usually means the API moved,
 *                                          not that every posting vanished)
 *   - anything else                     → unknown (retry on a later pass)
 */

export const TORRE_OPPORTUNITY_API = "https://torre.ai/api/suite/opportunities/";
const REQUEST_TIMEOUT_MS = 10_000;

export type TorreStatusVerdict =
  | { kind: "open"; deadline: string | null }
  | { kind: "closed"; status: string; deadline: string | null }
  | { kind: "not_found" }
  | { kind: "unknown"; reason: string };

/** Torre opportunity id from a stored job URL (`https://torre.ai/jobs/<id>`). */
export function torreIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^https?:\/\/(?:www\.)?torre\.(?:ai|co)\/(?:jobs|post)\/([A-Za-z0-9]+)(?:[-/?#]|$)/.exec(url.trim());
  return match ? match[1] : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Pure classification of one HTTP response — kept separate so it is testable offline. */
export function classifyTorreOpportunity(httpStatus: number, body: unknown): TorreStatusVerdict {
  if (httpStatus === 404) return { kind: "not_found" };
  if (httpStatus !== 200) return { kind: "unknown", reason: `http_${httpStatus}` };
  if (!body || typeof body !== "object") return { kind: "unknown", reason: "invalid_body" };
  const record = body as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
  // No explicit status = no evidence. Never close on a missing field.
  if (!status) return { kind: "unknown", reason: "missing_status" };
  const deadline = isoOrNull(record.deadline);
  if (status === "open") return { kind: "open", deadline };
  return { kind: "closed", status: status.slice(0, 40), deadline };
}

export async function fetchTorreOpportunityStatus(
  id: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<TorreStatusVerdict> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await fetchImpl(`${TORRE_OPPORTUNITY_API}${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json", "User-Agent": "BuscoTrabajo.co status check (+https://buscotrabajo.co)" },
      signal
    });
    if (response.status !== 200) {
      // Drain so the socket is reusable; the body itself carries no evidence.
      await response.body?.cancel().catch(() => undefined);
      return classifyTorreOpportunity(response.status, null);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "unknown", reason: "invalid_json" };
    }
    return classifyTorreOpportunity(200, body);
  } catch (error) {
    const name = (error as Error)?.name || "Error";
    return { kind: "unknown", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}
