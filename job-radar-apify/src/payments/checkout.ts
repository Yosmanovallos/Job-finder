import crypto from "crypto";
import dotenv from "dotenv";
import { createPendingTransaction } from "../db/job-repository.js";
import { PRO_MONTHLY_PRICE_COP_CENTS, PRO_MAX_MONTHLY_PRICE_COP_CENTS } from "../config.js";

dotenv.config();

const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY;
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET;

export type CheckoutPlan = "pro" | "pro_max";

export interface StartCheckoutInput {
  userId: string;
  userEmail: string;
  /** Fase 10 (docs/CV-GENERATION-PLAN.md §10) — default 'pro' preserves
   * every caller from before this existed. */
  plan?: CheckoutPlan;
}

export interface StartCheckoutResult {
  publicKey: string;
  reference: string;
  amountInCents: number;
  currency: "COP";
  signatureIntegrity: string;
}

function assertWompiConfigured(): void {
  if (!WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET) {
    throw new Error(
      "[Wompi] Faltan WOMPI_PUBLIC_KEY o WOMPI_INTEGRITY_SECRET en job-radar-apify/.env"
    );
  }
}

/**
 * Builds the Wompi Web Checkout integrity signature (reference + amount_in_cents
 * + currency + integrity secret, SHA256). Wompi requires this be computed
 * server-side only — the integrity secret must never reach the frontend.
 */
function buildIntegritySignature(
  reference: string,
  amountInCents: number,
  currency: string
): string {
  const raw = `${reference}${amountInCents}${currency}${WOMPI_INTEGRITY_SECRET}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Starts a Wompi Web Checkout session for a BuscoTrabajo monthly plan
 * (Pro or Pro Max, Fase 10). Persists a 'pending' transaction row keyed by
 * the reference — carrying which plan it's for — so the webhook can later
 * confirm it idempotently AND upgrade to the right tier, never a hardcoded one.
 */
export async function startPaymentCheckout(
  input: StartCheckoutInput
): Promise<StartCheckoutResult> {
  assertWompiConfigured();

  const plan: CheckoutPlan = input.plan ?? "pro";
  const reference = `jobradar_${plan}_${input.userId}_${Date.now()}`;
  const amountInCents =
    plan === "pro_max" ? PRO_MAX_MONTHLY_PRICE_COP_CENTS : PRO_MONTHLY_PRICE_COP_CENTS;
  const currency = "COP" as const;

  await createPendingTransaction({
    userId: input.userId,
    reference,
    amountInCents,
    currency,
    plan
  });

  const signatureIntegrity = buildIntegritySignature(reference, amountInCents, currency);

  console.log(
    `💳 [Checkout] Sesión Wompi creada para ${input.userEmail} (plan: ${plan}) — referencia ${reference}`
  );

  return {
    publicKey: WOMPI_PUBLIC_KEY!,
    reference,
    amountInCents,
    currency,
    signatureIntegrity
  };
}
