-- Same canonical-then-readiness order as streamCanonicalSitemapJobs.
-- Read-only aggregates: no identifiers, job bodies, URLs or user data returned.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';

WITH p AS (SELECT now() AS observed_at), canonical AS MATERIALIZED (
  SELECT DISTINCT ON (
    lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))),
    lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END)))
  ) source, country, published_at, valid_through, last_seen_at, seo_ready
  FROM public.jobs CROSS JOIN p
  WHERE is_active = TRUE
    AND published_at >= p.observed_at - INTERVAL '30 days'
    AND (valid_through IS NULL OR valid_through > p.observed_at)
  ORDER BY lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))),
    lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))),
    published_at DESC, id DESC
), eligible AS MATERIALIZED (
  SELECT *, published_at < p.observed_at - INTERVAL '23 days' AS age_threshold_in_7d
  FROM canonical CROSS JOIN p WHERE seo_ready = TRUE
), grouped AS (
  SELECT source, COALESCE(country, 'unknown_or_shared_remote') AS country,
    count(*) AS seo_eligible_canonical_rows,
    count(*) FILTER (WHERE age_threshold_in_7d) AS age_threshold_in_7d,
    count(*) FILTER (WHERE age_threshold_in_7d
      AND valid_through > published_at + INTERVAL '30 days') AS age_7d_source_deadline_after_cap,
    count(*) FILTER (WHERE age_threshold_in_7d AND valid_through IS NULL) AS age_7d_deadline_unknown
  FROM eligible GROUP BY source, country
  ORDER BY seo_eligible_canonical_rows DESC, source, country LIMIT 50
)
SELECT jsonb_build_object(
  'observed_at', p.observed_at,
  'transaction_read_only', current_setting('transaction_read_only'),
  'summary', (SELECT jsonb_build_object(
    'seo_eligible_canonical_rows', count(*),
    'age_threshold_in_7d', count(*) FILTER (WHERE age_threshold_in_7d),
    'age_7d_source_deadline_after_cap', count(*) FILTER (WHERE age_threshold_in_7d
      AND valid_through > published_at + INTERVAL '30 days'),
    'age_7d_deadline_unknown', count(*) FILTER (WHERE age_threshold_in_7d AND valid_through IS NULL),
    'age_7d_seen_in_48h', count(*) FILTER (WHERE age_threshold_in_7d
      AND last_seen_at >= p.observed_at - INTERVAL '48 hours')
  ) FROM eligible),
  'by_source_country', COALESCE((SELECT jsonb_agg(to_jsonb(g)) FROM grouped g), '[]'::jsonb)
) AS retention_seo_audit FROM p;

ROLLBACK;
