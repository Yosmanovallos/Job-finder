import crypto from "node:crypto";

// Wompi event checksum (doc 08 H1). Pure, secret passed in, so tests can
// sign fixture events with a synthetic secret. SHA-256 of the values named
// by `signature.properties` (in order, read from `data`) + `timestamp` +
// the events secret. The comparison is constant time; anything that is not
// a 64-char hex checksum is rejected before comparing (timingSafeEqual
// throws on different lengths). Wompi documents the checksum in either case,
// so it is normalized to lower case.

export interface WompiSignedEvent {
  data?: unknown;
  signature?: { properties?: unknown; checksum?: unknown } | null;
  timestamp?: unknown;
}

const HEX64 = /^[0-9a-f]{64}$/;
const PROPERTY = /^[A-Za-z0-9_.]{1,80}$/;

function nestedValue(obj: unknown, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>((acc, key) => (acc == null ? acc : (acc as Record<string, unknown>)[key]), obj);
  return value == null ? "" : String(value);
}

export function computeWompiChecksum(event: WompiSignedEvent, secret: string): string | null {
  const properties = event?.signature?.properties;
  if (!Array.isArray(properties) || properties.length === 0 || properties.length > 20) return null;
  if (!properties.every((p) => typeof p === "string" && PROPERTY.test(p))) return null;
  if (typeof event.timestamp !== "number" && typeof event.timestamp !== "string") return null;
  const concatenated = (properties as string[]).map((p) => nestedValue(event.data, p)).join("");
  return crypto.createHash("sha256").update(`${concatenated}${event.timestamp}${secret}`).digest("hex");
}

export function verifyWompiChecksum(event: WompiSignedEvent, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = event?.signature?.checksum;
  if (typeof given !== "string") return false;
  const normalized = given.trim().toLowerCase();
  if (!HEX64.test(normalized)) return false;
  const expected = computeWompiChecksum(event, secret);
  if (!expected) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(normalized, "hex"));
}
