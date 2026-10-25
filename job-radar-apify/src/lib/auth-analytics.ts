import { trackEvent } from "./analytics.js";

interface AuthAnalyticsUser {
  id: string;
  created_at: string;
  last_sign_in_at?: string;
  email_confirmed_at?: string;
  app_metadata: { provider?: string };
}

const STORAGE_KEY = "bt_auth_events_v1";
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 100;
type AuthEvent = "sign_up" | "login";
type Method = "google" | "email";

/** Browser measurement only: never use these events as an account ledger. */
export function createAuthAnalyticsTracker(options: {
  storage: () => Pick<Storage, "getItem" | "setItem">;
  emit: (event: AuthEvent, params: { method: Method }) => void;
  now: () => number;
}) {
  const seen = new Set<string>();
  return (user: AuthAnalyticsUser): void => {
    const method = user.app_metadata.provider;
    if (method !== "google" && method !== "email") return;
    const signedIn = Date.parse(user.last_sign_in_at || "");
    const created = Date.parse(user.created_at);
    const confirmed = Date.parse(user.email_confirmed_at || "");
    const now = options.now();
    // A stored session/refocus is not evidence of a new authentication.
    if (
      !user.id ||
      !Number.isFinite(signedIn) ||
      !Number.isFinite(confirmed) ||
      !Number.isFinite(created) ||
      created > signedIn ||
      confirmed > signedIn ||
      signedIn > now ||
      now - signedIn > WINDOW_MS
    )
      return;
    // Email confirmation may occur days after account creation. Google
    // confirms at creation; for email compare the FIRST confirmation instead.
    const firstAuth = method === "google" ? created : confirmed;
    const event: AuthEvent =
      signedIn >= firstAuth && signedIn - firstAuth <= WINDOW_MS ? "sign_up" : "login";
    const key = `${event}:${user.id}:${event === "sign_up" ? created : signedIn}`;
    if (seen.has(key)) return;
    let persisted: string[] = [];
    try {
      const value: unknown = JSON.parse(options.storage().getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(value))
        persisted = value
          .filter((item): item is string => typeof item === "string")
          .slice(-MAX_ENTRIES);
    } catch {
      // Storage denial must not break authentication; memory still dedupes.
    }
    seen.add(key);
    if (seen.size > MAX_ENTRIES) seen.delete(seen.values().next().value!);
    if (persisted.includes(key)) return;
    try {
      options
        .storage()
        .setItem(STORAGE_KEY, JSON.stringify([...persisted, key].slice(-MAX_ENTRIES)));
    } catch {
      // Best effort across reloads; no identifiers are sent to Analytics.
    }
    try {
      options.emit(event, { method });
    } catch {
      // A blocked/broken analytics client must never interrupt auth state.
    }
  };
}

export const trackConfirmedAuth = createAuthAnalyticsTracker({
  storage: () => window.localStorage,
  emit: trackEvent,
  now: () => Date.now()
});

export function trackAuthCallback(
  event: string,
  user: AuthAnalyticsUser | undefined,
  pathname: string
): void {
  if (
    pathname === "/auth/callback" &&
    user &&
    (event === "SIGNED_IN" || event === "INITIAL_SESSION")
  ) {
    trackConfirmedAuth(user);
  }
}
