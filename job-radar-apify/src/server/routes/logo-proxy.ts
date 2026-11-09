import type { IncomingMessage, ServerResponse } from "node:http";
import { COMPANY_LOGO_DOMAINS } from "../../data/company-logo-domains.js";
import { SOURCE_LOGO_DOMAINS } from "../../lib/source-logos.js";

// GET|HEAD /logo/<domain>.ico — the curated company/portal favicons, served
// from our own origin instead of hotlinking icons.duckduckgo.com.
//
// Why: DuckDuckGo's icon service answers 404 intermittently even for domains
// that do have an icon (measured 2026-11-08: cargill.com, encora.com and
// santander.com.co flipped between 200 and 404 across retries). A hotlinked
// 404 is logged as a browser console error, which costs Lighthouse's Best
// Practices score on every page with logos. Here a failed fetch is answered
// with 204: the <img> still fires onError (the initial-avatar fallback
// appears exactly as before) but nothing is logged as a failed resource.
//
// Bounds (no open proxy, no unbounded memory):
// - Only domains from the two curated maps are served; anything else is 404
//   without touching the network.
// - Upstream is one fixed host, 4 s timeout, max 64 KiB, image/* only.
// - In-memory cache keyed by allowlisted domain (so ≤ the allowlist size,
//   ~90 entries, a few MB worst case): hits for 24 h, misses for 10 min.
//   Concurrent requests for the same domain share one upstream fetch.
// - Responses are publicly cacheable, so the edge absorbs repeat traffic.
// This is a transient cache of the employer's own public favicon, like any
// CDN would hold — not a stored copy in public/ (see company-logo-domains.ts).

const ALLOWED_DOMAINS = new Set<string>([
  ...Object.values(COMPANY_LOGO_DOMAINS),
  ...Object.values(SOURCE_LOGO_DOMAINS)
]);

const UPSTREAM = "https://icons.duckduckgo.com/ip3/";
const FETCH_TIMEOUT_MS = 4_000;
const MAX_BYTES = 64 * 1024;
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const HIT_CACHE_CONTROL = "public, max-age=604800, s-maxage=86400, stale-while-revalidate=604800";
const MISS_CACHE_CONTROL = "public, max-age=600, s-maxage=600";

type Entry = { expiresAt: number; body: Buffer | null; contentType: string | null };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Entry>>();

const LOGO_PATH = /^\/logo\/([a-z0-9.-]{3,80})\.ico$/;

export function isLogoRoute(pathname: string): boolean {
  return pathname.startsWith("/logo/");
}

async function fetchUpstream(domain: string): Promise<Entry> {
  const miss: Entry = { expiresAt: Date.now() + MISS_TTL_MS, body: null, contentType: null };
  // Two attempts: the upstream 404/5xx is intermittent, not permanent.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${UPSTREAM}${domain}.ico`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "error"
      });
      if (!response.ok) continue;
      const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!contentType.startsWith("image/")) return miss;
      const declared = Number(response.headers.get("content-length") || "0");
      if (declared > MAX_BYTES) return miss;
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length === 0 || body.length > MAX_BYTES) return miss;
      return { expiresAt: Date.now() + HIT_TTL_MS, body, contentType };
    } catch {
      // Timeout or network error: try once more, then give up.
    }
  }
  return miss;
}

async function getLogo(domain: string): Promise<Entry> {
  const cached = cache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const pending = inFlight.get(domain);
  if (pending) return pending;
  const request = fetchUpstream(domain)
    .then((entry) => {
      // Keep a still-valid hit if the refresh failed (stale beats a fallback).
      if (!entry.body && cached?.body) {
        const kept = { ...cached, expiresAt: Date.now() + MISS_TTL_MS };
        cache.set(domain, kept);
        return kept;
      }
      cache.set(domain, entry);
      return entry;
    })
    .finally(() => inFlight.delete(domain));
  inFlight.set(domain, request);
  return request;
}

export async function handleLogoRoute(
  req: IncomingMessage,
  res: ServerResponse,
  context: { pathname: string; method: string }
): Promise<void> {
  const match = LOGO_PATH.exec(context.pathname);
  const domain = match?.[1];
  if (!domain || !ALLOWED_DOMAINS.has(domain) || (context.method !== "GET" && context.method !== "HEAD")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
    res.end("Not found");
    return;
  }
  const entry = await getLogo(domain);
  if (!entry.body || !entry.contentType) {
    res.writeHead(204, { "Cache-Control": MISS_CACHE_CONTROL });
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": entry.contentType,
    "Content-Length": String(entry.body.length),
    "Cache-Control": HIT_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff"
  });
  res.end(req.method === "HEAD" ? undefined : entry.body);
}

/** Test seam: clears the in-memory cache. */
export function resetLogoCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
