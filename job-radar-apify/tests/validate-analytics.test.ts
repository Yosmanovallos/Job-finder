import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  captureAcquisition,
  parseAcquisition,
  sanitizeAnalyticsPath,
  trackEvent
} from "../src/lib/analytics.js";

const originalWindow = globalThis.window;

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
