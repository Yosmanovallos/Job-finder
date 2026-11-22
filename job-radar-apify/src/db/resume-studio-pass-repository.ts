import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./client.js";
import {
  RESUME_FREE_ADAPTATIONS,
  RESUME_PASSES,
  RESUME_PASS_REFERENCE_PREFIX,
  addDays,
  freePeriodEnd,
  freePeriodStart,
  isPassId,
  passAmountInCents,
  passPeriodEnd,
  passPeriodStart,
  type PassId
} from "../resume-studio/payments/passes.js";

// AI Resume Studio R4: pass checkout rows, rs_entitlements and the
// adaptation quota (ADR 0017 §5, doc 06 §4 and §7). Never touches
// users.subscription_tier. No CV content anywhere in these tables.

/** Unique reference tied to the user and the pass; the random suffix makes it unguessable. */
export function buildPassReference(passId: PassId, userId: string, now = Date.now()): string {
  return `${RESUME_PASS_REFERENCE_PREFIX}${passId}_${userId}_${now}_${randomBytes(6).toString("hex")}`;
}

export async function createPendingPassTransaction(userId: string, passId: PassId): Promise<{ reference: string; amountInCents: number; currency: "COP" }> {
  const reference = buildPassReference(passId, userId);
  const amountInCents = passAmountInCents(passId);
  // plan is set explicitly: the column defaults to 'pro'.
  await pool.query(
    `INSERT INTO transactions (user_id, reference, amount_in_cents, currency, status, plan, product)
     VALUES ($1, $2, $3, 'COP', 'pending', $4, 'resume_pass')`,
    [userId, reference, amountInCents, passId]
  );
  return { reference, amountInCents, currency: "COP" };
}

/** The caller's own pass transaction, or null (someone else's reference looks like a missing one). */
export async function findUserPassTransaction(userId: string, reference: string): Promise<{ status: string; passId: string } | null> {
  const result = await pool.query(
    `SELECT status, plan FROM transactions WHERE reference = $1 AND user_id = $2 AND product = 'resume_pass'`,
    [reference, userId]
  );
  const row = result.rows[0];
  return row ? { status: row.status, passId: row.plan } : null;
}

/** Declined/voided/error from Wompi: only a still-pending pass row changes, so the screen can say so. */
export async function markResumePassClosed(reference: string, wompiStatus: string): Promise<boolean> {
  const status = wompiStatus === "DECLINED" || wompiStatus === "VOIDED" ? "declined" : "error";
  const result = await pool.query(
    `UPDATE transactions SET status = $2, updated_at = NOW()
     WHERE reference = $1 AND product = 'resume_pass' AND status = 'pending'`,
    [reference, status]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Creates the pass inside the caller's DB transaction (the one that approved
 * the payment row). Passes stack: a new one starts when the last active one
 * ends, so buying early never wastes days. Idempotent by reference.
 */
export async function insertEntitlementTx(
  client: PoolClient,
  input: { userId: string; passId: string; reference: string; amountInCents: number; now: Date }
): Promise<string | null> {
  if (!isPassId(input.passId)) throw new Error("pase desconocido en la transacción");
  const pass = RESUME_PASSES[input.passId];
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`rs_pass:${input.userId}`]);
  const last = await client.query(
    `SELECT MAX(expires_at) AS until FROM rs_entitlements WHERE user_id = $1 AND expires_at > $2`,
    [input.userId, input.now]
  );
  const until: Date | null = last.rows[0]?.until ? new Date(last.rows[0].until) : null;
  const startsAt = until && until > input.now ? until : input.now;
  const inserted = await client.query(
    `INSERT INTO rs_entitlements
       (user_id, pass_id, transaction_reference, amount_in_cents, starts_at, expires_at, adaptations_per_period, period_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (transaction_reference) DO NOTHING
     RETURNING id`,
    [input.userId, pass.id, input.reference, input.amountInCents, startsAt, addDays(startsAt, pass.durationDays), pass.adaptationsPerPeriod, pass.periodDays]
  );
  return inserted.rows[0]?.id ?? null;
}

export interface ActiveEntitlement {
  id: string;
  passId: PassId;
  startsAt: Date;
  expiresAt: Date;
  adaptationsPerPeriod: number;
  periodDays: number;
}

function toEntitlement(row: Record<string, unknown>): ActiveEntitlement {
  return {
    id: String(row.id),
    passId: row.pass_id as PassId,
    startsAt: new Date(row.starts_at as string),
    expiresAt: new Date(row.expires_at as string),
    adaptationsPerPeriod: Number(row.adaptations_per_period),
    periodDays: Number(row.period_days)
  };
}

