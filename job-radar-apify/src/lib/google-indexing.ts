/**
 * Google Indexing API client (SEO Fase 3). Hand-rolled RS256 JWT + OAuth
 * token exchange via Node's built-in `crypto`/`fetch` — no `googleapis`/
 * `google-auth-library` dependency, matching this codebase's zero-framework
 * style (see server.ts, job-repository.ts).
 *
 * Requires two env vars, set by the user directly in `.env` (never pasted
 * into chat — see docs/SESSION-NOTES.md on why):
 *   GOOGLE_INDEXING_CLIENT_EMAIL — service account email
 *   GOOGLE_INDEXING_PRIVATE_KEY  — service account private key, PEM, with
 *                                  literal "\n" for newlines (how .env
 *                                  necessarily stores a multi-line value)
 *
 * The service account must be added as Owner on the Search Console property
 * (Configuración → Usuarios y permisos) — "Full" access is NOT enough and
 * fails with a silent 403 on publish.
 */
import crypto from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PUBLISH_URL = "https://indexing.googleapis.com/v3/urlNotifications:publish";
const SCOPE = "https://www.googleapis.com/auth/indexing";

export type NotificationType = "URL_UPDATED" | "URL_DELETED";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

// Pure/synchronous and network-free on purpose — lets tests/validate-seo
// verify the JWT's shape (header, claims, signature) with a throwaway
// keypair, without needing real Google credentials or hitting the network.
// `scope` defaults to the Indexing API scope this file was built for —
// scripts/check-search-console.ts reuses this same signer with the
// Search Console (webmasters) scope instead, same service account
// (already granted Owner on the property, see readCredentials below).
export function buildJwtAssertion(
  clientEmail: string,
  privateKeyPem: string,
  nowSeconds: number,
  scope: string = SCOPE
): string {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: clientEmail,
    scope,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

export function readCredentials(): { clientEmail: string; privateKey: string } {
  const clientEmail = process.env.GOOGLE_INDEXING_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_INDEXING_PRIVATE_KEY;
  if (!clientEmail || !privateKeyRaw) {
    throw new Error(
      "GOOGLE_INDEXING_CLIENT_EMAIL / GOOGLE_INDEXING_PRIVATE_KEY no están configuradas en .env"
    );
  }
  // .env/GitHub secrets can't hold real newlines inside a single-line
  // value — the private key is stored with literal "\n" and unescaped here
  // before use. Also strips a leading/trailing quote if present: the most
  // common way this gets pasted wrong is copying the `"private_key": "..."`
  // field straight out of the downloaded service account JSON, wrapping
  // quotes and all, which otherwise breaks PEM parsing with an opaque
  // OpenSSL "DECODER routines::unsupported" error.
  const trimmed = privateKeyRaw.trim().replace(/^"(.*)"$/s, "$1");
  return { clientEmail, privateKey: trimmed.replace(/\\n/g, "\n") };
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) {
    return cachedToken.accessToken;
  }

  const { clientEmail, privateKey } = readCredentials();
  const assertion = buildJwtAssertion(clientEmail, privateKey, now);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google OAuth token exchange failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: now + data.expires_in };
  return cachedToken.accessToken;
}

export async function publishUrlNotification(url: string, type: NotificationType): Promise<void> {
  const accessToken = await getAccessToken();

  const response = await fetch(PUBLISH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url, type })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Indexing API publish failed (${response.status}): ${body}`);
  }
}
