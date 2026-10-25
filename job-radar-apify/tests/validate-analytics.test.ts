import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAuthAnalyticsTracker, trackAuthCallback } from "../src/lib/auth-analytics.js";
import {
  captureAcquisition,
  parseAcquisition,
  sanitizeAnalyticsPath,
  trackEvent
} from "../src/lib/analytics.js";

const originalWindow = globalThis.window;

const authNow = Date.parse("2026-10-24T18:00:00Z");
const authUser = {
  id: "synthetic-user",
  created_at: new Date(authNow - 1000).toISOString(),
  last_sign_in_at: new Date(authNow - 500).toISOString(),
  email_confirmed_at: new Date(authNow - 1000).toISOString(),
  app_metadata: { provider: "google" }
};

function authHarness(stored = new Map<string, string>(), blocked = false) {
  const calls: unknown[] = [];
  const track = createAuthAnalyticsTracker({
    now: () => authNow,
    storage: () => {
      if (blocked) throw new Error("Storage unavailable");
      return {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => {
          stored.set(key, value);
        }
      };
    },
    emit: (event, params) => {
      calls.push({ event, params });
    }
  });
  return { calls, track, stored };
}

test("AUTH-002 signup deduplicates refocus, repeated callbacks and reloads", () => {
  const first = authHarness();
  first.track(authUser);
  first.track(authUser);
  const reload = authHarness(first.stored);
  reload.track(authUser);
  assert.deepEqual(first.calls, [{ event: "sign_up", params: { method: "google" } }]);
  assert.equal(reload.calls.length, 0);
  assert.doesNotMatch(JSON.stringify(first.calls), /synthetic-user|created_at|last_sign/);
});

test("AUTH-003 returning users emit login once per sign-in timestamp", () => {
  const { track, calls } = authHarness();
  const returning = { ...authUser, created_at: "2026-08-01T00:00:00Z" };
  track(returning);
  track(returning);
  track({ ...returning, last_sign_in_at: new Date(authNow - 100).toISOString() });
  assert.deepEqual(calls, [
    { event: "login", params: { method: "google" } },
    { event: "login", params: { method: "google" } }
  ]);
});

test("AUTH-001/004 email waits for confirmation even days after creation", () => {
  const { track, calls } = authHarness();
  const email = {
    ...authUser,
    created_at: "2026-10-20T00:00:00Z",
    app_metadata: { provider: "email" }
  };
  track({ ...email, email_confirmed_at: undefined });
  assert.equal(calls.length, 0);
  track(email);
  assert.deepEqual(calls, [{ event: "sign_up", params: { method: "email" } }]);
  const returning = authHarness();
  returning.track({ ...email, email_confirmed_at: "2026-10-20T01:00:00Z" });
  assert.deepEqual(returning.calls, [{ event: "login", params: { method: "email" } }]);
});

test("AUTH-004 malformed, future, stale and unsupported sessions emit nothing", () => {
  const { track, calls } = authHarness();
  track({ ...authUser, created_at: "invalid" });
  track({ ...authUser, created_at: new Date(authNow + 1000).toISOString() });
  track({ ...authUser, email_confirmed_at: new Date(authNow + 1000).toISOString() });
  track({ ...authUser, last_sign_in_at: undefined });
  track({ ...authUser, last_sign_in_at: new Date(authNow + 1000).toISOString() });
  track({ ...authUser, last_sign_in_at: "2026-10-23T00:00:00Z" });
  track({ ...authUser, app_metadata: { provider: "unsupported" } });
  assert.equal(calls.length, 0);
});

test("AUTH-003 callback boundary ignores refresh and non-callback SIGNED_IN", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      get localStorage() {
        throw new Error("Must not access storage");
      }
    }
  });
  assert.doesNotThrow(() => {
    trackAuthCallback("SIGNED_IN", authUser, "/dashboard");
    trackAuthCallback("TOKEN_REFRESHED", authUser, "/auth/callback");
    trackAuthCallback("PASSWORD_RECOVERY", authUser, "/auth/callback");
    trackAuthCallback("SIGNED_IN", undefined, "/auth/callback");
  });
});

test("AUTH-005 denied/corrupt storage is safe and ledger stays bounded", () => {
  const blocked = authHarness(new Map(), true);
  assert.doesNotThrow(() => {
    blocked.track(authUser);
    blocked.track(authUser);
  });
  assert.equal(blocked.calls.length, 1);
  const normal = authHarness(new Map([["bt_auth_events_v1", "invalid json"]]));
  for (let i = 0; i < 150; i++) normal.track({ ...authUser, id: `fixture-${i}` });
  assert.equal(JSON.parse(normal.stored.get("bt_auth_events_v1") || "[]").length, 100);
});

test("AUTH-002 INITIAL_SESSION at callback counts once and does not leak identity", () => {
  const stored = new Map<string, string>();
  const calls: unknown[][] = [];
  const now = Date.now();
  const recent = {
    ...authUser,
    created_at: new Date(now - 2000).toISOString(),
    email_confirmed_at: new Date(now - 2000).toISOString(),
    last_sign_in_at: new Date(now - 1000).toISOString()
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { pathname: "/auth/callback", search: "?code=secret" },
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => {
          stored.set(key, value);
        }
      },
      gtag: (...args: unknown[]) => {
        calls.push(args);
      }
    }
  });
  trackAuthCallback("INITIAL_SESSION", recent, "/auth/callback");
  trackAuthCallback("SIGNED_IN", recent, "/auth/callback");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "sign_up");
  assert.doesNotMatch(JSON.stringify(calls), /synthetic-user|secret/);
});

test("AUTH-005 analytics dispatch failure never interrupts authentication", () => {
  const track = createAuthAnalyticsTracker({
    storage: () => ({ getItem: () => null, setItem: () => {} }),
    now: () => authNow,
    emit: () => {
      throw new Error("Analytics blocked");
    }
  });
  assert.doesNotThrow(() => track(authUser));
});

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow
  });
});

test("parseAcquisition conserva solo UTMs permitidos y acotados", () => {
  const result = parseAcquisition(
    `?utm_source=tiktok&utm_medium=social&utm_campaign=${"a".repeat(150)}&code=secret&email=user@example.com`
  );
  assert.deepEqual(result, {
    utm_source: "tiktok",
    utm_medium: "social",
    utm_campaign: "a".repeat(100)
  });
});

test("sanitizeAnalyticsPath nunca conserva query ni fragmento", () => {
  assert.equal(sanitizeAnalyticsPath("/auth/callback?code=secret#fragment"), "/auth/callback");
  assert.equal(sanitizeAnalyticsPath("https://evil.example/path"), "/");
});

test("trackEvent añade atribución y ruta sin transmitir la query", () => {
  const stored = new Map<string, string>();
  const calls: unknown[][] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        pathname: "/empleos/abc",
        search: "?utm_source=instagram&code=secret",
        origin: "https://buscotrabajo.co"
      },
      sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value)
      },
      gtag: (...args: unknown[]) => calls.push(args)
    }
  });

  captureAcquisition();
  trackEvent("apply_gate_open", {
    job_id: "job-1",
    job_source: "LinkedIn",
    surface: "job_page"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "event");
  assert.equal(calls[0][1], "apply_gate_open");
  assert.deepEqual(calls[0][2], {
    utm_source: "instagram",
    page_path: "/empleos/abc",
    job_id: "job-1",
    job_source: "LinkedIn",
    surface: "job_page"
  });
  assert.doesNotMatch(JSON.stringify(calls), /secret/);
});
