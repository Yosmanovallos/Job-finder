// Google Jobs plan F0 — picks the 20-URL Search Console inspection sample.
// Returns only public page URLs (what the sitemap already lists) plus timestamps
// and source; no titles, descriptions or other fields. One READ ONLY transaction.
// 10 recent ready jobs whose URL_UPDATED was sent + 10 that only the sitemap carries.
// Run with cwd = Job-finder/job-radar-apify so dotenv picks up the app's own config.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
require("dotenv").config({ quiet: true });
const { Pool } = require("pg");

const cs = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: cs, ssl: /supabase\.(co|com)/.test(cs) ? { rejectUnauthorized: false } : undefined, max: 1 });

// Both groups from the same cohort, ready 7–12 days ago: the API window has closed, so
// 'never sent' is final, and both had the same time to be crawled. Still live today.
// The URL is the newest URL_UPDATED row of the job (a title change re-queues it).
// md5(id) ordering spreads the pick across sources and hours without randomness.
const BASE = `
  FROM jobs j JOIN indexing_queue q ON q.job_id = j.id AND q.notification_type = 'URL_UPDATED'
  WHERE j.seo_ready = TRUE AND j.is_active = TRUE AND j.direct_job_id IS NULL
    AND j.seo_ready_at BETWEEN now() - interval '12 days' AND now() - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM indexing_queue n WHERE n.job_id = j.id AND n.notification_type = 'URL_UPDATED' AND n.created_at > q.created_at)`;

const queries = {
  api_sent: `SELECT DISTINCT ON (md5(j.id::text)) q.url, j.source, j.seo_ready_at, q.sent_at
    ${BASE} AND q.status = 'sent'
    ORDER BY md5(j.id::text) LIMIT 10`,
  // Never sent: closed as api_window_expired, so only the sitemap carries it.
  sitemap_only: `SELECT DISTINCT ON (md5(j.id::text)) q.url, j.source, j.seo_ready_at, q.superseded_at expired_at
    ${BASE} AND q.status = 'superseded' AND q.superseded_reason = 'api_window_expired'
      AND NOT EXISTS (SELECT 1 FROM indexing_queue s WHERE s.job_id = j.id AND s.status = 'sent' AND s.notification_type = 'URL_UPDATED')
    ORDER BY md5(j.id::text) LIMIT 10`
};

const out = {};
const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '60s'");
  for (const [name, sql] of Object.entries(queries)) out[name] = (await client.query(sql)).rows;
  await client.query("ROLLBACK");
} finally {
  client.release();
  await pool.end();
}
console.log(JSON.stringify(out, null, 1));
