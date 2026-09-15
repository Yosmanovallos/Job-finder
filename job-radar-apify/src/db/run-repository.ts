import type { QueryConfig, QueryResult, QueryResultRow } from "pg";
import { pool } from "./client.js";
import {
  RUN_RETENTION_DAYS,
  STALE_RUN_AFTER_MS,
  TELEMETRY_QUERY_TIMEOUT_MS,
  encodeRunCursor,
  type AttemptCounters,
  type AttemptStage,
  type AttemptStatus,
  type RunCursor,
  type RunStatus,
  type RunTelemetryStore
} from "../observability/run-telemetry.js";

// P2 — persistence for scrape_runs/source_attempts (see schema.sql block
// `p2-run-observability`). Every statement is bounded: pg honors a per-query
// `query_timeout` at runtime, but @types/pg only declares it on the client
// config, hence the local intersection type instead of a second pool (which
// would add connections against the shared Supabase pooler).
type TimedQueryConfig = QueryConfig & { query_timeout: number };

function timedQuery<R extends QueryResultRow>(text: string, values: unknown[]): Promise<QueryResult<R>> {
  const config: TimedQueryConfig = { text, values, query_timeout: TELEMETRY_QUERY_TIMEOUT_MS };
  return pool.query<R>(config);
}

const STALE_INTERVAL_SQL = "($1::double precision * INTERVAL '1 millisecond')";

export function createPgRunStore(): RunTelemetryStore {
  return {
    async insertRun(record) {
      const env = record.environment;
      await timedQuery(
        `INSERT INTO scrape_runs (id, workflow, trigger, is_test, country, git_sha, gh_repository, gh_workflow,
                                  gh_run_id, gh_run_attempt, status, started_at, heartbeat_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'running', $11, $11)`,
        [record.id, record.workflow, env.trigger, env.isTest, record.country, env.gitSha, env.ghRepository,
          env.ghWorkflow, env.ghRunId, env.ghRunAttempt, record.startedAt]
      );
    },
    async heartbeatRun(runId) {
      await timedQuery(`UPDATE scrape_runs SET heartbeat_at = NOW() WHERE id = $1 AND status = 'running'`, [runId]);
    },
    async insertAttempt(record) {
      await timedQuery(
        `INSERT INTO source_attempts (id, run_id, source_name, role_name, stage, status, started_at)
         VALUES ($1, $2, $3, $4, $5, 'running', $6)`,
        [record.id, record.runId, record.source.slice(0, 100), record.role?.slice(0, 255) ?? null, record.stage, record.startedAt]
      );
    },
    async finishAttempt(record) {
      const c = record.counters;
      await timedQuery(
        `UPDATE source_attempts
            SET status = $2, reason = $3, error_class = $4, finished_at = $5, duration_ms = $6,
                received_count = $7, valid_count = $8, filtered_count = $9, new_count = $10,
                duplicate_count = $11, failed_count = $12, request_count = $13
          WHERE id = $1 AND status = 'running'`,
        [record.id, record.status, record.reason, record.errorClass, record.finishedAt, record.durationMs,
          c.received, c.valid, c.filtered, c.new, c.duplicate, c.failed, record.requests]
      );
    },
    async timeoutRunningAttempts(runId, finishedAt) {
      const result = await timedQuery(
        `UPDATE source_attempts
            SET status = 'timeout', reason = 'deadline_exceeded', finished_at = $2,
                duration_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - started_at)) * 1000))::int
          WHERE run_id = $1 AND status = 'running'`,
        [runId, finishedAt]
      );
      return result.rowCount ?? 0;
    },
    async finishRun(record) {
      const t = record.totals;
      await timedQuery(
        `UPDATE scrape_runs
            SET status = $2, reason = $3, finished_at = $4, heartbeat_at = NOW(),
                attempts_total = $5, jobs_received = $6, jobs_new = $7, jobs_duplicate = $8
          WHERE id = $1 AND status = 'running'`,
        [record.id, record.status, record.reason, record.finishedAt, t.attempts, t.received, t.new, t.duplicate]
      );
    }
  };
}

