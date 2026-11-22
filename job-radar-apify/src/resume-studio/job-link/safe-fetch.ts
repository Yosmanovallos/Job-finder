import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import { ALLOW_ALL, DISALLOW_ALL, isAllowed, parseRobots, type RobotsPolicy } from "../../lib/robots-txt.js";

// AI Resume Studio R2 — server-side GET of a link a user pasted (doc 11
// §5.3, doc 08 «SSRF»). The URL is attacker-chosen, so:
// - only http/https on ports 80/443, no user:password@;
// - we resolve DNS ourselves, refuse if ANY answer is non-public, and the
//   socket connects to that vetted address (pinned through `lookup`), so a
//   second resolution can't rebind to 127.0.0.1;
// - redirects are followed by hand (max 3) and every hop is re-vetted;
// - one 8 s deadline for the whole chain; ≤ 2 MB read from the stream,
//   counted after decompression; only text/html; no cookies sent or kept;
// - robots.txt of the final host is honored for our bot token.
// Resolver and transport are injectable so tests never open a socket.

export const LINK_FETCH_TIMEOUT_MS = 8_000;
export const LINK_FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const LINK_FETCH_MAX_REDIRECTS = 3;
const ROBOTS_MAX_BYTES = 256 * 1024;
/** Generic client identity: the site's bot, never anything about a person. */
export const LINK_FETCH_USER_AGENT = "BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)";

export type SafeFetchErrorCode =
  | "invalid_url"
  | "blocked_scheme"
  | "blocked_port"
  | "blocked_credentials"
  | "blocked_host"
  | "blocked_address"
  | "dns_failed"
  | "too_many_redirects"
  | "too_large"
  | "timeout"
  | "not_html"
  | "robots_disallowed"
  | "network";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  constructor(code: SafeFetchErrorCode) {
    super(code);
    this.code = code;
    this.name = "SafeFetchError";
  }
}

// ---------- address policy ----------

function v4Parts(address: string): number[] {
  return address.split(".").map(Number);
}

function blockedV4(address: string): boolean {
  const [a, b, c] = v4Parts(address);
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF assignments, TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

function expandV6(address: string): number[] | null {
  let text = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  // Trailing dotted IPv4 (::ffff:1.2.3.4) becomes two hextets.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const [a, b, c, d] = v4Parts(dotted[1]);
    text = text.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((group) => parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

function embeddedV4(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/** True for any address a public job page can't legitimately live on. */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address.replace(/^\[|\]$/g, "").split("%")[0]);
  if (version === 4) return blockedV4(address);
  if (version !== 6) return true;
  const g = expandV6(address);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return blockedV4(embeddedV4(g[6], g[7])); // ::ffff:a.b.c.d, ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return blockedV4(embeddedV4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return blockedV4(embeddedV4(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard-only
  return false;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata", "metadata.google.internal", "instance-data", "kubernetes.default"]);

/** Validates scheme, port, credentials and host name. Exported for tests. */
export function assertFetchableUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw) : raw;
  } catch {
    throw new SafeFetchError("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SafeFetchError("blocked_scheme");
  if (url.username || url.password) throw new SafeFetchError("blocked_credentials");
  if (url.port && url.port !== "80" && url.port !== "443") throw new SafeFetchError("blocked_port");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new SafeFetchError("blocked_host");
  }
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare) && isBlockedAddress(bare)) throw new SafeFetchError("blocked_address");
  // A single-label name ("intranet") only resolves on a private network.
  if (!isIP(bare) && !bare.includes(".")) throw new SafeFetchError("blocked_host");
  return url;
}

// ---------- transport ----------

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface HopResponse {
  status: number;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  body: AsyncIterable<Buffer>;
  /** Releases the connection without reading the rest. */
  discard(): void;
}
/** Sends one GET to `url`, connecting ONLY to `pinned`. */
export type Transport = (url: URL, pinned: ResolvedAddress, headers: Record<string, string>, signal: AbortSignal) => Promise<HopResponse>;

