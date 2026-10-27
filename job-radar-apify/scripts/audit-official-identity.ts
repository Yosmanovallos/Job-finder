/** Read-only production canary for the public vacancy identity query. */
import dotenv from "dotenv";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import type { JobFilterParams } from "../src/lib/job-filters.js";

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
  console.log("[identity-canary] Solo lectura; no se escribió nada.");
} finally {
  await pool.end();
}