/**
 * A process killed mid-run (Actions timeout/cancel, OOM) never writes its own
 * outcome. Called at the start of every tick: runs whose heartbeat stopped
 * become `interrupted`, together with their in-flight attempts. Idempotent,
 * and guarded on `status = 'running'` so a terminal state is never replaced.
 */
export async function reconcileStaleRuns(staleAfterMs = STALE_RUN_AFTER_MS): Promise<{ runs: number; attempts: number }> {
  const result = await timedQuery<{ runs: number; attempts: number }>(
    `WITH stale AS (
       UPDATE scrape_runs
          SET status = 'interrupted', reason = 'heartbeat_expired', finished_at = heartbeat_at, reconciled_at = NOW()
        WHERE status = 'running' AND heartbeat_at < NOW() - ${STALE_INTERVAL_SQL}
        RETURNING id, heartbeat_at
     ), attempts AS (
       UPDATE source_attempts AS a
          SET status = 'interrupted', reason = 'run_interrupted', finished_at = GREATEST(a.started_at, stale.heartbeat_at)
         FROM stale
        WHERE a.run_id = stale.id AND a.status = 'running'
        RETURNING a.id
     )
     SELECT (SELECT COUNT(*) FROM stale)::int AS runs, (SELECT COUNT(*) FROM attempts)::int AS attempts`,
    [staleAfterMs]
  );
  return result.rows[0] ?? { runs: 0, attempts: 0 };
}

/** Retention (OBS-012): bounded batches; attempts go with their run via ON DELETE CASCADE. */
export async function purgeOldRuns(retentionDays = RUN_RETENTION_DAYS, batchSize = 500, maxBatches = 10): Promise<number> {
  let purged = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const result = await timedQuery(
      `DELETE FROM scrape_runs WHERE id IN (
         SELECT id FROM scrape_runs
          WHERE status <> 'running' AND started_at < NOW() - make_interval(days => $1::int)
          ORDER BY started_at
          LIMIT $2::int)`,
      [retentionDays, batchSize]
    );
    const deleted = result.rowCount ?? 0;
    purged += deleted;
    if (deleted < batchSize) break;
  }
  return purged;
}

// --- Reads ------------------------------------------------------------------

export interface PublicRunSummary {
  id: string;
  name: string;
  count: number;
  status: RunStatus;
  reason: string | null;
  workflow: string;
  country: string | null;
  startedAt: string;
  finishedAt: string | null;
  jobs: { received: number; new: number; duplicate: number };
  attempts: { total: number; byStatus: Partial<Record<AttemptStatus, number>> };
}

export interface AdminRunSummary extends PublicRunSummary {
  trigger: string;
  isTest: boolean;
  gitSha: string | null;
  heartbeatAt: string;
  reconciledAt: string | null;
  finalTotals: { attempts: number; received: number; new: number; duplicate: number };
  actions: {
    repository: string | null;
    workflow: string | null;
    runId: string | null;
    runAttempt: number | null;
    url: string | null;
  };
}

export interface AttemptView {
  id: string;
  source: string;
  role: string | null;
  stage: AttemptStage;
  status: AttemptStatus;
  reason: string | null;
  errorClass: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  counters: AttemptCounters;
  requests: number | null;
  bytesReceived: number | null;
  costUsd: number | null;
}

export interface RunPage {
  runs: AdminRunSummary[];
  nextCursor: string | null;
}

export interface RunDetail {
  run: AdminRunSummary;
  attempts: AttemptView[];
  nextCursor: string | null;
}

interface RunRow {
  id: string;
  workflow: string;
  trigger: string;
  is_test: boolean;
  country: string | null;
  git_sha: string | null;
  gh_repository: string | null;
  gh_workflow: string | null;
  gh_run_id: string | null;
  gh_run_attempt: number | null;
  status: RunStatus;
  reason: string | null;
  started_at: Date;
  heartbeat_at: Date;
  finished_at: Date | null;
  reconciled_at: Date | null;
  attempts_total: number;
  jobs_received: number;
  jobs_new: number;
  jobs_duplicate: number;
  live_attempts: number;
  live_received: number;
  live_new: number;
  live_duplicate: number;
  by_status: Partial<Record<AttemptStatus, number>> | null;
}

