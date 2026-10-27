/** Read-only audit of board copies currently linked to official vacancies. */
import dotenv from "dotenv";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();
if (!process.argv.includes("--dry-run")) throw new Error("copy-audit requiere --dry-run");
assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);

const { pool } = await import("../src/db/client.js");
const client = await pool.connect();

const groups = `WITH official_groups AS (
  SELECT d.employer_id, p.title_key, p.location_key,
         COUNT(*)::int AS official_ids,
         COUNT(DISTINCT COALESCE(md5(NULLIF(btrim(p.description), '')), p.id::text))::int AS instances
  FROM jobs p JOIN direct_jobs d ON d.id = p.direct_job_id
  WHERE p.is_active = TRUE AND p.country = 'CO'
  GROUP BY d.employer_id, p.title_key, p.location_key
), hidden AS (
  SELECT c.id, p.id AS projection_id, c.source, c.company, c.title, c.location, c.location_key AS board_location_key,
         c.description AS board_description, p.description AS official_description,
         c.url AS board_url, p.url AS official_url,
         c.location_key = p.location_key AS same_location,
         g.official_ids, g.instances
  FROM jobs c
  JOIN jobs p ON p.id = c.superseded_by AND p.is_active = TRUE AND p.direct_job_id IS NOT NULL
  JOIN direct_jobs d ON d.id = p.direct_job_id
  JOIN official_groups g ON g.employer_id = d.employer_id AND g.title_key = p.title_key AND g.location_key = p.location_key
  WHERE c.direct_job_id IS NULL
)`;

try {
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '15000ms'");
  const hidden = await client.query(`${groups}
    SELECT COUNT(*)::int AS hidden,
           COUNT(*) FILTER (WHERE instances > 1 OR NOT same_location)::int AS needs_review,
           COUNT(*) FILTER (WHERE instances > 1)::int AS ambiguous_target,
           COUNT(*) FILTER (WHERE instances > 1 AND board_description IS NOT NULL)::int AS ambiguous_with_board_description,
           COUNT(*) FILTER (WHERE NOT same_location)::int AS different_location,
           COUNT(*) FILTER (WHERE NOT same_location AND board_location_key NOT IN ('colombia', 'remoto', 'remote'))::int AS different_specific_location,
           COUNT(*) FILTER (WHERE board_description IS NOT NULL)::int AS board_has_description,
           COUNT(*) FILTER (WHERE board_description IS NOT NULL AND official_description IS NOT NULL
             AND btrim(board_description) = btrim(official_description))::int AS exact_description,
           COUNT(*) FILTER (WHERE board_url = official_url)::int AS exact_url
    FROM hidden`);
  console.log(JSON.stringify({ kind: "hidden-summary", ...hidden.rows[0] }));

  const bySource = await client.query(`${groups}
    SELECT source, COUNT(*)::int AS hidden,
           COUNT(*) FILTER (WHERE instances > 1)::int AS ambiguous_target
    FROM hidden GROUP BY source ORDER BY hidden DESC, source LIMIT 20`);
  for (const row of bySource.rows) console.log(JSON.stringify({ kind: "hidden-source", ...row }));

  const examples = await client.query(`${groups}
    SELECT id, projection_id, company, title, location, source, official_ids, instances, same_location,
           (board_description IS NOT NULL AND official_description IS NOT NULL
             AND btrim(board_description) = btrim(official_description)) AS exact_description
    FROM hidden WHERE instances > 1 OR NOT same_location
    ORDER BY company, title, location LIMIT ${process.argv.includes("--all") ? 1000 : 25}`);
  for (const row of examples.rows) console.log(JSON.stringify({ kind: "review-sample", ...row }));

  const active = await client.query(`WITH official_groups AS (
      SELECT d.employer_id, p.title_key, p.location_key,
             COUNT(DISTINCT COALESCE(md5(NULLIF(btrim(p.description), '')), p.id::text))::int AS instances
      FROM jobs p JOIN direct_jobs d ON d.id = p.direct_job_id
      WHERE p.is_active = TRUE AND p.country = 'CO'
      GROUP BY d.employer_id, p.title_key, p.location_key
    )
    SELECT COUNT(DISTINCT c.id)::int AS active_board_rows,
           COUNT(DISTINCT c.id) FILTER (WHERE g.instances > 1)::int AS alongside_multiple_officials
    FROM jobs c JOIN employer_aliases a ON a.company_key = c.company_key
    JOIN official_groups g ON g.employer_id = a.employer_id
      AND g.title_key = c.title_key AND g.location_key = c.location_key
    WHERE c.is_active = TRUE AND c.direct_job_id IS NULL AND c.superseded_by IS NULL
      AND c.country = 'CO'`);
  console.log(JSON.stringify({ kind: "active-overlap", ...active.rows[0] }));
  await client.query("COMMIT");
  console.log("[copy-audit] Solo lectura; no se escribió nada.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
