-- Read-only aggregate audit. No job/user identifiers, titles, URLs or PII.
-- Run the whole script: READ ONLY + bounded time + ROLLBACK are intentional.
-- Counts are stored rows/hashes, not canonical unique jobs or deletion events.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';

WITH p AS (
  SELECT now() AS observed_at,
    date_trunc('day', now() AT TIME ZONE 'America/Bogota')
      AT TIME ZONE 'America/Bogota' AS today_start
), j AS MATERIALIZED (
  SELECT source, country, is_active, published_at, last_seen_at,
    valid_through, source_checked_at,
    published_at >= p.observed_at - INTERVAL '30 days'
      AND (valid_through IS NULL OR valid_through > p.observed_at) AS in_age_window,
    published_at >= p.observed_at - INTERVAL '30 days'
      AND published_at < p.observed_at - INTERVAL '23 days'
      AND (valid_through IS NULL OR valid_through > p.observed_at) AS age_threshold_in_7d,
    CASE
      WHEN valid_through <= p.observed_at THEN 'source_deadline'
      WHEN published_at < p.observed_at - INTERVAL '30 days'
        AND last_seen_at < p.observed_at - INTERVAL '30 days' THEN 'age_and_unseen'
      WHEN published_at < p.observed_at - INTERVAL '30 days' THEN 'age_only_recently_seen'
      WHEN last_seen_at < p.observed_at - INTERVAL '30 days' THEN 'unseen_only'
      ELSE 'not_due'
    END AS current_purge_class
  FROM public.jobs CROSS JOIN p
), by_source AS (
  SELECT source, COALESCE(country, 'unknown_or_shared_remote') AS country,
    count(*) AS rows,
    count(*) FILTER (WHERE is_active AND in_age_window) AS active_in_age_window,
    count(*) FILTER (WHERE is_active AND age_threshold_in_7d) AS age_threshold_in_7d,
    count(*) FILTER (WHERE is_active AND age_threshold_in_7d
      AND valid_through > published_at + INTERVAL '30 days') AS age_7d_source_deadline_after_cap,
    count(*) FILTER (WHERE is_active AND age_threshold_in_7d
      AND valid_through IS NULL) AS age_7d_deadline_unknown,
    count(*) FILTER (WHERE is_active AND source_checked_at IS NOT NULL) AS has_check_cursor,
    count(*) FILTER (WHERE is_active AND age_threshold_in_7d
      AND last_seen_at >= (SELECT observed_at FROM p) - INTERVAL '48 hours') AS age_7d_seen_in_48h
  FROM j GROUP BY source, country
  ORDER BY rows DESC, source, country LIMIT 50
), purge_classes AS (
  SELECT current_purge_class, count(*) AS rows,
    count(*) FILTER (WHERE is_active) AS active_flag_rows
  FROM j GROUP BY current_purge_class ORDER BY current_purge_class
), e AS MATERIALIZED (
  SELECT expired_at, reason,
    CASE WHEN expired_at >= p.today_start - INTERVAL '7 days'
      THEN 'current_7_complete_days' ELSE 'previous_7_complete_days' END AS period
  FROM public.expired_job_urls CROSS JOIN p
  WHERE expired_at >= p.today_start - INTERVAL '14 days'
    AND expired_at < p.today_start
), history AS (
  SELECT period, reason, count(*) AS retained_unique_hashes
  FROM e GROUP BY period, reason ORDER BY period, reason
), daily AS (
  SELECT (expired_at AT TIME ZONE 'America/Bogota')::date AS day,
    reason, count(*) AS retained_unique_hashes
  FROM e GROUP BY day, reason ORDER BY day, reason
)
SELECT jsonb_build_object(
  'observed_at', p.observed_at,
  'transaction_read_only', current_setting('transaction_read_only'),
  'timezone', 'America/Bogota',
  'current_start', (p.today_start - INTERVAL '7 days') AT TIME ZONE 'America/Bogota',
  'current_end_exclusive', p.today_start AT TIME ZONE 'America/Bogota',
  'previous_start', (p.today_start - INTERVAL '14 days') AT TIME ZONE 'America/Bogota',
  'summary', (SELECT jsonb_build_object(
    'stored_rows', count(*),
    'active_flag_rows', count(*) FILTER (WHERE is_active),
    'active_in_age_window', count(*) FILTER (WHERE is_active AND in_age_window),
    'age_threshold_in_7d', count(*) FILTER (WHERE is_active AND age_threshold_in_7d),
    'age_7d_source_deadline_after_cap', count(*) FILTER (WHERE is_active AND age_threshold_in_7d
      AND valid_through > published_at + INTERVAL '30 days'),
    'age_7d_deadline_unknown', count(*) FILTER (WHERE is_active AND age_threshold_in_7d
      AND valid_through IS NULL),
    'active_never_source_checked', count(*) FILTER (WHERE is_active AND source_checked_at IS NULL)
  ) FROM j),
  'by_source_country', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM by_source s), '[]'::jsonb),
  'current_purge_classes', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM purge_classes c), '[]'::jsonb),
  'retained_hashes_by_period_reason', COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM history h), '[]'::jsonb),
  'retained_hashes_daily', COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM daily d), '[]'::jsonb)
) AS retention_audit
FROM p;

ROLLBACK;
