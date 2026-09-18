// Phase A read-only inventory. Aggregates only; one READ ONLY transaction.
// Run with cwd = Job-finder/job-radar-apify so dotenv picks up the app's own config.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
require("dotenv").config({ quiet: true });
const { Pool } = require("pg");

const cs = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: cs, ssl: /supabase\.(co|com)/.test(cs) ? { rejectUnauthorized: false } : undefined, max: 1 });

const CANON = `
WITH canon AS (
  SELECT DISTINCT ON (lower(trim(title)), lower(trim(COALESCE(company,'confidencial'))),
                      lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))))
         *
  FROM jobs WHERE is_active = TRUE
  ORDER BY lower(trim(title)), lower(trim(COALESCE(company,'confidencial'))),
           lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))),
           published_at DESC, id DESC
), c AS (
  SELECT *,
    COALESCE(length(trim(description)),0) AS dlen,
    (description IS NOT NULL AND length(trim(description)) > 0) AS has_desc,
    (jsonb_typeof(requirements)='array' AND jsonb_array_length(requirements) > 0) AS has_req,
    (employment_type IS NOT NULL) AS has_emp,
    (salary_raw IS NOT NULL OR (salary_currency IS NOT NULL AND (COALESCE(salary_min,0)>0 OR COALESCE(salary_max,0)>0))) AS has_salary,
    (location ~* '(remot|h[ií]brid|teletrabajo|home office)') AS has_remote_info,
    (company IS NOT NULL AND location IS NOT NULL AND url IS NOT NULL) AS describable
  FROM canon
)`;

const queries = {
  totals: `SELECT (SELECT count(*) FROM jobs) total_rows, (SELECT count(*) FROM jobs WHERE is_active) active_rows`,
  canonical_summary: `${CANON}
    SELECT count(*) canonical_active,
      count(*) FILTER (WHERE describable) publicly_describable_today,
      count(*) FILTER (WHERE has_desc) with_description,
      count(*) FILTER (WHERE NOT has_desc) without_description,
      count(*) FILTER (WHERE has_req) with_requirements,
      count(*) FILTER (WHERE has_emp) with_employment_type,
      count(*) FILTER (WHERE has_salary) with_salary,
      count(*) FILTER (WHERE has_remote_info) with_remote_or_hybrid_text,
      count(*) FILTER (WHERE location ~* '^(remoto|remote)$') bare_remote_location,
      count(*) FILTER (WHERE lower(company) IN ('confidencial','empresa confidencial')) confidential_company,
      count(*) FILTER (WHERE published_at < now() - interval '30 days') published_over_30d_ago,
      count(*) FILTER (WHERE has_desc AND dlen >= 300) desc_ge_300_chars,
      count(*) FILTER (WHERE has_desc AND dlen < 300) desc_lt_300_chars,
      count(*) FILTER (WHERE has_desc AND lower(trim(description)) = lower(trim(title))) desc_equals_title,
      count(*) FILTER (WHERE description ~* '(captcha|cloudflare|access denied|enable javascript|cookies)') desc_suspicious_tokens,
      count(*) FILTER (WHERE description ~* 'buscotrabajo') desc_mentions_buscotrabajo
    FROM c`,
  by_source: `${CANON}
    SELECT source, count(*) n,
      count(*) FILTER (WHERE has_desc) desc,
      round(100.0*count(*) FILTER (WHERE has_desc)/count(*),1) desc_pct,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY dlen) FILTER (WHERE has_desc) desc_p50_chars,
      count(*) FILTER (WHERE has_desc AND dlen >= 300) desc_ge300,
      count(*) FILTER (WHERE has_req) req, count(*) FILTER (WHERE has_emp) emp,
      count(*) FILTER (WHERE has_salary) salary, count(*) FILTER (WHERE has_remote_info) remote_txt,
      count(*) FILTER (WHERE abs(extract(epoch FROM (published_at - created_at))) < 5) pub_eq_created
    FROM c GROUP BY source ORDER BY n DESC`,
  by_country: `${CANON}
    SELECT COALESCE(country,'NULL(remote)') country, count(*) n, count(*) FILTER (WHERE has_desc) desc,
      round(100.0*count(*) FILTER (WHERE has_desc)/count(*),1) desc_pct
    FROM c GROUP BY 1 ORDER BY n DESC`,
  by_age: `${CANON}
    SELECT CASE WHEN published_at > now()-interval '2 days' THEN 'a_<2d'
                WHEN published_at > now()-interval '7 days' THEN 'b_2-7d'
                WHEN published_at > now()-interval '14 days' THEN 'c_7-14d'
                WHEN published_at > now()-interval '30 days' THEN 'd_14-30d'
                ELSE 'e_>30d' END age, count(*) n, count(*) FILTER (WHERE has_desc) desc,
           round(100.0*count(*) FILTER (WHERE has_desc)/count(*),1) desc_pct
    FROM c GROUP BY 1 ORDER BY 1`,
  by_created_age: `${CANON}
    SELECT CASE WHEN created_at > now()-interval '2 days' THEN 'a_<2d'
                WHEN created_at > now()-interval '7 days' THEN 'b_2-7d'
                WHEN created_at > now()-interval '30 days' THEN 'c_7-30d'
                ELSE 'd_>30d' END first_seen, count(*) n, count(*) FILTER (WHERE has_desc) desc,
           round(100.0*count(*) FILTER (WHERE has_desc)/count(*),1) desc_pct
    FROM c GROUP BY 1 ORDER BY 1`,
  by_role_top20: `${CANON}
    SELECT role_origin, count(*) n, count(*) FILTER (WHERE has_desc) desc,
      round(100.0*count(*) FILTER (WHERE has_desc)/count(*),1) desc_pct
    FROM c GROUP BY 1 ORDER BY n DESC LIMIT 20`,
  desc_len_buckets: `${CANON}
    SELECT CASE WHEN NOT has_desc THEN '0_none' WHEN dlen < 100 THEN '1_<100' WHEN dlen < 300 THEN '2_100-299'
                WHEN dlen < 800 THEN '3_300-799' WHEN dlen < 2000 THEN '4_800-1999' ELSE '5_2000+' END bucket,
           count(*) n FROM c GROUP BY 1 ORDER BY 1`,
  detail_fetched_at_usage: `SELECT count(*) FILTER (WHERE description_fetched_at IS NOT NULL) with_description_fetched_at FROM jobs`,
  indexing_queue: `SELECT notification_type, status, count(*) n, min(created_at) oldest, max(created_at) newest
    FROM indexing_queue GROUP BY 1,2 ORDER BY 1,2`,
  indexing_last24h: `SELECT status, count(*) FROM indexing_queue WHERE sent_at > now()-interval '24 hours' GROUP BY 1`,
  indexing_distinct_urls: `SELECT count(*) rows_total, count(DISTINCT url) distinct_urls FROM indexing_queue`,
  detail_attempts_7d: `SELECT source_name, status, count(*) attempts, sum(received_count) received, sum(valid_count) valid, sum(failed_count) failed, sum(filtered_count) filtered
    FROM source_attempts WHERE stage='detail' AND started_at > now()-interval '7 days'
    GROUP BY 1,2 ORDER BY 1,2`,
  circuit_state: `SELECT source_name, failures, open_until FROM source_circuit_state ORDER BY 1`,
  new_rows_24h_by_source: `SELECT source, count(*) n,
      count(*) FILTER (WHERE description IS NOT NULL AND length(trim(description))>0) desc
    FROM jobs WHERE created_at > now()-interval '24 hours' GROUP BY 1 ORDER BY n DESC`
};

const out = {};
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
