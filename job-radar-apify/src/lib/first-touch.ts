/**
 * Signup attribution (Fase A, docs/seo-baseline/2026-11-06-checkpoint-y-plan-registros.md).
 *
 * The browser remembers the visitor's FIRST contact with the site — landing
 * path, referrer host and utm_source/medium/campaign — and sends it once,
 * right after the account is created, to POST /api/me/first-touch. The
 * server re-sanitizes everything with the same functions below and writes
 * it once per account.
 *
 * Privacy rules (no PII):
 * - Landing path only: never the query string or hash (password-reset and
 *   OAuth tokens, search terms), at most 200 characters.
 * - Referrer: host name only, never the full referrer URL.
 * - Only the three utm_* keys, cleaned and bounded; any other query
 *   parameter is ignored.
 *
 * Reading `window.location`/`document.referrer` happens outside React's
 * render (index.tsx calls `rememberFirstTouch()` before mounting), so the
 * server HTML and the first client render stay identical.
 */

export interface FirstTouch {
  landingPath: string;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  /** When the visit happened (ISO 8601), from the visitor's clock. */
  capturedAt: string;
}

export const FIRST_TOUCH_STORAGE_KEY = "bt_first_touch_v1";
export const FIRST_TOUCH_SENT_KEY = "bt_first_touch_sent_v1";
/** A first contact older than this no longer explains a new signup. */
export const FIRST_TOUCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Only accounts this young get a first touch (server-side guard). */
export const FIRST_TOUCH_MAX_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

const MAX_PATH = 200;
const MAX_HOST = 255;
const MAX_UTM = 100;

// Hosts that are a step of our own flows, not a source of traffic: the
// Google OAuth round trip and the site itself.
const IGNORED_REFERRER_HOSTS = new Set(["accounts.google.com", "buscotrabajo.co"]);

// Landing on one of these means the visitor was already in a flow that
// started elsewhere (OAuth return, e-mail links): not a first contact.
const IGNORED_LANDING_PREFIXES = ["/auth/", "/reset-password", "/api/"];

/** Pathname only, without query/hash, printable ASCII, at most 200 chars. */
export function sanitizeLandingPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const pathOnly = raw.split(/[?#]/, 1)[0] ?? "";
  if (!pathOnly.startsWith("/") || pathOnly.startsWith("//")) return null;
  // Percent-encoded and plain ASCII path characters only — anything else
  // (spaces, control characters, unicode) is dropped rather than stored.
  const cleaned = pathOnly.replace(/[^A-Za-z0-9/_\-.~%]/g, "").slice(0, MAX_PATH);
  return cleaned || "/";
}

/** Host name only, lowercase, without "www.". */
export function sanitizeReferrerHost(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  let host = raw.trim().toLowerCase();
  if (host.includes("/") || host.includes(":")) {
    try {
      host = new URL(host).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  host = host.replace(/^www\./, "");
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || host.length > MAX_HOST) return null;
  return host;
}

/** Lowercase, printable, trimmed, at most 100 characters. */
export function sanitizeUtmValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = Array.from(raw)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .toLowerCase()
    .slice(0, MAX_UTM);
  return cleaned || null;
}

/** Builds the first touch of a page load, or null when it is not one. */
export function buildFirstTouch(input: {
  pathname: string;
  search: string;
  referrer: string;
  ownHost: string;
  now: Date;
}): FirstTouch | null {
  const landingPath = sanitizeLandingPath(input.pathname);
  if (!landingPath || IGNORED_LANDING_PREFIXES.some((prefix) => landingPath.startsWith(prefix))) {
    return null;
  }
  const params = new URLSearchParams(input.search);
  let referrerHost = sanitizeReferrerHost(input.referrer);
  const ownHost = sanitizeReferrerHost(input.ownHost);
  if (referrerHost && (referrerHost === ownHost || IGNORED_REFERRER_HOSTS.has(referrerHost))) {
    referrerHost = null;
  }
  return {
    landingPath,
    referrerHost,
    utmSource: sanitizeUtmValue(params.get("utm_source")),
    utmMedium: sanitizeUtmValue(params.get("utm_medium")),
    utmCampaign: sanitizeUtmValue(params.get("utm_campaign")),
    capturedAt: input.now.toISOString()
  };
}

/**
 * Validates a first touch received from a browser (or read back from
 * storage). Returns null when the landing path is missing; every other
 * field degrades to null on its own.
 */
export function parseFirstTouch(raw: unknown, now: Date): FirstTouch | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const landingPath = sanitizeLandingPath(value.landingPath);
  if (!landingPath) return null;
  const captured = typeof value.capturedAt === "string" ? Date.parse(value.capturedAt) : NaN;
  // A clock in the future or a contact older than the TTL is not trusted:
  // the visit time falls back to "now".
  const capturedAt =
    Number.isFinite(captured) &&
    captured <= now.getTime() + 5 * 60 * 1000 &&
    now.getTime() - captured <= FIRST_TOUCH_TTL_MS
      ? new Date(captured).toISOString()
      : now.toISOString();
  return {
    landingPath,
    referrerHost: sanitizeReferrerHost(value.referrerHost),
    utmSource: sanitizeUtmValue(value.utmSource),
    utmMedium: sanitizeUtmValue(value.utmMedium),
    utmCampaign: sanitizeUtmValue(value.utmCampaign),
    capturedAt
  };
}

