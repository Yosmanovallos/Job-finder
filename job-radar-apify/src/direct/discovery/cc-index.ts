import { safeJson } from "../text.js";
import type { DirectAtsType } from "../types.js";

/**
 * Common Crawl CDX index reads (docs/adr/0006-direct-employers.md §7, §13).
 * The index is often overloaded (504): every request is retried a few times
 * with growing pauses, and an index that never answers is "no data" (null),
 * never "zero boards". Only URLs come back; no page is fetched.
 */

export const CDX = "https://index.commoncrawl.org";
const UA = "BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Body of a CDX response, "" for 404 (no captures), null when it never answered. */
export type CdxGet = (url: string) => Promise<string | null>;

/**
 * URL patterns per connector whose board ref is in the URL itself. Eightfold
 * (ref needs the employer's domain), SuccessFactors (career sites live on the
 * employer's host) and Magneto (also a job board) are left out.
 */
export const CC_PATTERNS: { atsType: DirectAtsType; pattern: string; sample: string }[] = [
  { atsType: "workday", pattern: "*.myworkdayjobs.com", sample: "https://rappi.wd12.myworkdayjobs.com/Rappi_jobs" },
  { atsType: "smartrecruiters", pattern: "jobs.smartrecruiters.com/*", sample: "https://jobs.smartrecruiters.com/BoschGroup/1" },
  { atsType: "greenhouse", pattern: "boards.greenhouse.io/*", sample: "https://boards.greenhouse.io/vtex/jobs/1" },
  { atsType: "greenhouse", pattern: "job-boards.greenhouse.io/*", sample: "https://job-boards.greenhouse.io/vtex/jobs/1" },
  { atsType: "lever", pattern: "jobs.lever.co/*", sample: "https://jobs.lever.co/yuno/1" },
  { atsType: "ashby", pattern: "jobs.ashbyhq.com/*", sample: "https://jobs.ashbyhq.com/addi/1" },
  { atsType: "teamtailor", pattern: "*.teamtailor.com", sample: "https://qualacompany.teamtailor.com/jobs" }
];

/** Retries stop at `deadline`: a slow index ends the read, it never outlives the run. */
export function httpCdxGet(deadline: number, timeoutMs = 120_000, pauseMs = 10_000): CdxGet {
  return async (url) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const left = deadline - Date.now();
      if (left < 5_000) return null;
      try {
        const response = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(Math.min(timeoutMs, left)) });
        if (response.status === 200) return await response.text();
        if (response.status === 404) return "";
      } catch {
        // network error or timeout: same as a 5xx
      }
      await sleep(pauseMs * (attempt + 1));
    }
    return null;
  };
}

/** The newest crawls, newest first; [] when the index never answered. */
export async function latestCrawls(get: CdxGet, count = 3): Promise<string[]> {
  const body = await get(`${CDX}/collinfo.json`);
  const list = body ? (safeJson(body) as { id: string }[] | undefined) : undefined;
  return (Array.isArray(list) ? list : []).map((entry) => entry.id).slice(0, count);
}

/** URLs the index has for the pattern, page by page, bounded by pages and deadline. Null when it never answered. */
export async function cdxUrls(
  get: CdxGet,
  crawl: string,
  pattern: string,
  options: { deadline: number; maxPages: number; pauseMs: number }
): Promise<string[] | null> {
  const base = `${CDX}/${crawl}-index?url=${encodeURIComponent(pattern)}&output=json&fl=url&filter=status:200`;
  const pages = safeJson((await get(`${base}&showNumPages=true`)) ?? "") as { pages?: number } | undefined;
  if (!pages?.pages) return null;
  const urls: string[] = [];
  for (let page = 0; page < Math.min(pages.pages, options.maxPages) && Date.now() < options.deadline; page++) {
    const body = await get(`${base}&page=${page}`);
    if (body === null) return urls.length ? urls : null;
    for (const line of body.split("\n")) {
      const row = safeJson(line) as { url?: string } | undefined;
      if (typeof row?.url === "string") urls.push(row.url);
    }
    if (options.pauseMs > 0) await sleep(options.pauseMs);
  }
  return urls;
}
