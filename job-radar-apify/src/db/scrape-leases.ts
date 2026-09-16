import { pool } from "./client.js";

/**
 * Atomic role/source claiming (P3, spec EXE-007/EXE-008).
 *
 * Why it exists: `getDueRoleSources` answers "what is due?" by reading, and
 * two ticks that read at the same moment get the same answer. Today overlap
 * is rare only because Actions delivers ~6 ticks/day instead of the 96 the
 * cron asks for — the moment the trigger becomes reliable, two ticks would
 * routinely scrape the same role/source pair simultaneously and double the
 * request volume against sources that are already rate-sensitive. The lease
 * is what has to exist BEFORE the scheduler is made dependable, which is why
 * it lands in this phase and the scheduler move does not.
 *
 * See src/db/schema.sql (table 13) for why this is its own table rather than
 * columns on `role_source_runs`.
 */

/** Margin over a source's own budget before another tick may steal the claim. */
const LEASE_TTL_MARGIN_MS = 5 * 60_000;

let tableMissingWarned = false;

/** Postgres "undefined_table" — the migration has not been applied yet. */
function isMissingTable(err: unknown): boolean {
  return (err as { code?: string })?.code === "42P01";
}

function warnMissingTable(operation: string): void {
  if (tableMissingWarned) return;
  tableMissingWarned = true;
  console.warn(
    `⚠️ [Leases] La tabla scrape_leases no existe (${operation}); se concede sin coordinar. Aplica la migración: npx tsx scripts/migrate.ts`
  );
}

export interface ClaimLeaseInput {
  roleName: string;
  sourceName: string;
  runId: string;
  country: string;
  /** How long this claim stays valid before another tick may take it. */
  budgetMs: number;
}

/**
 * Claims a role/source pair for this run. Returns false when another live
 * run already holds it — the caller skips that source without error; it
 * simply stays due for the next tick.
 *
 * Single statement on purpose. A SELECT-then-INSERT is precisely the race
 * being closed: the `WHERE` on `DO UPDATE` is evaluated against the row
 * PostgreSQL has already locked, not against one read a moment earlier.
 */
export async function claimLease(input: ClaimLeaseInput): Promise<boolean> {
  const ttlMs = input.budgetMs + LEASE_TTL_MARGIN_MS;
  try {
    const result = await pool.query(
      `INSERT INTO scrape_leases (role_name, source_name, run_id, country, expires_at)
       VALUES ($1, $2, $3::uuid, $4, NOW() + ($5::double precision * INTERVAL '1 millisecond'))
       ON CONFLICT (role_name, source_name) DO UPDATE
          SET run_id = EXCLUDED.run_id,
              country = EXCLUDED.country,
              acquired_at = NOW(),
              heartbeat_at = NOW(),
              expires_at = EXCLUDED.expires_at
        WHERE scrape_leases.expires_at < NOW()
       RETURNING run_id`,
      [input.roleName, input.sourceName, input.runId, input.country, ttlMs]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    if (isMissingTable(err)) {
      warnMissingTable("claim");
      // Coordination must never be what stops the scrape — same principle as
      // P2's telemetry (runTelemetrySafely): degrade to today's behavior.
      return true;
    }
    console.warn(`⚠️ [Leases] No se pudo reclamar ${input.roleName}/${input.sourceName}:`, (err as Error)?.message);
    return true;
  }
}

/**
 * Extends every lease held by this run. Called from the P2 heartbeat (60s)
 * so a long but healthy source keeps its claim, while a dead process stops
 * refreshing and its leases expire on their own.
 */
export async function refreshLeases(runId: string, budgetMs: number): Promise<number> {
  const ttlMs = budgetMs + LEASE_TTL_MARGIN_MS;
  try {
    const result = await pool.query(
      `UPDATE scrape_leases
          SET heartbeat_at = NOW(),
              expires_at = NOW() + ($2::double precision * INTERVAL '1 millisecond')
        WHERE run_id = $1::uuid`,
      [runId, ttlMs]
    );
    return result.rowCount ?? 0;
  } catch (err) {
    if (isMissingTable(err)) return 0;
    console.warn(`⚠️ [Leases] Latido de leases falló:`, (err as Error)?.message);
    return 0;
  }
}

/** Releases one claim as soon as its source finishes, in a `finally`. */
export async function releaseLease(roleName: string, sourceName: string, runId: string): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM scrape_leases WHERE role_name = $1 AND source_name = $2 AND run_id = $3::uuid`,
      [roleName, sourceName, runId]
    );
  } catch (err) {
    if (isMissingTable(err)) return;
    // Not fatal: expires_at is the backstop for exactly this case.
    console.warn(`⚠️ [Leases] No se pudo liberar ${roleName}/${sourceName}:`, (err as Error)?.message);
  }
}

/** Releases everything this run still holds, on the way out. */
export async function releaseRunLeases(runId: string): Promise<number> {
  try {
    const result = await pool.query(`DELETE FROM scrape_leases WHERE run_id = $1::uuid`, [runId]);
    return result.rowCount ?? 0;
  } catch (err) {
    if (isMissingTable(err)) return 0;
    console.warn(`⚠️ [Leases] No se pudieron liberar los leases de la ejecución:`, (err as Error)?.message);
    return 0;
  }
}