export async function getActiveEntitlement(userId: string, now = new Date()): Promise<ActiveEntitlement | null> {
  const result = await pool.query(
    `SELECT id, pass_id, starts_at, expires_at, adaptations_per_period, period_days
     FROM rs_entitlements WHERE user_id = $1 AND starts_at <= $2 AND expires_at > $2
     ORDER BY starts_at ASC LIMIT 1`,
    [userId, now]
  );
  return result.rows[0] ? toEntitlement(result.rows[0]) : null;
}

async function usedIn(bucket: string, periodStart: Date): Promise<number> {
  const result = await pool.query(`SELECT used FROM rs_adaptation_quota WHERE bucket = $1 AND period_start = $2`, [bucket, periodStart]);
  return Number(result.rows[0]?.used ?? 0);
}

/** Atomic: increments only while used < limit. Concurrent calls can never pass the limit. */
async function take(bucket: string, periodStart: Date, limit: number): Promise<number | null> {
  if (limit <= 0) return null;
  const result = await pool.query(
    `INSERT INTO rs_adaptation_quota (bucket, period_start, used) VALUES ($1, $2, 1)
     ON CONFLICT (bucket, period_start) DO UPDATE
       SET used = rs_adaptation_quota.used + 1, updated_at = NOW()
       WHERE rs_adaptation_quota.used < $3
     RETURNING used`,
    [bucket, periodStart, limit]
  );
  return result.rows[0] ? Number(result.rows[0].used) : null;
}

export type QuotaGrant = { ok: true; bucket: string; periodStart: Date; source: "pass" | "free"; used: number; limit: number };
export type QuotaDenial = { ok: false; source: "pass" | "free"; limit: number; resetsAt: Date };

/** One adaptation from the active pass first, then from the monthly free allowance. */
export async function consumeAdaptation(userId: string, now = new Date()): Promise<QuotaGrant | QuotaDenial> {
  const pass = await getActiveEntitlement(userId, now);
  if (pass) {
    const periodStart = passPeriodStart(pass.startsAt, pass.periodDays, now);
    const used = await take(pass.id, periodStart, pass.adaptationsPerPeriod);
    if (used !== null) return { ok: true, bucket: pass.id, periodStart, source: "pass", used, limit: pass.adaptationsPerPeriod };
  }
  const freeStart = freePeriodStart(now);
  const freeBucket = `free:${userId}`;
  const used = await take(freeBucket, freeStart, RESUME_FREE_ADAPTATIONS);
  if (used !== null) return { ok: true, bucket: freeBucket, periodStart: freeStart, source: "free", used, limit: RESUME_FREE_ADAPTATIONS };
  if (pass) {
    return { ok: false, source: "pass", limit: pass.adaptationsPerPeriod, resetsAt: passPeriodEnd(pass.startsAt, pass.periodDays, now, pass.expiresAt) };
  }
  return { ok: false, source: "free", limit: RESUME_FREE_ADAPTATIONS, resetsAt: freePeriodEnd(now) };
}

/** Gives back an adaptation that never got its AI (a cost cap or the provider failed). */
export async function releaseAdaptation(grant: Pick<QuotaGrant, "bucket" | "periodStart">): Promise<void> {
  await pool.query(
    `UPDATE rs_adaptation_quota SET used = used - 1, updated_at = NOW() WHERE bucket = $1 AND period_start = $2 AND used > 0`,
    [grant.bucket, grant.periodStart]
  );
}

export interface PassStatus {
  active: { passId: PassId; startsAt: string; expiresAt: string; used: number; limit: number; periodEndsAt: string } | null;
  /** Paid passes that start after the active one (stacked). */
  queued: number;
  free: { used: number; limit: number; resetsAt: string };
}

export async function getPassStatus(userId: string, now = new Date()): Promise<PassStatus> {
  const pass = await getActiveEntitlement(userId, now);
  const queuedResult = await pool.query(`SELECT COUNT(*)::int AS n FROM rs_entitlements WHERE user_id = $1 AND starts_at > $2`, [userId, now]);
  const freeStart = freePeriodStart(now);
  let active: PassStatus["active"] = null;
  if (pass) {
    const periodStart = passPeriodStart(pass.startsAt, pass.periodDays, now);
    active = {
      passId: pass.passId,
      startsAt: pass.startsAt.toISOString(),
      expiresAt: pass.expiresAt.toISOString(),
      used: await usedIn(pass.id, periodStart),
      limit: pass.adaptationsPerPeriod,
      periodEndsAt: passPeriodEnd(pass.startsAt, pass.periodDays, now, pass.expiresAt).toISOString()
    };
  }
  return {
    active,
    queued: Number(queuedResult.rows[0]?.n ?? 0),
    free: { used: await usedIn(`free:${userId}`, freeStart), limit: RESUME_FREE_ADAPTATIONS, resetsAt: freePeriodEnd(now).toISOString() }
  };
}
