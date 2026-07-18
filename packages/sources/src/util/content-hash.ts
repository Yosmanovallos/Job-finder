import { createHash } from "node:crypto";

/** sha256 hex of a raw response body, used for provenance and dedupe. */
export function contentHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}
