import { pool } from "../db/client.js";

// One approval path for both products (doc 08 H2 + idempotency), used by the
// verified webhook and by the Wompi API lookup. Everything that decides
// whether money unlocks something happens in ONE database transaction:
//   1. lock the stored row by reference;
//   2. H2: the approved amount (and currency, when given) must equal what we
//      stored when the checkout started, otherwise nothing changes;
//   3. an already-approved row is a no-op (Wompi retries, duplicates);
//   4. approve it and, for a resume pass, create rs_entitlements in the same
//      transaction, so a crash can never leave «approved but no pass».
// The subscription tier upgrade still runs after commit, exactly as before.

export type ApprovalResult =
  | { outcome: "approved"; product: "subscription"; userId: string; plan: string }
  | { outcome: "approved"; product: "resume_pass"; userId: string; plan: string; entitlementId: string | null }
  | { outcome: "already_approved" | "unknown_reference" | "amount_mismatch" };

export interface ApprovalInput {
  reference: string;
  wompiTransactionId: string;
  amountInCents: unknown;
  currency?: unknown;
  now?: Date;
}

export async function approveWompiTransaction(input: ApprovalInput): Promise<ApprovalResult> {
  const now = input.now ?? new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT user_id, plan, amount_in_cents, currency, status, product
       FROM transactions WHERE reference = $1 FOR UPDATE`,
      [input.reference]
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { outcome: "unknown_reference" };
    }
    const amount = input.amountInCents;
    const amountOk = typeof amount === "number" && Number.isSafeInteger(amount) && amount === Number(row.amount_in_cents);
    const currencyOk = input.currency === undefined || input.currency === null || input.currency === row.currency;
    if (!amountOk || !currencyOk) {
      await client.query("ROLLBACK");
      return { outcome: "amount_mismatch" };
    }
    if (row.status === "approved") {
      await client.query("ROLLBACK");
      return { outcome: "already_approved" };
    }
    await client.query(
      `UPDATE transactions SET status = 'approved', wompi_transaction_id = $2, updated_at = NOW() WHERE reference = $1`,
      [input.reference, input.wompiTransactionId]
    );
    if (row.product === "resume_pass") {
      // Loaded only for pass payments: the subscription path never imports rs_* code.
      const { insertEntitlementTx } = await import("../db/resume-studio-pass-repository.js");
      const entitlementId = await insertEntitlementTx(client, {
        userId: row.user_id,
        passId: row.plan,
        reference: input.reference,
        amountInCents: Number(row.amount_in_cents),
        now
      });
      await client.query("COMMIT");
      return { outcome: "approved", product: "resume_pass", userId: row.user_id, plan: row.plan, entitlementId };
    }
    await client.query("COMMIT");
    return { outcome: "approved", product: "subscription", userId: row.user_id, plan: row.plan };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
