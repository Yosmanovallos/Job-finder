import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFirstTouch,
  classifyLandingPath,
  classifySource,
  FIRST_TOUCH_TTL_MS,
  isNewAccount,
  parseFirstTouch,
  sanitizeLandingPath,
  sanitizeReferrerHost,
  sanitizeUtmValue,
  TIKTOK_SHORT_LINK_TARGET
} from "../src/lib/first-touch.js";

const NOW = new Date("2026-11-07T15:00:00.000Z");

test("first touch: landing path keeps the pathname only, never query or hash", () => {
  assert.equal(sanitizeLandingPath("/empleos/medellin?q=juan%40mail.com#top"), "/empleos/medellin");
  assert.equal(sanitizeLandingPath("/reset-password#access_token=secret"), "/reset-password");
  assert.equal(sanitizeLandingPath("/empleos/ab cd<script>"), "/empleos/abcdscript");
  assert.equal(sanitizeLandingPath("/" + "a".repeat(500))!.length, 200);
  assert.equal(sanitizeLandingPath("https://evil.example/x"), null);
  assert.equal(sanitizeLandingPath("//evil.example/x"), null);
  assert.equal(sanitizeLandingPath(42), null);
});

test("first touch: referrer is the host name only, never the full URL", () => {
  assert.equal(sanitizeReferrerHost("https://www.Google.com/search?q=nombre+apellido"), "google.com");
  assert.equal(sanitizeReferrerHost("https://chatgpt.com/c/abc-123"), "chatgpt.com");
  assert.equal(sanitizeReferrerHost("chatgpt.com"), "chatgpt.com");
  assert.equal(sanitizeReferrerHost(""), null);
  assert.equal(sanitizeReferrerHost("not a url"), null);
  assert.equal(sanitizeReferrerHost("localhost"), null);
});

test("first touch: utm values are trimmed, lowercased, printable and bounded", () => {
  assert.equal(sanitizeUtmValue("  TikTok\u0000 "), "tiktok");
  assert.equal(sanitizeUtmValue("x".repeat(300))!.length, 100);
  assert.equal(sanitizeUtmValue("   "), null);
  assert.equal(sanitizeUtmValue(undefined), null);
});

test("first touch: the /tiktok link lands on / tagged with the three utm keys only", () => {
  const touch = buildFirstTouch({
    pathname: "/",
    search: new URL(TIKTOK_SHORT_LINK_TARGET, "https://buscotrabajo.co").search + "&email=a@b.co&gclid=1",
    referrer: "",
    ownHost: "buscotrabajo.co",
    now: NOW
  });
  assert.deepEqual(touch, {
    landingPath: "/",
    referrerHost: null,
    utmSource: "tiktok",
    utmMedium: "social",
    utmCampaign: "bio",
    capturedAt: NOW.toISOString()
  });
  assert.equal(classifySource(touch!), "tiktok");
  assert.equal(classifyLandingPath(touch!.landingPath), "portada");
});

test("first touch: own host, Google OAuth and auth flows are not a first contact", () => {
  const base = { search: "", ownHost: "buscotrabajo.co", now: NOW };
  assert.equal(
    buildFirstTouch({ ...base, pathname: "/dashboard", referrer: "https://buscotrabajo.co/empleos/cali" })!.referrerHost,
    null
  );
  assert.equal(
    buildFirstTouch({ ...base, pathname: "/", referrer: "https://accounts.google.com/" })!.referrerHost,
    null
  );
  assert.equal(buildFirstTouch({ ...base, pathname: "/auth/callback", referrer: "" }), null);
  assert.equal(buildFirstTouch({ ...base, pathname: "/reset-password", referrer: "" }), null);
});

