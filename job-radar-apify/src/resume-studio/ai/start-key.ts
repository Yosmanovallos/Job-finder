import { createHash } from "node:crypto";

// AI Resume Studio R4c — /tailor/start idempotency. The browser makes a
// UUID at click time; the adaptation id is derived from (user, key), so a
// double click, a React double effect or a retry all land on the same id
// (and the unique «start» row keeps the quota from being consumed twice).
// Pure: no DB, no env.

/** The adaptation id for (user, client key): stable, and different for every user. */
export function adaptationIdFor(userId: string, clientKey: string): string {
  const h = createHash("sha256").update(`rs-start:${userId}:${clientKey.toLowerCase()}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
