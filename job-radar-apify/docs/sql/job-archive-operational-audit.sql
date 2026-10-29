-- Read-only operational aggregates. No job bodies, user data or credentials.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';

SELECT jsonb_build_object(
  'observed_at', NOW(),
  'transaction_read_only', current_setting('transaction_read_only'),
  'archive_count', (SELECT count(*) FROM archived_jobs),
  'first_archived_at', (SELECT min(archived_at) FROM archived_jobs),
  'last_archived_at', (SELECT max(archived_at) FROM archived_jobs),
  'by_reason', (SELECT COALESCE(jsonb_object_agg(reason, n), '{}'::jsonb)
    FROM (SELECT reason, count(*) AS n FROM archived_jobs GROUP BY reason) g),
  'snapshot_identity_mismatches', (SELECT count(*) FROM archived_jobs
    WHERE snapshot->>'id' IS DISTINCT FROM job_id::text
       OR snapshot->>'url_hash' IS DISTINCT FROM url_hash),
  'missing_original_date', (SELECT count(*) FROM archived_jobs
    WHERE snapshot->>'published_at' IS NULL),
  'live_rows_with_archived_original_over_30d', (SELECT count(*)
    FROM archived_jobs a JOIN jobs j ON j.id = a.job_id
    WHERE j.is_active AND j.published_at >= NOW() - INTERVAL '30 days'
      AND (j.valid_through IS NULL OR j.valid_through > NOW())
      AND (a.snapshot->>'published_at')::timestamptz < NOW() - INTERVAL '30 days'),
  'expired_hashes_missing', (SELECT count(*) FROM archived_jobs a
    WHERE NOT EXISTS (SELECT 1 FROM expired_job_urls h WHERE h.url_hash = a.url_hash)),
  'rls_enabled', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.archived_jobs'::regclass),
  'public_grants', (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'archived_jobs'
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')),
  'archive_bytes', pg_total_relation_size('public.archived_jobs'::regclass),
  'database_bytes', pg_database_size(current_database())
) AS archive_audit;

ROLLBACK;