test("first touch: the server re-validates what the browser sends", () => {
  const parsed = parseFirstTouch(
    {
      landingPath: "/empleos/cali?token=x",
      referrerHost: "https://chatgpt.com/share/abc",
      utmSource: "ChatGPT.com",
      utmMedium: 7,
      capturedAt: "2026-11-07T14:00:00.000Z",
      email: "someone@example.com"
    },
    NOW
  );
  assert.deepEqual(parsed, {
    landingPath: "/empleos/cali",
    referrerHost: "chatgpt.com",
    utmSource: "chatgpt.com",
    utmMedium: null,
    utmCampaign: null,
    capturedAt: "2026-11-07T14:00:00.000Z"
  });
  assert.equal(parseFirstTouch({ referrerHost: "google.com" }, NOW), null, "sin ruta no hay primer contacto");
  assert.equal(parseFirstTouch(null, NOW), null);
  // Future or stale clocks fall back to the server's time.
  const future = parseFirstTouch({ landingPath: "/", capturedAt: "2027-01-01T00:00:00.000Z" }, NOW);
  assert.equal(future!.capturedAt, NOW.toISOString());
  const stale = new Date(NOW.getTime() - FIRST_TOUCH_TTL_MS - 1000).toISOString();
  assert.equal(parseFirstTouch({ landingPath: "/", capturedAt: stale }, NOW)!.capturedAt, NOW.toISOString());
});

test("first touch: only accounts created in the last 24 hours are attributed", () => {
  assert.equal(isNewAccount("2026-11-07T10:00:00.000Z", NOW), true);
  assert.equal(isNewAccount("2026-11-06T14:59:00.000Z", NOW), false);
  assert.equal(isNewAccount("2026-10-01T00:00:00.000Z", NOW), false);
  assert.equal(isNewAccount(null, NOW), false);
  assert.equal(isNewAccount("garbage", NOW), false);
});

test("first touch: landing page types for the weekly checkpoint", () => {
  assert.equal(classifyLandingPath("/"), "portada");
  assert.equal(classifyLandingPath("/ve"), "portada");
  assert.equal(classifyLandingPath("/empleos/0b8e7c1a-1234-4abc-9def-0123456789ab/cajero-cali"), "vacante");
  assert.equal(classifyLandingPath("/ve/empleos/0b8e7c1a-1234-4abc-9def-0123456789ab"), "vacante");
  assert.equal(classifyLandingPath("/empleos/medellin"), "hub");
  assert.equal(classifyLandingPath("/empleos/medellin/sin-experiencia"), "hub");
  assert.equal(classifyLandingPath("/empresas/frisby"), "empresa");
  assert.equal(classifyLandingPath("/dashboard"), "dashboard");
  assert.equal(classifyLandingPath("/opiniones"), "otra");
  assert.equal(classifyLandingPath(null), "sin dato");
});

test("first touch: channels — utm first, then the referrer host", () => {
  const touch = (utmSource: string | null, referrerHost: string | null) => ({ utmSource, referrerHost, landingPath: "/" });
  assert.equal(classifySource(touch("google_jobs_apply", "google.com")), "google empleos");
  assert.equal(classifySource(touch("whatsapp", null)), "whatsapp");
  assert.equal(classifySource(touch(null, "chatgpt.com")), "chatgpt");
  assert.equal(classifySource(touch(null, "google.com.co")), "google");
  assert.equal(classifySource(touch(null, "bing.com")), "bing");
  assert.equal(classifySource(touch(null, "gemini.google.com")), "otra ia");
  assert.equal(classifySource(touch(null, "vm.tiktok.com")), "tiktok");
  assert.equal(classifySource(touch(null, "l.facebook.com")), "meta");
  assert.equal(classifySource(touch(null, "t.co")), "x");
  assert.equal(classifySource(touch(null, null)), "directo / app sin referrer");
  assert.equal(classifySource(touch(null, "sena.edu.co")), "ref: sena.edu.co");
  assert.equal(classifySource({ utmSource: null, referrerHost: null, landingPath: null }), "sin dato");
});