/** True when the Supabase account was created within the last 24 hours. */
export function isNewAccount(authCreatedAt: string | null | undefined, now: Date): boolean {
  const created = Date.parse(authCreatedAt || "");
  if (!Number.isFinite(created)) return false;
  const age = now.getTime() - created;
  return age >= -5 * 60 * 1000 && age <= FIRST_TOUCH_MAX_ACCOUNT_AGE_MS;
}

/** The /tiktok bio link: `/` tagged so GA4 and the signup row see TikTok. */
export const TIKTOK_SHORT_LINK_TARGET = "/?utm_source=tiktok&utm_medium=social&utm_campaign=bio";

// ---- Report classification (scripts/report-signup-attribution.ts) ----

export type LandingType =
  | "portada"
  | "vacante"
  | "hub"
  | "empresa"
  | "dashboard"
  | "otra"
  | "sin dato";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function classifyLandingPath(path: string | null): LandingType {
  if (!path) return "sin dato";
  const scoped = path === "/ve" ? "/" : path.startsWith("/ve/") ? path.slice(3) : path;
  if (scoped === "/" || scoped === "/tiktok") return "portada";
  if (scoped === "/dashboard") return "dashboard";
  const empleos = /^\/empleos\/([^/]+)/.exec(scoped);
  if (empleos) return UUID.test(empleos[1]!) ? "vacante" : "hub";
  if (scoped === "/empleos") return "hub";
  if (scoped === "/empresas" || scoped.startsWith("/empresas/")) return "empresa";
  return "otra";
}

/** Channel of a first touch: utm_source wins, then the referrer host. */
export function classifySource(touch: {
  utmSource: string | null;
  utmMedium?: string | null;
  referrerHost: string | null;
  landingPath: string | null;
}): string {
  if (!touch.landingPath) return "sin dato";
  if (touch.utmSource) {
    if (touch.utmSource === "google_jobs_apply") return "google empleos";
    return touch.utmSource;
  }
  const host = touch.referrerHost;
  if (!host) return "directo / app sin referrer";
  if (host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com") return "chatgpt";
  if (/(^|\.)(perplexity\.ai|copilot\.microsoft\.com|gemini\.google\.com)$/.test(host)) return "otra ia";
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  if (/(^|\.)bing\.com$/.test(host)) return "bing";
  if (/(^|\.)(tiktok\.com|tiktokv\.com)$/.test(host)) return "tiktok";
  if (/(^|\.)(facebook\.com|instagram\.com)$/.test(host) || host === "l.facebook.com") return "meta";
  if (host === "t.co" || /(^|\.)(x\.com|twitter\.com)$/.test(host)) return "x";
  return `ref: ${host}`;
}

// ---- Browser side ----

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Remembers this page load as the first touch if none is stored yet. */
export function rememberFirstTouch(): void {
  const store = storage();
  if (!store) return;
  try {
    const now = new Date();
    const existing = parseStored(store.getItem(FIRST_TOUCH_STORAGE_KEY), now);
    if (existing) return;
    const touch = buildFirstTouch({
      pathname: window.location.pathname,
      search: window.location.search,
      referrer: document.referrer,
      ownHost: window.location.host,
      now
    });
    if (touch) store.setItem(FIRST_TOUCH_STORAGE_KEY, JSON.stringify(touch));
  } catch {
    // Attribution must never break navigation (blocked storage, quota).
  }
}

function parseStored(raw: string | null, now: Date): FirstTouch | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    const captured =
      value && typeof value === "object" && typeof (value as { capturedAt?: unknown }).capturedAt === "string"
        ? Date.parse((value as { capturedAt: string }).capturedAt)
        : NaN;
    if (!Number.isFinite(captured) || now.getTime() - captured > FIRST_TOUCH_TTL_MS) return null;
    return parseFirstTouch(value, now);
  } catch {
    return null;
  }
}

/** The stored first touch, for the e-mail signup's user metadata. */
export function readFirstTouch(): FirstTouch | null {
  const store = storage();
  if (!store) return null;
  try {
    return parseStored(store.getItem(FIRST_TOUCH_STORAGE_KEY), new Date());
  } catch {
    return null;
  }
}

/**
 * Sends the stored first touch once per account and browser, after the visitor signs in
 * for the first time (the onboarding step is still pending). The server
 * ignores it for accounts older than a day and never overwrites a value.
 */
export async function sendFirstTouchOnce(
  accessToken: string,
  userId: string,
  /** `user_metadata.bt_first_touch`, saved by the e-mail signup form. */
  fromSignupMetadata?: unknown
): Promise<void> {
  const store = storage();
  if (!store) return;
  try {
    // Per account, not per browser: on a shared phone or a cybercafé PC an
    // old account signing in must not use up the next signup's send.
    const sentKey = `${FIRST_TOUCH_SENT_KEY}:${userId}`;
    if (store.getItem(sentKey)) return;
    const now = new Date();
    // The copy saved with an e-mail signup belongs to the browser where the
    // person signed up; the confirmation link often opens in another one
    // (TikTok's in-app browser → the mail app → Chrome), so it wins.
    const touch =
      parseFirstTouch(fromSignupMetadata, now) ?? parseStored(store.getItem(FIRST_TOUCH_STORAGE_KEY), now);
    // Nothing remembered (storage cleared, new browser after a Google
    // login): the account simply stays without attribution.
    if (!touch) return;
    store.setItem(sentKey, "1");
    await fetch("/api/me/first-touch", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(touch),
      keepalive: true
    });
  } catch {
    // Best effort: a failed request never retries or blocks sign-in.
  }
}
