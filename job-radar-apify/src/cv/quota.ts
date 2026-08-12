import type { PoolClient } from "pg";
import { pool } from "../db/client.js";

/**
 * Transactional generation-quota reservation (docs/CV-GENERATION-PLAN.md
 * §6.2). This is the mechanism the user explicitly asked for when this
 * feature was first scoped: "no poder romper o poder hackear esa consumo
 * de tokens" — a script firing the endpoint in parallel must never be
 * able to spend past the quota before any counter catches up.
 *
 * Two corrections to §6.2's literal text, made while implementing (both
 * required for correctness, not style):
 *
 * 1. **Row locking.** §6.2 step 2-3 describes "una transacción" as the
 *    guarantee, but Postgres's default isolation (READ COMMITTED) allows
 *    two concurrent transactions to both read the same usage count and
 *    both insert — a classic phantom read, not prevented by a bare
 *    BEGIN/COMMIT. This module takes `SELECT id FROM users WHERE id = $1
 *    FOR UPDATE` as the FIRST statement inside the transaction, which
 *    serializes all reservations for that one user (other users are
 *    never blocked) — verified with a real N-simultaneous-requests test
 *    (tests/validate-cv-quota.ts).
 * 2. **SUM(credits_charged), not COUNT(*), for both tiers.** §6.2's text
 *    says Pro is verified by `COUNT(*)`. That's incompatible with two
 *    other real constraints: `UNIQUE (user_id, job_id)` caps a user at
 *    one row per job no matter how many times they regenerate it, and
 *    §9.4 requires a regeneration to consume quota "igual que la primera
 *    generación." A row-count can never grow past the number of distinct
 *    jobs, so it can't reflect repeated regenerations of the same job.
 *    Fix: every generation (Pro or Pro Max) charges `credits_charged`
 *    (Pro's is always 1 — see `PRO_CREDIT_COST`); the quota check sums
 *    that column for both tiers. A regeneration on an already-`completed`
 *    row adds its cost on top of what's already there instead of
 *    replacing it, so repeated regenerations really do cost repeated
 *    quota. `docs/CV-GENERATION-PLAN.md` §3.1's Fase 0 comment ("Pro se
 *    verifica por conteo, no por créditos") is corrected by this file,
 *    not by that comment.
 *
 * `VerifiedSession.tier` gained `'pro_max'` in Fase 10 (real billing,
 * `docs/CV-GENERATION-PLAN.md` §10) — `server.ts` now passes it through
 * instead of hardcoding `"pro"`, charging `PRO_MAX_STANDARD_CREDIT_COST`
 * (the only model option reachable before Fase 11's selector exists).
 * The credit arithmetic below was already written generically for this.
 */

export const PRO_GENERATIONS_PER_WINDOW = 3;
/** Pro has one model option ("standard"); every generation costs the same
 * flat unit — this is what lets Pro reuse the same SUM-based mechanism
 * as Pro Max's real per-option credit costs (§6.5.2) without a branch. */
export const PRO_CREDIT_COST = 1;
/** §6.5.2's "Estándar" row: Sonnet 5, $0.26 peor caso, 3 créditos
 * (redondear_arriba($0.26/$0.10)). Fase 10 wired Pro Max into real
 * billing while "Estándar" was the only reachable option; Fase 11 adds
 * the selector, so the other two rows below become reachable too — but
 * see the note on `MODEL_OPTION_CREDIT_COST` about what "reachable"
 * actually means today. */
export const PRO_MAX_STANDARD_CREDIT_COST = 3;
/** §6.5.2's "Premium" row: Opus 4.8, $0.41 peor caso, 5 créditos
 * (redondear_arriba($0.41/$0.10)). Real, plan-derived pricing — NOT
 * invented for Fase 11 — but see `MODEL_OPTION_CREDIT_COST` below: this
 * option's pipeline doesn't run yet (no Anthropic client exists, Fase 11
 * decision 2026-08-09, ver docs/CV-GENERATION-PLAN.md §10 fila 11). The
 * credit cost is wired now so the reservation mechanism is real and
 * tested end-to-end; the number itself is ready for whenever the
 * pipeline catches up. */
export const PRO_MAX_PREMIUM_CREDIT_COST = 5;
/** §6.5.2's "Comparar" row: Sonnet+Opus peor caso, $0.51, 6 créditos
 * (redondear_arriba($0.51/$0.10)). Same status as Premium above — cost
 * wired, pipeline not built (Etapa C, el score ATS determinístico que
 * decidiría el ganador sin un tercer LLM, tampoco existe en este
 * subproyecto todavía). */
