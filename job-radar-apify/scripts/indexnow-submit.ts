/**
 * IndexNow submission (SEO Fase B, ADR 0011). DRY-RUN BY DEFAULT: it lists
 * what would be sent and never touches the network. Only `--execute` POSTs,
 * once, to api.indexnow.org.
 *
 *   npm run indexnow:submit                      # dry-run, last 24 h
 *   npm run indexnow:submit -- --hours 72        # dry-run, wider window
 *   npm run indexnow:submit -- --execute         # real POST (owner approval)
 *
 * URLs: the same Google-ready, canonical, recent rows as
 * /sitemap-jobs-recent.xml (queryRecentSeoReadyJobs), read-only. No state
 * table: run it on a cadence equal to --hours (e.g. daily with 24) so each
 * job is sent about once. Not scheduled anywhere yet — that waits for the
 * owner's Bing Webmaster Tools verification.
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { queryRecentSeoReadyJobs } from "../src/db/job-repository.js";
import { buildJobUrl, isPubliclyDescribable } from "../src/lib/job-seo.js";
import { buildIndexNowPayload, submitIndexNow, INDEXNOW_KEY_LOCATION } from "../src/lib/indexnow.js";
import { RECENT_SITEMAP_WINDOW_HOURS } from "../src/lib/recent-jobs.js";

dotenv.config();

function parseArgs(argv: string[]): { execute: boolean; hours: number } {
  const execute = argv.includes("--execute");
  if (execute && argv.includes("--dry-run")) throw new Error("Usa --execute o --dry-run, no ambos.");
  const index = argv.indexOf("--hours");
  const hours = index >= 0 ? Number(argv[index + 1]) : 24;
  if (!Number.isInteger(hours) || hours < 1 || hours > RECENT_SITEMAP_WINDOW_HOURS) {
    throw new Error(`--hours debe ser un entero entre 1 y ${RECENT_SITEMAP_WINDOW_HOURS}.`);
  }
  return { execute, hours };
}

async function main() {
  const { execute, hours } = parseArgs(process.argv.slice(2));
  const jobs = await queryRecentSeoReadyJobs(hours);
  const payload = buildIndexNowPayload(jobs.filter(isPubliclyDescribable).map((job) => buildJobUrl(job)));
  const result = await submitIndexNow(payload, { execute, fetch: execute ? fetch : undefined });
  console.log(
    JSON.stringify({
      event: "indexnow_submit",
      mode: execute ? "execute" : "dry-run",
      windowHours: hours,
      keyLocation: INDEXNOW_KEY_LOCATION,
      ...result,
      sample: payload.urlList.slice(0, 5)
    })
  );
  if (result.status === "failed") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[indexnow] Error:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
