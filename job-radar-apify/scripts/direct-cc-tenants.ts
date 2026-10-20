/**
 * Common Crawl in reverse (docs/adr/0006-direct-employers.md §7): list the
 * Workday and SmartRecruiters boards the public CDX index has seen, then
 * keep the ones that have postings in Colombia today. READ-ONLY and no
 * database: it prints a report for human review; a board only gets enabled
 * later through the seed or discovery approval, with its own evidence.
 *
 *   npx tsx scripts/direct-cc-tenants.ts [--ats workday|smartrecruiters|all] [--max-boards 400] [--deadline-min 14]
 *
 * The CDX index is often overloaded (504): every request is retried a few
 * times with growing pauses, and a crawl that keeps failing is skipped for
 * the previous one. Nothing here is retried against an ATS that throttles.
 */
import { colombiaFacet, WORKDAY_REF } from "../src/direct/ats/workday.js";
import { smartRecruitersIdFromUrl, workdayRefFromUrl } from "../src/direct/discovery/cc-refs.js";
import { boundedGet } from "../src/direct/http.js";
import { safeJson } from "../src/direct/text.js";

const UA = "BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)";
const CDX = "https://index.commoncrawl.org";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function cdxGet(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120_000) });
      if (response.status === 200) return await response.text();
      if (response.status === 404) return "";
    } catch {
      // network error or timeout: same as a 5xx
    }
    await sleep(10_000 * (attempt + 1));
  }
  return null;
}

async function crawls(): Promise<string[]> {
  const body = await cdxGet(`${CDX}/collinfo.json`);
  const list = body ? (safeJson(body) as { id: string }[] | undefined) : undefined;
  return (list ?? []).map((entry) => entry.id).slice(0, 3);
}

/** Every URL the index has for the pattern, page by page. Null when the index never answered. */
async function cdxUrls(crawl: string, pattern: string, deadline: number): Promise<string[] | null> {
  const base = `${CDX}/${crawl}-index?url=${encodeURIComponent(pattern)}&output=json&fl=url&filter=status:200`;
  const pages = safeJson((await cdxGet(`${base}&showNumPages=true`)) ?? "") as { pages?: number } | undefined;
  if (!pages?.pages) return null;
  const urls: string[] = [];
  for (let page = 0; page < pages.pages && Date.now() < deadline; page++) {
    const body = await cdxGet(`${base}&page=${page}`);
    if (body === null) return urls.length ? urls : null;
    for (const line of body.split("\n")) {
      const row = safeJson(line) as { url?: string } | undefined;
      if (row?.url) urls.push(row.url);
    }
    await sleep(2_000);
  }
  return urls;
}

async function workdayColombia(ref: string): Promise<{ total: number; colombia: number } | string> {
  const [, tenant, pod, site] = WORKDAY_REF.exec(ref)!;
  const response = await boundedGet(`https://${tenant}.${pod}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, {
    json: { appliedFacets: {}, limit: 1, offset: 0, searchText: "" }
  }).catch((error: Error) => ({ status: 0, body: error.message }));
  if (response.status !== 200) return `HTTP ${response.status}`;
  const body = safeJson(response.body) as { total?: number; facets?: unknown[] } | undefined;
  if (typeof body?.total !== "number") return "forma inesperada";
  const facet = colombiaFacet(body.facets);
  if (!facet) return `sin faceta de país (total ${body.total})`;
  return { total: body.total, colombia: facet.count };
}

async function smartRecruitersColombia(id: string): Promise<{ total: number; colombia: number } | string> {
  const response = await boundedGet(`https://api.smartrecruiters.com/v1/companies/${id}/postings?country=co&limit=1`).catch((error: Error) => ({ status: 0, body: error.message }));
  if (response.status !== 200) return `HTTP ${response.status}`;
  const body = safeJson(response.body) as { totalFound?: number } | undefined;
  return typeof body?.totalFound === "number" ? { total: body.totalFound, colombia: body.totalFound } : "forma inesperada";
}

async function main() {
  const ats = argValue("--ats", "all");
  const maxBoards = Number(argValue("--max-boards", "400"));
  const deadline = Date.now() + Number(argValue("--deadline-min", "14")) * 60_000;
  const available = await crawls();
  if (available.length === 0) throw new Error("el índice de Common Crawl no respondió (collinfo)");

  const found: { ats: string; ref: string; total: number; colombia: number }[] = [];
  const skipped: string[] = [];
  for (const [type, pattern, toRef, check] of [
    ["workday", "*.myworkdayjobs.com", workdayRefFromUrl, workdayColombia],
    ["smartrecruiters", "jobs.smartrecruiters.com/*", smartRecruitersIdFromUrl, smartRecruitersColombia]
  ] as const) {
    if (ats !== "all" && ats !== type) continue;
    let urls: string[] | null = null;
    let crawlUsed = "";
    for (const crawl of available) {
      urls = await cdxUrls(crawl, pattern, deadline);
      if (urls) {
        crawlUsed = crawl;
        break;
      }
    }
    if (!urls) {
      console.log(`[cc] ${type}: el índice CDX no respondió en ${available.join(", ")} — sin datos (no es "cero tenants").`);
      continue;
    }
    const refs = [...new Set(urls.map((url) => toRef(url)).filter((ref): ref is string => ref !== null))];
    console.log(`[cc] ${type}: ${urls.length} URLs en ${crawlUsed} → ${refs.length} tableros distintos; se revisan hasta ${maxBoards}.`);
    for (const ref of refs.slice(0, maxBoards)) {
      if (Date.now() > deadline) {
        skipped.push(`${type}: plazo cumplido, quedaron ${refs.length - refs.indexOf(ref)} tableros sin revisar`);
        break;
      }
      const result = await check(ref);
      if (typeof result === "string") continue;
      if (result.colombia > 0) found.push({ ats: type, ref, ...result });
      await sleep(1_500);
    }
  }
  found.sort((a, b) => b.colombia - a.colombia);
  console.log(`\n| ATS | tablero | total | Colombia |\n|---|---|---:|---:|`);
  for (const row of found) console.log(`| ${row.ats} | \`${row.ref}\` | ${row.total} | ${row.colombia} |`);
  console.log(`\n[cc] ${found.length} tableros con vacantes en Colombia. ${skipped.join("; ")}`);
  console.log("[cc] Solo lectura: nada se habilitó. Cada tablero pasa por revisión humana (dueño real del tablero) antes del seed.");
}

main().catch((error) => {
  console.error("[cc] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