export const PRO_MAX_COMPARE_CREDIT_COST = 6;
/** §12 punto 8: confirmado 14 créditos/mes para Pro Max. */
export const PRO_MAX_CREDITS_PER_WINDOW = 14;

export type Tier = "pro" | "pro_max";
export type ModelOption = "standard" | "premium" | "compare";

/** Single source of truth for what each Pro Max model option costs in
 * credits (§6.5.2) — `server.ts` derives `proMaxCreditCost` from this
 * table keyed by the SERVER-validated option, never from a value the
 * client sent directly (§6.2 paso 1). Only `standard` runs a real
 * pipeline today (see `generation-pipeline.ts`'s
 * `AVAILABLE_MODEL_OPTIONS`) — `premium`/`compare` are included here so
 * the credit-reservation mechanics (this file) are fully real and tested
 * even though the LLM pipeline behind them isn't built yet. */
export const MODEL_OPTION_CREDIT_COST: Record<ModelOption, number> = {
  standard: PRO_MAX_STANDARD_CREDIT_COST,
  premium: PRO_MAX_PREMIUM_CREDIT_COST,
  compare: PRO_MAX_COMPARE_CREDIT_COST
};

export class QuotaExceededError extends Error {
  constructor(used: number, limit: number) {
    super(`Quota exceeded: ${used} + this request > ${limit} for the current window`);
    this.name = "QuotaExceededError";
  }
}

export class GenerationConflictError extends Error {
  constructor(status: string) {
    super(`A generation for this job already exists with status "${status}" — regeneration is not part of Fase 4`);
    this.name = "GenerationConflictError";
  }
}

export class GenerationNotFoundError extends Error {
  constructor(id: string) {
    super(`No completed generation ${id} found for this user to regenerate`);
    this.name = "GenerationNotFoundError";
  }
}

export interface ReserveGenerationInput {
  userId: string;
  tier: Tier;
  jobId: string;
  jobTitle: string;
  jobCompany: string;
  modelOption: ModelOption;
  /** Real cost in credits for Pro Max's chosen option (§6.5.2: 3/5/6).
   * Ignored for `tier: "pro"`, which always charges `PRO_CREDIT_COST`. */
  proMaxCreditCost?: number;
  /** Test seam only — production always uses `subscription_end - 30d` as
   * the window start (documented limitation below, no `subscription_start`
   * column exists yet to compute this exactly). */
  now?: () => Date;
}

export interface Reservation {
  id: string;
}

/**
 * Fase 14 de docs/RESUME-STUDIO-PLAN.md (cutover de facturación, §2 del
 * plan aprobado ya confirmado: Pro/Pro Max sigue siendo el gate de
 * acceso — esto NO cambia; lo que cambia es quién paga los tokens). Una
 * regeneración financiada con la API key propia del usuario (BYOK,
 * `credentialSource: "user_byok"`) cuesta 0 créditos — el operador no
 * gastó nada, no hay nada que cobrarle a la cuota del usuario. Ausente,
 * o `"operator_fallback"` (el único camino real antes de esta fase),
 * mantiene el costo de siempre — cero cambio de comportamiento. Esto
 * hace innecesario "saltar" el chequeo de límite por separado: con costo
 * 0, `used + 0 > limit` nunca bloquea una regeneración BYOK, incluso con
 * la cuota ya agotada — correcto, esa cuota protege el gasto del
 * OPERADOR, no el del usuario (mismo criterio ya aplicado al circuit
 * breaker diario del gateway, Fase 4 de este mismo plan).
 */
function creditCostFor(
  tier: Tier,
  proMaxCreditCost: number | undefined,
  credentialSource?: "user_byok" | "operator_fallback"
): number {
  if (credentialSource === "user_byok") return 0;
  if (tier === "pro") return PRO_CREDIT_COST;
  if (proMaxCreditCost === undefined) {
    throw new Error('proMaxCreditCost is required when tier is "pro_max"');
  }
  return proMaxCreditCost;
}

function limitFor(tier: Tier): number {
  return tier === "pro" ? PRO_GENERATIONS_PER_WINDOW : PRO_MAX_CREDITS_PER_WINDOW;
}

/** Shared window/usage computation for both the transactional reservation
 * (below) and the read-only status check (`getQuotaStatus`) — a single
 * source of truth for "what counts as used", so a display number can
 * never drift from what reservation actually enforces. */
