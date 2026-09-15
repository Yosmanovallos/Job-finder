import { createHash, timingSafeEqual } from "node:crypto";

// Operator-only surfaces (P2 — /api/admin/runs). There is no admin role in
// the session/tier model, so these routes use a dedicated bearer token that
// lives only in the server environment. Fail-closed: unset or too short
// means the feature does not exist (404), never "open".
export const OPS_ADMIN_TOKEN_MIN_LENGTH = 32;

export type OpsAuthResult = "disabled" | "unauthorized" | "authorized";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function checkOpsAdminAuthorization(
  authorizationHeader: string | string[] | undefined,
  configuredToken: string | undefined
): OpsAuthResult {
  if (!configuredToken || configuredToken.length < OPS_ADMIN_TOKEN_MIN_LENGTH) return "disabled";
  if (typeof authorizationHeader !== "string") return "unauthorized";
  const match = /^Bearer (\S+)$/.exec(authorizationHeader.trim());
  if (!match) return "unauthorized";
  // Hash both sides so the comparison is constant-time regardless of length.
  return timingSafeEqual(digest(match[1]), digest(configuredToken)) ? "authorized" : "unauthorized";
}
