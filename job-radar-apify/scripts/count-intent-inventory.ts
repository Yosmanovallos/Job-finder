/**
 * seo-intent-pages, task 1: READ-ONLY inventory count before any code.
 *
 * Counts, per country (CO, VE), the Google-ready canonical live jobs that:
 *   - pass the "sin experiencia" classifier of design D3 (national, Bogotá,
 *     Medellín, Cali);
 *   - are "remoto" by the PR #104 modality classifier (sqlJobModality).
 *
 * "Apta" = the sitemap's definition: canonical row of its identity group
 * (same DISTINCT ON as streamCanonicalSitemapJobs) THEN seoReadySql.
 * Country is counted two ways: strict (country = X) and as the pages filter
 * (country IS NULL OR country = X, buildJobWhere), since remote rows with a
 * NULL country show on both countries' pages.
 *
 * Safety: one transaction, BEGIN READ ONLY, SET LOCAL statement_timeout,
 * ROLLBACK at the end. No writes are possible from this connection.
 *
 *   cd job-radar-apify && npx tsx scripts/count-intent-inventory.ts
 */
import dotenv from "dotenv";
dotenv.config();

const { pool } = await import("../src/db/client.js");
const { sqlJobModality } = await import("../src/lib/job-modality.js");
const { sqlSinExperiencia, SIN_EXPERIENCIA_PHRASES } = await import("../src/lib/job-experience.js");
const { sqlSearchTitle } = await import("../src/lib/job-search-intent.js");

// The exact classifier of the pages (src/lib/job-experience.ts, design D3).
const sinExperiencia = sqlSinExperiencia("j.title", "j.description");
const phraseOnly = `(${sqlSearchTitle("j.title")} LIKE ANY (ARRAY[${SIN_EXPERIENCIA_PHRASES.map((p) => `'% ${p} %'`).join(", ")}]::text[]) OR ${sqlSearchTitle("j.description")} LIKE ANY (ARRAY[${SIN_EXPERIENCIA_PHRASES.map((p) => `'% ${p} %'`).join(", ")}]::text[]))`;
const fold = (col: string) => `LOWER(TRANSLATE(COALESCE(${col}, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'))`;

const canonicalReady = `
  SELECT canonical.id
  FROM (
    SELECT DISTINCT ON (lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))))
           id, seo_ready, is_active, published_at, valid_through
    FROM jobs
    WHERE is_active = TRUE AND published_at >= NOW() - INTERVAL '30 days' AND (valid_through IS NULL OR valid_through > NOW())
    ORDER BY lower(trim(title)), lower(trim(COALESCE(company, 'confidencial'))), lower(trim(COALESCE(location, CASE country WHEN 'VE' THEN 'venezuela' ELSE 'colombia' END))), published_at DESC, id DESC
  ) canonical
  WHERE canonical.seo_ready = TRUE`;

const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '30s'");
  const maxAge = (await client.query("SELECT 1")).rowCount; // connection check
  if (maxAge !== 1) throw new Error("no connection");

  const started = Date.now();
  const { rows } = await client.query(`
    WITH ready AS MATERIALIZED (${canonicalReady}),
    rows AS (
      SELECT j.country,
             ${fold("j.location")} AS loc,
             ${sinExperiencia} AS sin_exp,
             ${phraseOnly} AS sin_exp_phrase,
             -- ready only exposes id, so the classifier's bare columns are j's.
             ${sqlJobModality()} AS modality,
             (j.description IS NOT NULL AND length(j.description) > 0) AS has_description
      FROM ready JOIN jobs j ON j.id = ready.id
    )
    SELECT c.code,
      COUNT(*) FILTER (WHERE country = c.code) AS ready_strict,
      COUNT(*) FILTER (WHERE country IS NULL OR country = c.code) AS ready_page,
      COUNT(*) FILTER (WHERE (country IS NULL OR country = c.code) AND has_description) AS with_description,
      COUNT(*) FILTER (WHERE country = c.code AND sin_exp) AS sin_exp_strict,
      COUNT(*) FILTER (WHERE (country IS NULL OR country = c.code) AND sin_exp) AS sin_exp_page,
      COUNT(*) FILTER (WHERE (country IS NULL OR country = c.code) AND sin_exp_phrase AND NOT sin_exp) AS sin_exp_excluded_by_years,
      COUNT(*) FILTER (WHERE (country IS NULL OR country = c.code) AND sin_exp AND loc LIKE '%bogota%') AS sin_exp_bogota,
      COUNT(*) FILTER (WHERE (country IS NULL OR country = c.code) AND sin_exp AND loc LIKE '%medellin%') AS sin_exp_medellin,
      COUNT(*) FILTER (WHERE (country IS NULL OR country = c.code) AND sin_exp AND loc LIKE '%cali%') AS sin_exp_cali,
      COUNT(*) FILTER (WHERE (country IS NULL OR country = c.code) AND sin_exp AND loc LIKE '%caracas%') AS sin_exp_caracas,
      COUNT(*) FILTER (WHERE country = c.code AND modality = 'remoto') AS remoto_strict,
      COUNT(*) FILTER (WHERE (country IS NULL OR country = c.code) AND modality = 'remoto') AS remoto_page,
      COUNT(*) FILTER (WHERE country IS NULL AND modality = 'remoto') AS remoto_null_country,
      COUNT(*) FILTER (WHERE (country IS NULL OR country = c.code) AND modality = 'freelance') AS freelance_page
    FROM rows CROSS JOIN (VALUES ('CO'), ('VE')) AS c(code)
    GROUP BY c.code ORDER BY c.code`);
  const elapsedMs = Date.now() - started;
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), elapsedMs, counts: rows }, null, 2));

  // Cost of the candidate page predicate (the description classifier probed
  // per canonical row by primary key), as the page query would run it.
  const explain = await client.query(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    WITH ready AS MATERIALIZED (${canonicalReady})
    SELECT COUNT(*) FROM ready
    WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.id = ready.id AND (j.country IS NULL OR j.country = 'CO') AND ${sinExperiencia})`);
  console.log(explain.rows.map((r) => r["QUERY PLAN"]).filter((l: string) => /Execution Time|Planning Time|Buffers: shared|^\s*->\s*(Hash|Seq|Index|Unique|Sort)/.test(l)).join("\n"));
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  client.release();
  await pool.end();
}
