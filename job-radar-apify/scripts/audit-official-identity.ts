/** Read-only production canary for the public vacancy identity query. */
import dotenv from "dotenv";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import type { JobFilterParams } from "../src/lib/job-filters.js";
import {
  VACANCY_IDENTITY_KEYS,
  locationKeySql,
  storedCompanyKeySql,
  titleKeySql,
  vacancyIdentitySourceSql
} from "../src/lib/company-identity.js";
import { liveJobSql } from "../src/lib/job-freshness.js";

dotenv.config();
if (!process.argv.includes("--dry-run")) throw new Error("identity-canary requiere --dry-run");
assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);

const { pool } = await import("../src/db/client.js");
const { getJobsPage } = await import("../src/db/job-repository.js");

const cases: { label: string; filters: JobFilterParams; limit: number }[] = [
  { label: "co-first", filters: { country: "CO" }, limit: 24 },
  { label: "ve-first", filters: { country: "VE" }, limit: 24 },
  { label: "altipal-official", filters: { country: "CO", company: "Altipal", sources: ["Portal oficial"] }, limit: 100 }
];

// Snapshot of the origin/main three-key read. Keep this in the audit script,
// never in the public query path, so both versions run against the same DB.
const legacyKeys = "identity_title, identity_company, identity_location";
const legacyColumns =
  `COALESCE(title_key, ${titleKeySql()}) AS identity_title, ` +
  `(CASE WHEN lower(COALESCE(company, '')) LIKE '%confidencial%' THEN lower(trim(company)) ` +
  `ELSE ${storedCompanyKeySql()} END) AS identity_company, ` +
  `COALESCE(location_key, ${locationKeySql()}) AS identity_location`;

function legacySource(where: string): string {
  return `(SELECT * FROM (
    SELECT keyed.*,
           bool_or(identity_location NOT IN ('colombia', 'venezuela') AND identity_location NOT IN ('remoto', 'remote'))
             OVER (PARTITION BY identity_title, identity_company, country) AS has_city_sibling
    FROM (SELECT jobs.*, ${legacyColumns} FROM jobs WHERE ${where}) keyed
  ) sibling_checked
  WHERE NOT (identity_location IN ('colombia', 'venezuela') AND has_city_sibling
             AND lower(COALESCE(company, '')) NOT LIKE '%confidencial%'))`;
}

function pageSql(version: "legacy" | "candidate"): string {
  const keys = version === "legacy" ? legacyKeys : VACANCY_IDENTITY_KEYS;
  const where = `is_active = TRUE AND ${liveJobSql()}`;
  const source = version === "legacy" ? legacySource(where) : vacancyIdentitySourceSql(where);
  return `WITH canonical AS MATERIALIZED (
    SELECT DISTINCT ON (${keys})
           id, title, company, company_key, location, url, source, sources, date_text, published_at,
           role_origin, country, employment_type, salary_min, salary_max,
           salary_currency, salary_raw, applicant_count,
           (published_at > NOW() - INTERVAL '48 hours') AS is_locked
    FROM ${source} jobs
    ORDER BY ${keys}, published_at DESC, id DESC
  ), filtered AS (
    SELECT canonical.*, 1 AS preference_rank, COUNT(*) OVER() AS total_count
    FROM canonical WHERE (country IS NULL OR country = $1)
  ), page AS (
    SELECT * FROM filtered ORDER BY preference_rank, published_at DESC, id DESC LIMIT 24 OFFSET 0
  )
  SELECT page.*, details.description, details.requirements, details.technologies
  FROM page JOIN jobs details ON details.id = page.id
  ORDER BY page.preference_rank, page.published_at DESC, page.id DESC`;
}

async function comparePages(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    for (const country of ["CO", "VE"]) {
      const measurements: Record<"legacy" | "candidate", number[]> = { legacy: [], candidate: [] };
      const totals: Record<"legacy" | "candidate", number> = { legacy: 0, candidate: 0 };
      // Reverse order on the second pass to reduce cache/order bias.
      for (const order of [["legacy", "candidate"], ["candidate", "legacy"]] as const) {
        for (const version of order) {
          const started = performance.now();
          const result = await client.query<{ total_count: string }>(pageSql(version), [country]);
          measurements[version].push(Math.round(performance.now() - started));
          totals[version] = Number(result.rows[0]?.total_count ?? 0);
        }
      }
      console.log(JSON.stringify({ sample: `${country.toLowerCase()}-comparison`, durationMs: measurements, total: totals }));
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  for (const sample of cases) {
    const started = performance.now();
    const result = await getJobsPage({ filters: { ...sample.filters }, limit: sample.limit, offset: 0, includeDetails: true });
    const durationMs = Math.round(performance.now() - started);
    if (result.jobs.length > sample.limit || new Set(result.jobs.map((job) => job.jobId)).size !== result.jobs.length) {
      throw new Error(`identity-canary: página inválida en ${sample.label}`);
    }
    console.log(JSON.stringify({ sample: sample.label, durationMs, total: result.total, returned: result.jobs.length }));
  }
  await comparePages();
  console.log("[identity-canary] Solo lectura; no se escribió nada.");
} finally {
  await pool.end();
}