export const systemResolver: Resolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => ({ address: answer.address, family: answer.family === 6 ? 6 : 4 }));
};

export const nodeTransport: Transport = (url, pinned, headers, signal) =>
  new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers,
        agent: false,
        signal,
        // The vetted address, whatever the system resolver would say now.
        lookup: ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
          else callback(null, pinned.address, pinned.family);
        }) as unknown as typeof import("node:dns").lookup
      },
      (response) => {
        const out: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
        }
        resolve({ status: response.statusCode ?? 0, headers: out, body: response as Readable, discard: () => response.destroy() });
      }
    );
    request.on("error", reject);
    request.end();
  });

export interface SafeFetchDeps {
  resolver?: Resolver;
  transport?: Transport;
  timeoutMs?: number;
  /** Robots check of the final host; off only for robots.txt itself. */
  robots?: boolean;
}

async function vet(url: URL, resolver: Resolver): Promise<ResolvedAddress> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return { address: host, family: isIP(host) === 6 ? 6 : 4 };
  let answers: ResolvedAddress[];
  try {
    answers = await resolver(host);
  } catch {
    throw new SafeFetchError("dns_failed");
  }
  if (answers.length === 0) throw new SafeFetchError("dns_failed");
  // ANY private answer blocks: a host that also points inside is not public.
  if (answers.some((answer) => isBlockedAddress(answer.address))) throw new SafeFetchError("blocked_address");
  return answers[0];
}

function withDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new SafeFetchError("timeout"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SafeFetchError("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.aborted ? new SafeFetchError("timeout") : error);
      }
    );
  });
}

/** Reads a body (decompressing if the server ignored identity) with a hard cap. */
async function readCapped(response: HopResponse, max: number, signal: AbortSignal): Promise<Buffer> {
  const encoding = (response.headers["content-encoding"] || "identity").toLowerCase().trim();
  const inflater =
    encoding === "gzip" || encoding === "x-gzip"
      ? zlib.createGunzip()
      : encoding === "deflate"
        ? zlib.createInflate()
        : encoding === "br"
          ? zlib.createBrotliDecompress()
          : encoding === "identity" || encoding === ""
            ? null
            : undefined;
  if (inflater === undefined) {
    response.discard();
    throw new SafeFetchError("not_html");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const source: AsyncIterable<Buffer> = inflater ? (async function* () {
    const pump = (async () => {
      try {
        for await (const chunk of response.body) if (!inflater.write(chunk)) await new Promise((r) => inflater.once("drain", r));
        inflater.end();
      } catch (error) {
        inflater.destroy(error as Error);
      }
    })();
    for await (const chunk of inflater) yield chunk as Buffer;
    await pump;
  })() : response.body;
  const iterator = source[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await withDeadline(iterator.next(), signal);
      if (next.done) break;
      size += next.value.length;
      if (size > max) throw new SafeFetchError("too_large");
      chunks.push(next.value);
    }
  } catch (error) {
    response.discard();
    inflater?.destroy();
    if (error instanceof SafeFetchError) throw error;
    throw new SafeFetchError(signal.aborted ? "timeout" : "network");
  }
  return Buffer.concat(chunks, size);
}

