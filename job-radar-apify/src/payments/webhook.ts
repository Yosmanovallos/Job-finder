import dotenv from "dotenv";
import { upgradeUserToPro, upgradeUserToProMax } from "../db/job-repository.js";
import { approveWompiTransaction } from "./approve.js";
import { verifyWompiChecksum } from "./wompi-signature.js";

dotenv.config();

const WOMPI_EVENTS_SECRET = process.env.WOMPI_EVENTS_SECRET;

if (!WOMPI_EVENTS_SECRET) {
  throw new Error("[Wompi] Falta WOMPI_EVENTS_SECRET en job-radar-apify/.env");
}

export interface WompiEventPayload {
  event: string;
  data: {
    transaction: {
      id: string;
      status: string;
      reference: string;
      amount_in_cents: number;
      currency?: string;
    };
  };
  signature: {
    properties: string[];
    checksum: string;
  };
  timestamp: number;
  environment: string;
}

/**
 * Verifies a Wompi webhook checksum: SHA256 of the `signature.properties`
 * values (concatenated, in order) + the event timestamp + the events secret,
 * per Wompi's event verification spec. Constant-time comparison (doc 08 H1).
 * A payload that fails this is never trusted, no matter what it claims.
 */
export function verifyWompiSignature(payload: WompiEventPayload): boolean {
  return verifyWompiChecksum(payload, WOMPI_EVENTS_SECRET);
}

const PRO_SUBSCRIPTION_DAYS = 30;
const CLOSED_STATUSES = new Set(["DECLINED", "VOIDED", "ERROR"]);

export type WebhookOutcome = "invalid_signature" | "ignored" | "closed" | "approved" | "already_approved" | "unknown_reference" | "amount_mismatch";

/**
 * Handles a Wompi webhook event: verifies the signature, and on an APPROVED
 * transaction approves it through `approveWompiTransaction` (amount check,
 * idempotent, one DB transaction), then branches by PRODUCT:
 * - `subscription` (every row before R4): upgrades the paying user to the
 *   plan stored on the row for 30 days, exactly as before;
 * - `resume_pass` (AI Resume Studio R4): the pass was created inside the
 *   approval transaction; the subscription tier is never touched.
 */
export async function handleWompiWebhook(
  payload: WompiEventPayload
): Promise<{ verified: boolean; outcome: WebhookOutcome }> {
  if (!verifyWompiSignature(payload)) {
    console.warn("[WompiWebhook] Firma inválida — evento rechazado.");
    return { verified: false, outcome: "invalid_signature" };
  }

  const transaction = payload.data?.transaction;
  if (!transaction || typeof transaction.reference !== "string") {
    return { verified: true, outcome: "ignored" };
  }

  if (transaction.status !== "APPROVED") {
    // Only pass rows record the rejection (so the pass screen can say so);
    // subscription rows stay as before: a non-approved event is a no-op.
    if (CLOSED_STATUSES.has(transaction.status) && transaction.reference.startsWith("rs_pass_")) {
      const { markResumePassClosed } = await import("../db/resume-studio-pass-repository.js");
      await markResumePassClosed(transaction.reference, transaction.status);
      return { verified: true, outcome: "closed" };
    }
    return { verified: true, outcome: "ignored" };
  }

  const result = await approveWompiTransaction({
    reference: transaction.reference,
    wompiTransactionId: String(transaction.id),
    amountInCents: transaction.amount_in_cents,
    currency: transaction.currency
  });

  if (result.outcome === "amount_mismatch") {
    // H2: never unlock on an amount that is not the one we charged. No
    // personal data in the log line.
    console.warn("[WompiWebhook] Monto aprobado distinto del guardado — evento ignorado, nada se desbloquea.");
    return { verified: true, outcome: result.outcome };
  }
  if (result.outcome !== "approved") {
    return { verified: true, outcome: result.outcome }; // Already processed or unknown reference — idempotent no-op.
  }

  if (result.product === "resume_pass") {
    console.log(`🎟️ [WompiWebhook] Pase ${result.plan} aprobado (referencia ${transaction.reference}).`);
    return { verified: true, outcome: "approved" };
  }

  const until = new Date(Date.now() + PRO_SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
  // Fase 10: qué tier otorgar viene de la fila de la transacción
  // (`plan`, escrito por startPaymentCheckout al crearla), nunca
  // hardcodeado — un pago de Pro Max real que aquí siempre subiera a
  // 'pro' le cobraría de más a un usuario sin darle lo que pagó.
  if (result.plan === "pro_max") {
    await upgradeUserToProMax(result.userId, until);
  } else {
    await upgradeUserToPro(result.userId, until);
  }

  console.log(
    `🎉 [WompiWebhook] Transacción ${transaction.reference} aprobada — usuario ${result.userId} promovido a ${result.plan} hasta ${until.toISOString()}.`
  );

  return { verified: true, outcome: "approved" };
}
