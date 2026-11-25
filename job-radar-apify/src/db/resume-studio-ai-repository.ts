import { pool } from "./client.js";
import {
  capBroken,
  colombiaWindows,
  type ReserveRequest,
  type ReserveResult,
  type SettleUsage,
  type UsageLedger
} from "../resume-studio/ai/ledger.js";

// AI Resume Studio R3 — PostgreSQL ledger `rs_ai_usage` (ADR 0017 §4).
// No content is ever written here. reserve() runs check-and-insert in one
// transaction under a single advisory lock, so the four caps are hard even
// with concurrent requests on several instances.

const LOCK_KEY = 0x5253_4149; // "RSAI"

export class PgUsageLedger implements UsageLedger {
  async startAdaptation(userId: string, adaptationId: string, now = new Date()): Promise<void> {
    await pool.query(
      `INSERT INTO rs_ai_usage (user_id, adaptation_id, purpose, status, created_at) VALUES ($1, $2, 'start', 'start', $3)`,
      [userId, adaptationId, now]
    );
  }

  async ownsAdaptation(userId: string, adaptationId: string): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM rs_ai_usage WHERE adaptation_id = $1 AND user_id = $2 AND status = 'start' LIMIT 1`,
      [adaptationId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async claimAdaptation(userId: string, adaptationId: string, now = new Date()): Promise<boolean> {
    // Atomic thanks to uq_rs_ai_usage_start: two concurrent claims, one row.
    const result = await pool.query(
      `INSERT INTO rs_ai_usage (user_id, adaptation_id, purpose, status, created_at) VALUES ($1, $2, 'start', 'start', $3)
       ON CONFLICT (adaptation_id) WHERE status = 'start' DO NOTHING`,
      [userId, adaptationId, now]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async unclaimAdaptation(userId: string, adaptationId: string): Promise<void> {
    await pool.query(
      `DELETE FROM rs_ai_usage u WHERE u.adaptation_id = $1 AND u.user_id = $2 AND u.status = 'start'
         AND NOT EXISTS (SELECT 1 FROM rs_ai_usage o WHERE o.adaptation_id = $1 AND o.status <> 'start')`,
      [adaptationId, userId]
    );
  }

  async reserve(request: ReserveRequest): Promise<ReserveResult> {
    const now = request.now ?? new Date();
    const { dayStart, monthStart } = colombiaWindows(now);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
      if (request.maxPurposeTurns !== undefined && request.attempt === 1) {
        const turns = await client.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM rs_ai_usage WHERE adaptation_id = $1 AND purpose = $2 AND attempt = 1 AND status <> 'start'`,
          [request.adaptationId, request.purpose]
        );
        if (Number(turns.rows[0].n) >= request.maxPurposeTurns) {
          await client.query("ROLLBACK");
          return { ok: false, cap: "chat_turns" };
        }
      }
      const sums = await client.query<{ user_daily: string; global_daily: string; global_monthly: string }>(
        `SELECT
           COALESCE(SUM(cost_micros) FILTER (WHERE user_id = $1 AND created_at >= $2), 0)::text AS user_daily,
           COALESCE(SUM(cost_micros) FILTER (WHERE created_at >= $2), 0)::text AS global_daily,
           COALESCE(SUM(cost_micros), 0)::text AS global_monthly
         FROM rs_ai_usage WHERE created_at >= $3`,
        [request.userId, dayStart, monthStart]
      );
      const row = sums.rows[0];
      // An adaptation can straddle a month boundary: sum all its rows.
      const adaptationAll = await client.query<{ s: string }>(
        `SELECT COALESCE(SUM(cost_micros), 0)::text AS s FROM rs_ai_usage WHERE adaptation_id = $1`,
        [request.adaptationId]
      );
      const broken = capBroken(
        {
          adaptation: Number(adaptationAll.rows[0].s),
          userDaily: Number(row.user_daily),
          globalDaily: Number(row.global_daily),
          globalMonthly: Number(row.global_monthly)
        },
        request.maxCostMicros,
        request.caps
      );
      if (broken) {
        await client.query("ROLLBACK");
        return { ok: false, cap: broken };
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO rs_ai_usage (user_id, adaptation_id, purpose, prompt_id, prompt_version, alias, model, attempt, status, cost_micros, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'reserved', $9, $10) RETURNING id::text`,
        [
          request.userId,
          request.adaptationId,
          request.purpose,
          request.promptId,
          request.promptVersion,
          request.alias,
          request.model,
          request.attempt,
          request.maxCostMicros,
          now
        ]
      );
      await client.query("COMMIT");
      return { ok: true, reservationId: inserted.rows[0].id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async settle(reservationId: string, usage: SettleUsage): Promise<void> {
    await pool.query(
      `UPDATE rs_ai_usage
          SET status = $2, input_tokens = $3, output_tokens = $4, cached_tokens = $5, cost_micros = $6, latency_ms = $7
        WHERE id = $1 AND status = 'reserved'`,
      [reservationId, usage.status, usage.inputTokens, usage.outputTokens, usage.cachedTokens, usage.costMicros, usage.latencyMs]
    );
  }

  async recordCacheHit(request: Omit<ReserveRequest, "maxCostMicros" | "caps" | "maxPurposeTurns">): Promise<void> {
    await pool.query(
      `INSERT INTO rs_ai_usage (user_id, adaptation_id, purpose, prompt_id, prompt_version, alias, model, attempt, status, cache_hit, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'cache_hit', TRUE, $9)`,
      [request.userId, request.adaptationId, request.purpose, request.promptId, request.promptVersion, request.alias, request.model, request.attempt, request.now ?? new Date()]
    );
  }
}

/** «Borrar todo» / revocar: the rows stay for the global caps, without the person. */
export async function anonymizeAiUsage(userId: string): Promise<number> {
  try {
    const result = await pool.query(`UPDATE rs_ai_usage SET user_id = NULL, adaptation_id = NULL WHERE user_id = $1`, [userId]);
    return result.rowCount ?? 0;
  } catch (error) {
    if ((error as { code?: string })?.code === "42P01") return 0;
    throw error;
  }
}
