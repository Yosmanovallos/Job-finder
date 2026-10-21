import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Bounded GET for an employer's own site (docs/source-catalog/
 * site-probe-ats-links.md §1): same identifiable User-Agent as the ATS
 * calls, 15 s timeout, 2 MB body cap, NO automatic redirects (each hop is
 * returned to the caller, which decides whether it stays on the employer's
 * site), and never a private, loopback or link-local address (SSRF).
 */

const USER_AGENT = "BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)";
const TIMEOUT_MS = 15_000;
export const MAX_HTML_BYTES = 2 * 1024 * 1024;

export interface SiteResponse {
  status: number;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  body: string;
}
export type SiteGet = (url: string) => Promise<SiteResponse>;

function privateV4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** True for any address a public website can't legitimately live on. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return privateV4(address);
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return privateV4(mapped[1]);
    return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower);
  }
  return true;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("host no público");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("host no público");
}

export const boundedSiteGet: SiteGet = async (url) => {
  const target = new URL(url);
  if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("esquema no permitido");
  await assertPublicHost(target.hostname);
  const response = await fetch(target, {
    redirect: "manual",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  const declared = Number(headers["content-length"] || 0);
  if (declared > MAX_HTML_BYTES) {
    await response.body?.cancel();
    return { status: response.status, headers, body: "" };
  }
  // Read at most MAX_HTML_BYTES; a larger page is cut, not buffered whole.
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (size < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel().catch(() => undefined);
  }
  const body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks).subarray(0, MAX_HTML_BYTES));
  return { status: response.status, headers, body };
};