interface AttemptRow {
  id: string;
  source_name: string;
  role_name: string | null;
  stage: AttemptStage;
  status: AttemptStatus;
  reason: string | null;
  error_class: string | null;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
  received_count: number | null;
  valid_count: number | null;
  filtered_count: number | null;
  new_count: number | null;
  duplicate_count: number | null;
  failed_count: number | null;
  request_count: number | null;
  bytes_received: string | null;
  cost_usd: string | null;
}

// A `running` run whose heartbeat expired is shown as `interrupted` even
// before the next tick reconciles it — reads never write (OBS-005). Live
// aggregates come from the attempts themselves, so an in-flight run shows
// real progress instead of the zeroed final totals.
const RUN_SELECT = `
  SELECT r.id, r.workflow, r.trigger, r.is_test, r.country, r.git_sha, r.gh_repository, r.gh_workflow,
         r.gh_run_id, r.gh_run_attempt,
         CASE WHEN r.status = 'running' AND r.heartbeat_at < NOW() - ${STALE_INTERVAL_SQL}
              THEN 'interrupted' ELSE r.status END AS status,
         CASE WHEN r.status = 'running' AND r.heartbeat_at < NOW() - ${STALE_INTERVAL_SQL}
              THEN 'heartbeat_expired' ELSE r.reason END AS reason,
         r.started_at, r.heartbeat_at, r.finished_at, r.reconciled_at,
         r.attempts_total, r.jobs_received, r.jobs_new, r.jobs_duplicate,
         t.live_attempts, t.live_received, t.live_new, t.live_duplicate, s.by_status
    FROM scrape_runs r
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS live_attempts,
             COALESCE(SUM(a.received_count) FILTER (WHERE a.stage = 'listing'), 0)::int AS live_received,
             COALESCE(SUM(a.new_count) FILTER (WHERE a.stage = 'listing'), 0)::int AS live_new,
             COALESCE(SUM(a.duplicate_count) FILTER (WHERE a.stage = 'listing'), 0)::int AS live_duplicate
        FROM source_attempts a
       WHERE a.run_id = r.id
    ) t ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(g.status, g.n) AS by_status
        FROM (
          SELECT CASE WHEN a.status = 'running' AND r.status = 'running'
                           AND r.heartbeat_at < NOW() - ${STALE_INTERVAL_SQL}
                      THEN 'interrupted' ELSE a.status END AS status,
                 COUNT(*)::int AS n
            FROM source_attempts a
           WHERE a.run_id = r.id
           GROUP BY 1
        ) g
    ) s ON TRUE`;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function numeric(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function toAdminRun(row: RunRow): AdminRunSummary {
  const startedAt = row.started_at.toISOString();
  const actionsUrl = row.gh_repository && row.gh_run_id
    ? `https://github.com/${row.gh_repository}/actions/runs/${row.gh_run_id}${row.gh_run_attempt ? `/attempts/${row.gh_run_attempt}` : ""}`
    : null;
  return {
    id: row.id,
    name: `${row.workflow} ${row.country ?? "global"} · ${startedAt.slice(0, 16)}Z`,
    count: row.live_received,
    status: row.status,
    reason: row.reason,
    workflow: row.workflow,
    country: row.country,
    startedAt,
    finishedAt: iso(row.finished_at),
    jobs: { received: row.live_received, new: row.live_new, duplicate: row.live_duplicate },
    attempts: { total: row.live_attempts, byStatus: row.by_status ?? {} },
    trigger: row.trigger,
    isTest: row.is_test,
    gitSha: row.git_sha,
    heartbeatAt: row.heartbeat_at.toISOString(),
    reconciledAt: iso(row.reconciled_at),
    finalTotals: {
      attempts: row.attempts_total,
      received: row.jobs_received,
      new: row.jobs_new,
      duplicate: row.jobs_duplicate
    },
    actions: {
      repository: row.gh_repository,
      workflow: row.gh_workflow,
      runId: row.gh_run_id,
      runAttempt: row.gh_run_attempt,
      url: actionsUrl
    }
  };
}

/** Explicit allow-list: nothing operational (roles, SHA, Actions ids, error classes) reaches the public API. */
export function toPublicRun(run: AdminRunSummary): PublicRunSummary {
  return {
    id: run.id,
    name: run.name,
    count: run.count,
    status: run.status,
    reason: run.reason,
    workflow: run.workflow,
    country: run.country,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    jobs: { received: run.jobs.received, new: run.jobs.new, duplicate: run.jobs.duplicate },
    attempts: { total: run.attempts.total, byStatus: { ...run.attempts.byStatus } }
  };
}

export async function listRuns(options: { limit: number; before: RunCursor | null; includeTest: boolean }): Promise<RunPage> {
  const result = await timedQuery<RunRow>(
    `${RUN_SELECT}
      WHERE ($2::boolean OR r.is_test = FALSE)
        AND ($3::timestamptz IS NULL OR (r.started_at, r.id) < ($3::timestamptz, $4::uuid))
      ORDER BY r.started_at DESC, r.id DESC
      LIMIT $5::int`,
    [STALE_RUN_AFTER_MS, options.includeTest, options.before?.startedAt ?? null, options.before?.id ?? null, options.limit + 1]
  );
  const rows = result.rows.slice(0, options.limit);
  const last = rows[rows.length - 1];
  return {
    runs: rows.map(toAdminRun),
    nextCursor: result.rows.length > options.limit && last
      ? encodeRunCursor({ startedAt: last.started_at.toISOString(), id: last.id })
      : null
  };
}

export async function getRunDetail(id: string, options: { limit: number; after: RunCursor | null }): Promise<RunDetail | null> {
  const runResult = await timedQuery<RunRow>(`${RUN_SELECT} WHERE r.id = $2::uuid`, [STALE_RUN_AFTER_MS, id]);
  const runRow = runResult.rows[0];
  if (!runRow) return null;
  const run = toAdminRun(runRow);

  const attemptsResult = await timedQuery<AttemptRow>(
    `SELECT id, source_name, role_name, stage, status, reason, error_class, started_at, finished_at, duration_ms,
            received_count, valid_count, filtered_count, new_count, duplicate_count, failed_count,
            request_count, bytes_received, cost_usd
       FROM source_attempts
      WHERE run_id = $1::uuid
        AND ($2::timestamptz IS NULL OR (started_at, id) > ($2::timestamptz, $3::uuid))
      ORDER BY started_at, id
      LIMIT $4::int`,
    [id, options.after?.startedAt ?? null, options.after?.id ?? null, options.limit + 1]
  );
  const rows = attemptsResult.rows.slice(0, options.limit);
  const last = rows[rows.length - 1];
  const runDead = run.status === "interrupted";
  return {
    run,
    attempts: rows.map((row) => ({
      id: row.id,
      source: row.source_name,
      role: row.role_name,
      stage: row.stage,
      status: runDead && row.status === "running" ? "interrupted" : row.status,
      reason: row.reason,
      errorClass: row.error_class,
      startedAt: row.started_at.toISOString(),
      finishedAt: iso(row.finished_at),
      durationMs: row.duration_ms,
      counters: {
        received: row.received_count,
        valid: row.valid_count,
        filtered: row.filtered_count,
        new: row.new_count,
        duplicate: row.duplicate_count,
        failed: row.failed_count
      },
      requests: row.request_count,
      bytesReceived: numeric(row.bytes_received),
      costUsd: numeric(row.cost_usd)
    })),
    nextCursor: attemptsResult.rows.length > options.limit && last
      ? encodeRunCursor({ startedAt: last.started_at.toISOString(), id: last.id })
      : null
  };
}