export interface SafeFetchResult {
  status: number;
  /** The URL that answered (after redirects). */
  finalUrl: string;
  contentType: string;
  body: string;
  redirects: number;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

async function fetchChain(
  start: URL,
  accept: string,
  maxBytes: number,
  resolver: Resolver,
  transport: Transport,
  signal: AbortSignal,
  beforeHop?: (url: URL) => Promise<void>
): Promise<{ response: HopResponse; url: URL; redirects: number }> {
  let url = start;
  for (let redirects = 0; ; redirects++) {
    assertFetchableUrl(url);
    await beforeHop?.(url);
    const pinned = await withDeadline(vet(url, resolver), signal);
    let response: HopResponse;
    try {
      response = await withDeadline(
        transport(url, pinned, { "User-Agent": LINK_FETCH_USER_AGENT, Accept: accept, "Accept-Encoding": "identity", "Accept-Language": "es-CO,es;q=0.9" }, signal),
        signal
      );
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      throw new SafeFetchError(signal.aborted ? "timeout" : "network");
    }
    const declared = Number(response.headers["content-length"] || 0);
    if (declared > maxBytes) {
      response.discard();
      throw new SafeFetchError("too_large");
    }
    if (!REDIRECTS.has(response.status)) return { response, url, redirects };
    response.discard();
    if (redirects >= LINK_FETCH_MAX_REDIRECTS) throw new SafeFetchError("too_many_redirects");
    const location = response.headers.location;
    if (!location) throw new SafeFetchError("network");
    try {
      url = new URL(location, url);
    } catch {
      throw new SafeFetchError("invalid_url");
    }
  }
}

/** robots.txt of `origin`; unreachable or 5xx → disallow, 4xx → allow (RFC 9309). */
export async function fetchRobots(origin: URL, deps: SafeFetchDeps = {}, signal?: AbortSignal): Promise<RobotsPolicy> {
  const resolver = deps.resolver ?? systemResolver;
  const transport = deps.transport ?? nodeTransport;
  const ownSignal = signal ?? AbortSignal.timeout(deps.timeoutMs ?? LINK_FETCH_TIMEOUT_MS);
  try {
    const { response } = await fetchChain(new URL("/robots.txt", origin), "text/plain", ROBOTS_MAX_BYTES, resolver, transport, ownSignal);
    if (response.status >= 400 && response.status < 500) {
      response.discard();
      return ALLOW_ALL;
    }
    if (response.status !== 200) {
      response.discard();
      return DISALLOW_ALL;
    }
    return parseRobots((await readCapped(response, ROBOTS_MAX_BYTES, ownSignal)).toString("utf8"));
  } catch (error) {
    if (error instanceof SafeFetchError && (error.code === "blocked_address" || error.code === "blocked_host")) throw error;
    return DISALLOW_ALL;
  }
}

/**
 * GET of a public HTML page under every control above. Throws
 * SafeFetchError; non-2xx statuses come back as a result (the caller
 * decides: 401/403 → login wall → «pega la descripción»).
 */
export async function safeFetchHtml(raw: string, deps: SafeFetchDeps = {}): Promise<SafeFetchResult> {
  const start = assertFetchableUrl(raw);
  const resolver = deps.resolver ?? systemResolver;
  const transport = deps.transport ?? nodeTransport;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? LINK_FETCH_TIMEOUT_MS);
  // robots.txt of every origin the chain visits (usually one), read once each.
  const policies = new Map<string, RobotsPolicy>();
  const robotsGate =
    deps.robots === false
      ? undefined
      : async (url: URL) => {
          let policy = policies.get(url.origin);
          if (!policy) {
            policy = await fetchRobots(url, deps, signal);
            policies.set(url.origin, policy);
          }
          if (!isAllowed(policy, `${url.pathname}${url.search}`)) throw new SafeFetchError("robots_disallowed");
        };
  const { response, url, redirects } = await fetchChain(start, "text/html,application/xhtml+xml", LINK_FETCH_MAX_BYTES, resolver, transport, signal, robotsGate);
  const contentType = (response.headers["content-type"] || "").toLowerCase();
  if (response.status >= 200 && response.status < 300 && !/^(text\/html|application\/xhtml\+xml)\b/.test(contentType)) {
    response.discard();
    throw new SafeFetchError("not_html");
  }
  if (response.status < 200 || response.status >= 300) {
    response.discard();
    return { status: response.status, finalUrl: url.toString(), contentType, body: "", redirects };
  }
  const body = await readCapped(response, LINK_FETCH_MAX_BYTES, signal);
  return { status: response.status, finalUrl: url.toString(), contentType, body: body.toString("utf8"), redirects };
}