/** Un solo round trip en vez de dos (perf, Fase 11 UX follow-up
 * 2026-08-09): la versión anterior leía `subscription_end` primero y
 * luego consultaba `cv_generations` con el `windowStart` calculado — dos
 * queries secuenciales, medido en vivo en ~2.1s combinado contra la
 * Postgres real de este proyecto (Supabase, no local). El `now()`
 * inyectado (test seam) sigue siendo el fallback para `subscription_end
 * IS NULL`, pasado como parámetro — nunca `NOW()` de SQL, para no perder
 * la testabilidad con reloj fijo que ya usan los tests existentes. */
async function usedInWindow(
  queryable: { query: PoolClient["query"] },
  userId: string,
  now: () => Date
): Promise<number> {
  const { rows } = await queryable.query<{ used: string }>(
    `SELECT COALESCE(SUM(cg.credits_charged), 0) AS used
     FROM users u
     LEFT JOIN cv_generations cg
       ON cg.user_id = u.id
       AND cg.status IN ('reserved', 'completed')
       AND cg.created_at >= COALESCE(u.subscription_end, $2::timestamptz) - INTERVAL '30 days'
     WHERE u.id = $1`,
    [userId, now()]
  );
  return Number(rows[0]?.used ?? 0);
}

export interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
}

/** Read-only quota check for display (Fase 6, Vista 1 — "Te quedan X de Y
 * generaciones"): no transaction, no `FOR UPDATE`, no write. Never call
 * this to decide whether a generation is allowed to proceed — that
 * decision belongs solely to `reserveGenerationQuota`, which re-checks
 * inside a lock immediately before charging anything (§6.2: the quota is
 * reserved, never just displayed-then-trusted). */
