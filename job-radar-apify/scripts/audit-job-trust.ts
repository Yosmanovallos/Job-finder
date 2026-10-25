/** Read-only, aggregate inventory for publication-date and availability work.
 * No URLs, titles, user data or source HTML leave the database.
 * `source_checked_at` currently means a source-side closure check for Torre;
 * its absence for other sources must not be interpreted as a failed check.
 */
import { pool } from "../src/db/client.js";
import { liveJobSql } from "../src/lib/job-freshness.js";

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(`
      SELECT source,
        COUNT(*)::integer AS visible,
        COUNT(*) FILTER (WHERE date_text IS NULL OR btrim(date_text) = '')::integer AS missing_source_date,
        COUNT(*) FILTER (WHERE published_at > NOW() + INTERVAL '1 hour')::integer AS future_publication_date,
        COUNT(*) FILTER (WHERE date_text ~* '(minute|minuto)' AND published_at < NOW() - INTERVAL '1 day')::integer AS old_stored_minute_text,
        COUNT(*) FILTER (WHERE source_checked_at IS NULL)::integer AS never_source_checked
      FROM jobs
      WHERE is_active = TRUE AND ${liveJobSql()}
      GROUP BY source
      ORDER BY visible DESC, source
    `);
    await client.query("COMMIT");
    console.log(JSON.stringify({
      measuredAt: new Date().toISOString(),
      scope: "visible rows in jobs; direct employer projections are excluded",
      sourceCheckNote: "source_checked_at is populated by the Torre closure pass only",
      bySource: result.rows
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[audit-job-trust] Falló:", (error as Error)?.message || error);
  process.exitCode = 1;
});
