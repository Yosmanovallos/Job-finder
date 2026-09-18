import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
require("dotenv").config({ quiet: true });
const { Pool } = require("pg");
const cs = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: cs, ssl: /supabase\.(co|com)/.test(cs) ? { rejectUnauthorized: false } : undefined, max: 1 });
const q = {
  // Of the last 200 URL_UPDATED actually sent, how many point at a job that no longer exists?
  sent_last24h_target_alive: `
    SELECT count(*) sent, count(j.id) target_still_active
    FROM indexing_queue q
    LEFT JOIN jobs j ON q.url LIKE '%/empleos/' || j.id::text || '/%'
    WHERE q.status='sent' AND q.sent_at > now()-interval '24 hours'`,
  sent_last24h_created_range: `SELECT min(created_at), max(created_at) FROM indexing_queue WHERE status='sent' AND sent_at > now()-interval '24 hours'`,
  pending_updated_by_week: `SELECT date_trunc('week', created_at)::date wk, count(*) FROM indexing_queue WHERE status='pending' AND notification_type='URL_UPDATED' GROUP BY 1 ORDER BY 1`,
  urls_with_both_types: `SELECT count(*) FROM (SELECT url FROM indexing_queue GROUP BY url HAVING count(DISTINCT notification_type)=2) x`,
  sample_ids: `(SELECT 'glassdoor_nodesc' k, id, title, location, published_at FROM jobs WHERE source='Glassdoor' AND description IS NULL ORDER BY created_at DESC LIMIT 1)
    UNION ALL (SELECT 'linkedin_desc_over30d', id, title, location, published_at FROM jobs WHERE source='LinkedIn' AND description IS NOT NULL AND published_at < now()-interval '31 days' ORDER BY last_seen_at DESC LIMIT 1)
    UNION ALL (SELECT 'torre_remote', id, title, location, published_at FROM jobs WHERE source='Torre' ORDER BY created_at DESC LIMIT 1)`,
  published_vs_lastseen: `SELECT count(*) FILTER (WHERE published_at < now()-interval '30 days' AND last_seen_at > now()-interval '2 days') live_but_validthrough_past FROM jobs`,
  workana_salary_sample: `SELECT salary_raw, salary_currency, employment_type FROM jobs WHERE source='Workana' AND salary_raw IS NOT NULL ORDER BY created_at DESC LIMIT 3`
};
const out = {};
const c = await pool.connect();
try {
  await c.query("BEGIN READ ONLY"); await c.query("SET LOCAL statement_timeout='120s'");
  for (const [k, s] of Object.entries(q)) { await c.query("SAVEPOINT q"); try { out[k] = (await c.query(s)).rows; await c.query("RELEASE SAVEPOINT q"); } catch (e) { await c.query("ROLLBACK TO SAVEPOINT q"); out[k] = { error: e.message }; } }
  await c.query("ROLLBACK");
} finally { c.release(); await pool.end(); }
console.log(JSON.stringify(out, null, 1));
