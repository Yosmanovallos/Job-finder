import crypto from 'crypto';
import dotenv from 'dotenv';
import { markTransactionApproved, upgradeUserToPro } from '../db/job-repository.js';

dotenv.config();

const WOMPI_EVENTS_SECRET = process.env.WOMPI_EVENTS_SECRET;

if (!WOMPI_EVENTS_SECRET) {
  throw new Error('[Wompi] Falta WOMPI_EVENTS_SECRET en job-radar-apify/.env');
}

export interface WompiEventPayload {
  event: string;
  data: {
    transaction: {
      id: string;
      status: string;
      reference: string;
      amount_in_cents: number;
    };
  };
  signature: {
    properties: string[];
    checksum: string;
  };
  timestamp: number;
  environment: string;
}

function getNestedValue(obj: any, path: string): string {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj)?.toString() ?? '';
}

/**
 * Verifies a Wompi webhook checksum: SHA256 of the `signature.properties`
 * values (concatenated, in order) + the event timestamp + the events secret,
 * per Wompi's event verification spec. A payload that fails this is never
 * trusted, no matter what it claims.
 */
export function verifyWompiSignature(payload: WompiEventPayload): boolean {
  if (!payload?.signature?.properties?.length || !payload.signature.checksum) return false;

  const concatenated = payload.signature.properties.map(prop => getNestedValue(payload, prop)).join('');
  const raw = `${concatenated}${payload.timestamp}${WOMPI_EVENTS_SECRET}`;
  const expected = crypto.createHash('sha256').update(raw).digest('hex');

  return expected === payload.signature.checksum;
}

const PRO_SUBSCRIPTION_DAYS = 30;

/**
 * Handles a Wompi webhook event: verifies the signature, and on an APPROVED
 * transaction marks it approved idempotently (a retry that already succeeded
 * is a no-op) and upgrades the paying user to 'pro' for 30 days.
 */
export async function handleWompiWebhook(payload: WompiEventPayload): Promise<{ verified: boolean }> {
  if (!verifyWompiSignature(payload)) {
    console.warn('[WompiWebhook] Firma inválida — evento rechazado.');
    return { verified: false };
  }

  const transaction = payload.data?.transaction;
  if (!transaction || transaction.status !== 'APPROVED') {
    return { verified: true };
  }

  const result = await markTransactionApproved(transaction.reference, transaction.id);
  if (!result) {
    return { verified: true }; // Already processed or unknown reference — idempotent no-op.
  }

  const until = new Date(Date.now() + PRO_SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
  await upgradeUserToPro(result.userId, until);

  console.log(`🎉 [WompiWebhook] Transacción ${transaction.reference} aprobada — usuario ${result.userId} promovido a Pro hasta ${until.toISOString()}.`);

  return { verified: true };
}
