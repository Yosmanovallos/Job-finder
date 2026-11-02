// Google Jobs plan F0 — read-only funnel baseline (docs/GOOGLE-JOBS-INDEXING-PLAN-2026-11.md).
// Aggregates only (no ids, no titles, no descriptions); one READ ONLY transaction, rolled back.
// Days are America/Bogota calendar days. Window: the last WINDOW_DAYS days.
// Run with cwd = Job-finder/job-radar-apify so dotenv picks up the app's own config.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
require("dotenv").config({ quiet: true });
const { Pool } = require("pg");

const WINDOW_DAYS = 14;
const cs = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: cs, ssl: /supabase\.(co|com)/.test(cs) ? { rejectUnauthorized: false } : undefined, max: 1 });

const DAY = (col) => `to_char((${col}) AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD')`;
const SINCE = `now() - interval '${WINDOW_DAYS} days'`;
const HOURS = (a, b) => `extract(epoch FROM (${b} - ${a})) / 3600.0`;
const P = (q, expr) => `round((percentile_cont(${q}) WITHIN GROUP (ORDER BY ${expr}))::numeric, 1)`;

const queries = {
  // 1. New rows per day/source and how many became Google-ready (first transition).
  new_by_day_source: `
    SELECT ${DAY("created_at")} AS day, source, country, count(*) new_rows,
      count(*) FILTER (WHERE direct_job_id IS NOT NULL) official_projection,
      count(*) FILTER (WHERE seo_ready_at IS NOT NULL) became_ready,
      count(*) FILTER (WHERE seo_ready_at IS NOT NULL AND seo_ready_at <= created_at + interval '24 hours') ready_within_24h,
      ${P(0.5, HOURS("created_at", "seo_ready_at"))} p50_h_created_to_ready,
      ${P(0.9, HOURS("created_at", "seo_ready_at"))} p90_h_created_to_ready
    FROM jobs WHERE created_at > ${SINCE}
    GROUP BY 1,2,3 ORDER BY 1,2,3`,

  // 2. Ready transitions per day (rows created earlier can become ready later).
  ready_by_day_source: `
    SELECT ${DAY("seo_ready_at")} AS day, source, count(*) became_ready,
      count(*) FILTER (WHERE direct_job_id IS NOT NULL) official_projection
    FROM jobs WHERE seo_ready_at > ${SINCE}
    GROUP BY 1,2 ORDER BY 1,2`,

  // 3. Detail state and readiness reasons of new rows, per source (F3).
  detail_status_by_source: `
    SELECT source, COALESCE(detail_status, 'null') detail_status, count(*) n,
      count(*) FILTER (WHERE seo_ready_at IS NOT NULL) ready
    FROM jobs WHERE created_at > ${SINCE}
    GROUP BY 1,2 ORDER BY 1,2`,
  not_ready_reasons_by_source: `
    SELECT j.source, r.reason, count(*) n
    FROM jobs j CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(j.seo_reasons) = 'array' THEN j.seo_reasons ELSE '[]'::jsonb END) r(reason)
    WHERE j.created_at > ${SINCE} AND j.seo_ready_at IS NULL
    GROUP BY 1,2 ORDER BY 1, 3 DESC`,

  // 4. Indexing API outcomes per day of the terminal event.
  sent_by_day_type: `
    SELECT ${DAY("sent_at")} AS day, notification_type, status, count(*) n
    FROM indexing_queue WHERE sent_at > ${SINCE} AND status IN ('sent', 'failed')
    GROUP BY 1,2,3 ORDER BY 1,2,3`,
  superseded_by_day_reason: `
    SELECT ${DAY("superseded_at")} AS day, notification_type, COALESCE(superseded_reason, 'null') reason, count(*) n
    FROM indexing_queue WHERE superseded_at > ${SINCE}
    GROUP BY 1,2,3 ORDER BY 1,2,3`,
  enqueued_by_day_priority: `
    SELECT ${DAY("created_at")} AS day, notification_type, priority, count(*) n
    FROM indexing_queue WHERE created_at > ${SINCE}
    GROUP BY 1,2,3 ORDER BY 1,2,3`,
  pending_now: `
    SELECT notification_type, priority, count(*) n,
      ${P(0.5, HOURS("created_at", "now()"))} p50_age_h,
      round(max(${HOURS("created_at", "now()")})::numeric, 1) max_age_h
    FROM indexing_queue WHERE status = 'pending'
    GROUP BY 1,2 ORDER BY 1,2`,

  // 5. Latency of each step for URL_UPDATED that were sent (F2: is quota spent on old jobs?).
  sent_latency_by_day: `
    SELECT ${DAY("q.sent_at")} AS day, count(*) sent,
      ${P(0.5, HOURS("q.created_at", "q.sent_at"))} p50_h_enqueued_to_sent,
      ${P(0.9, HOURS("q.created_at", "q.sent_at"))} p90_h_enqueued_to_sent,
      ${P(0.5, HOURS("j.seo_ready_at", "q.sent_at"))} p50_h_ready_to_sent,
      ${P(0.9, HOURS("j.seo_ready_at", "q.sent_at"))} p90_h_ready_to_sent,
      ${P(0.5, HOURS("j.created_at", "q.sent_at"))} p50_h_job_age_at_send,
      count(*) FILTER (WHERE q.sent_at - j.created_at > interval '48 hours') sent_job_older_48h
    FROM indexing_queue q JOIN jobs j ON j.id = q.job_id
    WHERE q.notification_type = 'URL_UPDATED' AND q.status = 'sent' AND q.sent_at > ${SINCE}
    GROUP BY 1 ORDER BY 1`,

  // 6. Fate of every job that became ready in the window, per source. A URL_UPDATED
  // only expires 7 days after its version, so only the cohort ready 8+ days ago has
  // a final fate; the last 7 days are reported apart as 'en_curso'. Buckets are
  // mutually exclusive (first match wins) and sum to 'ready'.
  ready_fate_by_source: `
    WITH r AS (
      SELECT j.id, j.source,
        CASE WHEN j.seo_ready_at <= now() - interval '8 days' THEN 'final_8_14d' ELSE 'en_curso_0_7d' END cohort,
        j.direct_job_id IS NOT NULL official,
        COALESCE(bool_or(q.status = 'sent'), false) sent,
        COALESCE(bool_or(q.status = 'superseded' AND q.superseded_reason = 'api_window_expired'), false) expired,
        COALESCE(bool_or(q.status = 'pending'), false) pending,
        COALESCE(bool_or(q.status = 'failed'), false) failed,
        count(q.id) queue_rows
      FROM jobs j LEFT JOIN indexing_queue q ON q.job_id = j.id AND q.notification_type = 'URL_UPDATED'
      WHERE j.seo_ready_at > ${SINCE}
      GROUP BY 1,2,3,4)
    SELECT cohort, source, count(*) ready,
      count(*) FILTER (WHERE official) official_no_api,
      count(*) FILTER (WHERE NOT official AND sent) api_sent,
      count(*) FILTER (WHERE NOT official AND NOT sent AND expired) expired_unsent,
      count(*) FILTER (WHERE NOT official AND NOT sent AND NOT expired AND pending) still_pending,
      count(*) FILTER (WHERE NOT official AND NOT sent AND NOT expired AND NOT pending AND failed) failed_only,
      count(*) FILTER (WHERE NOT official AND NOT sent AND NOT expired AND NOT pending AND NOT failed AND queue_rows > 0) superseded_other,
      count(*) FILTER (WHERE NOT official AND queue_rows = 0) never_enqueued
    FROM r GROUP BY 1,2 ORDER BY 1,3 DESC`,

  // Steady state of ADR 0004 and bulk-reclassification artifacts.
  first_api_window_expired: `
    SELECT min(superseded_at) first_expired, count(*) total_expired
    FROM indexing_queue WHERE superseded_reason = 'api_window_expired'`,
  ready_by_hour_top: `
    SELECT to_char(date_trunc('hour', seo_ready_at) AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24') AS hour, count(*) n
    FROM jobs WHERE seo_ready_at > ${SINCE}
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,

  // 7. Detail attempts per source (429 pressure for F3); source_attempts has no PII.
  detail_attempts_by_source: `
    SELECT source_name, status, count(*) attempts, sum(received_count) received,
      sum(valid_count) valid, sum(failed_count) failed
    FROM source_attempts WHERE stage = 'detail' AND started_at > ${SINCE}
    GROUP BY 1,2 ORDER BY 1,2`
};

const out = { window_days: WINDOW_DAYS };
const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '90s'");
  for (const [name, sql] of Object.entries(queries)) {
    await client.query("SAVEPOINT q");
    try {
      out[name] = (await client.query(sql)).rows;
      await client.query("RELEASE SAVEPOINT q");
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT q");
      out[name] = { error: e.message };
    }
  }
  await client.query("ROLLBACK");
} finally {
  client.release();
  await pool.end();
}
out.generated_at = new Date().toISOString();
console.log(JSON.stringify(out, null, 1));
