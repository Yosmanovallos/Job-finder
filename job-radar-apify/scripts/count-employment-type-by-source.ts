/**
 * employment-type-trust, task 1: READ-ONLY count of employment_type by
 * source among the Google-ready ("apta") rows, per country.
 *
 * Same "apta" as scripts/count-intent-wave2.ts (seo-intent-wave2 §1): the
 * canonical row of its identity group (the sitemap's DISTINCT ON) with
 * seo_ready, active and valid. Prints only aggregates (source, label, count);
 * no ids, titles or descriptions.
 *
 * Safety: one transaction, BEGIN READ ONLY, SET LOCAL statement_timeout,
 * ROLLBACK at the end. Nothing can be written from this connection. It reads
 * only short columns (no description), so it should cost far less Disk IO
 * than count-intent-wave2.ts.
 *
 *   cd job-radar-apify && npx tsx scripts/count-employment-type-by-source.ts
 */
import dotenv from "dotenv";
dotenv.config();

const { pool } = await import("../src/db/client.js");

const sql = `
  WITH ready AS MATERIALIZED (
    SELECT canonical.id
    FROM (
      SELECT DISTINCT ON (lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))))
             id, seo_ready
      FROM jobs
      WHERE is_active = TRUE AND published_at >= NOW() - INTERVAL '30 days' AND (valid_through IS NULL OR valid_through > NOW())
      ORDER BY lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))), published_at DESC, id DESC
    ) canonical
    WHERE canonical.seo_ready = TRUE
  )
  SELECT COALESCE(j.country, '(null)') AS country, j.source, COALESCE(j.employment_type, '(sin valor)') AS employment_type, COUNT(*)::int AS n
  FROM jobs j JOIN ready USING (id)
  GROUP BY 1, 2, 3
  ORDER BY 1, 4 DESC`;

const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '60s'");
  const started = Date.now();
  const { rows } = await client.query<{ country: string; source: string; employment_type: string; n: number }>(sql);
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), ms: Date.now() - started, rows }, null, 2));
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  client.release();
  await pool.end();
}
