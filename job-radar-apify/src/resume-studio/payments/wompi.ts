import crypto from "node:crypto";

// AI Resume Studio R4: Wompi helpers for the pass product (server only).
// Keys are read from the environment at call time, never from .env files
// here and never logged. Until the owner approves live payments
// (RESUME_STUDIO_PAYMENTS_LIVE=true, R5) only sandbox keys (pub_test_) work:
// ADR 0017 §6 «pagos solo en el sandbox de Wompi».

export interface WompiKeys {
  publicKey: string;
  integritySecret: string;
}

export type KeysProblem = "missing" | "live_not_allowed";

export function readWompiKeys(env: Record<string, string | undefined>): { ok: true; keys: WompiKeys } | { ok: false; problem: KeysProblem } {
  const publicKey = env.WOMPI_PUBLIC_KEY?.trim();
  const integritySecret = env.WOMPI_INTEGRITY_SECRET?.trim();
  if (!publicKey || !integritySecret || !wompiApiBase(publicKey)) return { ok: false, problem: "missing" };
  if (!publicKey.startsWith("pub_test_") && env.RESUME_STUDIO_PAYMENTS_LIVE !== "true") return { ok: false, problem: "live_not_allowed" };
  return { ok: true, keys: { publicKey, integritySecret } };
}

/** Fixed host chosen by the key prefix: nothing from the request can pick it. */
export function wompiApiBase(publicKey: string): string | null {
  if (publicKey.startsWith("pub_test_")) return "https://sandbox.wompi.co/v1";
  if (publicKey.startsWith("pub_prod_")) return "https://production.wompi.co/v1";
  return null;
}

/** Web Checkout integrity signature, same formula as src/payments/checkout.ts. */
export function integritySignature(reference: string, amountInCents: number, currency: string, secret: string): string {
  return crypto.createHash("sha256").update(`${reference}${amountInCents}${currency}${secret}`).digest("hex");
}

export interface WompiTransaction {
  id: string;
  status: string;
  reference: string;
  amountInCents: number;
  currency: string;
}

export const WOMPI_TRANSACTION_ID = /^[A-Za-z0-9-]{3,64}$/;
const RESPONSE_MAX_BYTES = 64 * 1024;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; redirect: "error"; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * GET /v1/transactions/{id}: Wompi's public lookup. Used when the user comes
 * back from the checkout: the return URL only says WHICH transaction to ask
 * about; the answer that unlocks anything comes from Wompi, not the URL.
 */
export async function fetchWompiTransaction(id: string, publicKey: string, fetchImpl: FetchLike, timeoutMs = 5000): Promise<WompiTransaction | null> {
  const base = wompiApiBase(publicKey);
  if (!base || !WOMPI_TRANSACTION_ID.test(id)) return null;
  const res = await fetchImpl(`${base}/transactions/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (text.length > RESPONSE_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const data = (parsed as { data?: Record<string, unknown> } | null)?.data;
  if (!data) return null;
  const { status, reference, amount_in_cents: amount, currency } = data;
  if (typeof status !== "string" || typeof reference !== "string" || typeof amount !== "number" || typeof currency !== "string") return null;
  if (String(data.id) !== id) return null;
  return { id, status, reference, amountInCents: amount, currency };
}