export async function getQuotaStatus(userId: string, tier: Tier, now: () => Date = () => new Date()): Promise<QuotaStatus> {
  const used = await usedInWindow(pool, userId, now);
  const limit = limitFor(tier);
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Reserves quota for one generation, inside a single transaction, before
 * any LLM call happens. Throws `QuotaExceededError` (nothing charged) or
 * `GenerationConflictError` (an existing `reserved`/`completed` row for
 * this job blocks it — regeneration isn't Fase 4's scope) without ever
 * calling out to a model.
 *
 * Window: a Pro/Pro Max pass is a non-renewing 30-day window
 * (`BACKLOG.md`), not a calendar month, so quota resets per-pass, not
 * per-month. There's no `subscription_start` column today, so the window
 * start is approximated as `subscription_end - 30 days` — exact for a
 * pass that hasn't been extended; a real `subscription_start` column
 * would remove the approximation (left for whenever Fase 10 touches
 * billing again, not invented here).
 */
export async function reserveGenerationQuota(input: ReserveGenerationInput): Promise<Reservation> {
  const now = input.now ?? (() => new Date());
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // Serializes concurrent reservations for THIS user only — other
    // users' transactions are never blocked by this lock.
    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [input.userId]);

    const used = await usedInWindow(client, input.userId, now);
    const cost = creditCostFor(input.tier, input.proMaxCreditCost);
    const limit = limitFor(input.tier);

    if (used + cost > limit) {
      throw new QuotaExceededError(used, limit);
    }

    const { rows: existingRows } = await client.query<{ id: string; status: string; credits_charged: number }>(
      `SELECT id, status, credits_charged FROM cv_generations WHERE user_id = $1 AND job_id = $2 FOR UPDATE`,
      [input.userId, input.jobId]
    );
    const existing = existingRows[0];

    if (existing && existing.status !== "failed") {
      throw new GenerationConflictError(existing.status);
    }

    let reservationId: string;
    if (existing) {
      // Previously failed for this job — failed rows never counted
      // toward quota, so this is a clean re-reservation, not additive.
      const { rows } = await client.query<{ id: string }>(
        `UPDATE cv_generations
         SET status = 'reserved', job_title = $3, job_company = $4, model_option = $5, credits_charged = $6, updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [existing.id, input.userId, input.jobTitle, input.jobCompany, input.modelOption, cost]
      );
      reservationId = rows[0]!.id;
    } else {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO cv_generations (user_id, job_id, job_title, job_company, status, model_option, credits_charged)
         VALUES ($1, $2, $3, $4, 'reserved', $5, $6)
         RETURNING id`,
        [input.userId, input.jobId, input.jobTitle, input.jobCompany, input.modelOption, cost]
      );
      reservationId = rows[0]!.id;
    }

    await client.query("COMMIT");
    return { id: reservationId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface ReserveRegenerationInput {
  userId: string;
  tier: Tier;
  /** The existing `cv_generations` row to regenerate — must belong to this
   * user and be `status = 'completed'` (§9.4: regenerate operates on an
   * already-generated CV inside the editor; there's nothing to regenerate
   * from a `reserved`/`failed` row). */
  generationId: string;
  modelOption: ModelOption;
  proMaxCreditCost?: number;
  /** Fase 14 — ver el comentario de `creditCostFor`. Resuelto ANTES de
   * llamar esta función (server.ts ya resuelve la credencial real antes
   * de invocar el pipeline, Fase 11) — nunca se decide aquí adentro. */
  credentialSource?: "user_byok" | "operator_fallback";
  now?: () => Date;
}

export interface RegenerationReservation extends Reservation {
  /** `credits_charged` as it was before this reservation — needed to
   * revert cleanly if the regeneration fails (see `revertRegeneration`). */
  previousCreditsCharged: number;
}

/**
 * Reserves quota for a regeneration (§9.4: "consume cuota/créditos según
 * la opción elegida, igual que la primera generación"). Unlike
 * `reserveGenerationQuota`'s initial reservation, this **accumulates**
 * onto the row's existing `credits_charged` rather than replacing it —
 * `usedInWindow` sums that column, so replacing it would let a user
 * regenerate the same job unlimited times for the price of one (the exact
 * abuse case §6.2 exists to close). The row moves to `status = 'reserved'`
 * while the pipeline runs, exactly like a first-time reservation, so a
 * second concurrent regenerate request on the same row is rejected by the
 * `status !== 'completed'` check below (its own transaction blocks on the
 * `FOR UPDATE` lock until this one commits or rolls back).
 */
export async function reserveRegenerationQuota(input: ReserveRegenerationInput): Promise<RegenerationReservation> {
  const now = input.now ?? (() => new Date());
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [input.userId]);

    const { rows } = await client.query<{ id: string; status: string; credits_charged: number }>(
      `SELECT id, status, credits_charged FROM cv_generations WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [input.generationId, input.userId]
    );
    const existing = rows[0];
    if (!existing) {
      throw new GenerationNotFoundError(input.generationId);
    }
    if (existing.status !== "completed") {
      throw new GenerationConflictError(existing.status);
    }

    const used = await usedInWindow(client, input.userId, now);
    const cost = creditCostFor(input.tier, input.proMaxCreditCost, input.credentialSource);
    const limit = limitFor(input.tier);

    if (used + cost > limit) {
      throw new QuotaExceededError(used, limit);
    }

    const previousCreditsCharged = existing.credits_charged;
    await client.query(
      `UPDATE cv_generations
       SET status = 'reserved', model_option = $3, credits_charged = $4, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [input.generationId, input.userId, input.modelOption, previousCreditsCharged + cost]
    );

    await client.query("COMMIT");
    return { id: input.generationId, previousCreditsCharged };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Reverts a failed regeneration: restores `status = 'completed'` and the
 * pre-regenerate `credits_charged`, leaving `document_json`/
 * `generated_document_json` untouched (they were never overwritten during
 * `status = 'reserved'` — only `completeGeneration` touches them, and it's
 * never called on a failure path). Deliberately NOT `failGeneration` — that
 * would flip the row to `status = 'failed'`, which drops it out of every
 * future `usedInWindow` sum entirely, silently erasing the credits already
 * charged for the user's still-existing, still-working prior CV. */
export async function revertRegeneration(id: string, previousCreditsCharged: number): Promise<void> {
  await pool.query(
    `UPDATE cv_generations SET status = 'completed', credits_charged = $2, updated_at = NOW() WHERE id = $1`,
    [id, previousCreditsCharged]
  );
}

export async function completeGeneration(id: string, documentJson: unknown): Promise<void> {
  await pool.query(
    `UPDATE cv_generations
     SET status = 'completed', generated_document_json = $2, document_json = $2, updated_at = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(documentJson)]
  );
}

/** Never charges quota — the row's `credits_charged` value stays as an
 * audit trail of what was RESERVED, but the quota-check query above only
 * ever sums `status IN ('reserved','completed')`, so a `failed` row is
 * automatically excluded from every future quota calculation. */
export async function failGeneration(id: string): Promise<void> {
  await pool.query(`UPDATE cv_generations SET status = 'failed', updated_at = NOW() WHERE id = $1`, [id]);
}
