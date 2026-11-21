/**
 * AI Resume Studio R2 — live sample of real Colombian vacancy links (doc 11
 * §8, R2 exit criterion): what % the resolver turns into a JobSnapshot
 * WITHOUT an LLM.
 *
 * Approved by the owner on 2026-11-21 («Autorizo que los escoja»), with
 * these conditions, enforced here:
 * - only public pages of Computrabajo, Elempleo, Magneto, ATS and employer
 *   sites (candidates come from BuscoTrabajo's own public API, so choosing
 *   them touches no third-party site);
 * - one GET per link (plus that host's robots.txt, read once), sequential,
 *   with a pause between requests; no login, no LinkedIn, no CAPTCHA or
 *   anti-bot bypass (the resolver never retries a challenge);
 * - generic client identity (BuscoTrabajoBot), nothing about any person in
 *   headers or URLs;
 * - only aggregated results and per-link outcomes WITHOUT page content are
 *   written; no HTML is stored.
 *
 * Our database is NOT consulted (the run has no DATABASE_URL), so every link
 * goes the live way: the result is the worst case. In production, links we
 * already store resolve from our base first (step 1b) without any request.
 *
 *   npx tsx scripts/resume-studio-link-sample.ts                 (dry run: prints the plan)
 *   npx tsx scripts/resume-studio-link-sample.ts --allow-live-sources --out <file.json>
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { boundedGet } from "../src/direct/http.js";
import { readAtsPosting } from "../src/resume-studio/job-link/ats.js";
import type { JobSnapshot } from "../src/resume-studio/job-link/job-snapshot.js";
import { classifyLink } from "../src/resume-studio/job-link/link-kind.js";
import { resolveJobLink, type JobLinkResult, type ResolverDeps } from "../src/resume-studio/job-link/resolve.js";
import { safeFetchHtml } from "../src/resume-studio/job-link/safe-fetch.js";

const API = "https://buscotrabajo.co/api/v1/jobs";
const PLAN: { source: string; take: number }[] = [
  { source: "Computrabajo", take: 8 },
  { source: "Elempleo", take: 8 },
  { source: "Magneto", take: 6 },
  { source: "Portal oficial", take: 8 }
];
const PAUSE_MS = 2_000;
const live = process.argv.includes("--allow-live-sources");
const outIndex = process.argv.indexOf("--out");
const outFile = outIndex > 0 ? process.argv[outIndex + 1] : null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Candidate {
  source: string;
  url: string;
}

// The public API returns 3 vacancies per call, 5 calls/min and 25/day per
// client (src/lib/public-api-policy.ts): different searches, one call every
// 13 s, at most 16 calls (some of the day's quota went to checking the API).
const SEARCHES = ["", "auxiliar", "vendedor", "analista", "asesor", "operario", "ingeniero", "conductor"];
const MAX_API_CALLS = 16;
const API_PAUSE_MS = 13_000;

async function candidates(): Promise<Candidate[]> {
  const picked: Candidate[] = [];
  const seenUrls = new Set<string>();
  const seenHosts = new Map<string, number>();
  let calls = 0;
  for (const { source, take } of PLAN) {
    let count = 0;
    for (const search of SEARCHES) {
      if (count >= take || calls >= MAX_API_CALLS) break;
      const query = new URLSearchParams({ country: "CO", sources: source, limit: "3" });
      if (search) query.set("search", search);
      if (calls > 0) await sleep(API_PAUSE_MS);
      calls++;
      let response;
      try {
        response = await boundedGet(`${API}?${query}`);
      } catch (error) {
        console.warn(`[link-sample] API ${source}/${search || "-"}: ${(error as Error).message}`);
        continue;
      }
      if (response.status !== 200) {
        console.warn(`[link-sample] API ${source}/${search || "-"}: HTTP ${response.status}`);
        continue;
      }
      const body = JSON.parse(response.body) as { jobs?: { applicationUrl?: string | null }[]; data?: { applicationUrl?: string | null }[] };
      for (const job of body.jobs ?? body.data ?? []) {
        const url = job.applicationUrl;
        if (!url || count >= take || seenUrls.has(url)) continue;
        const kind = classifyLink(url);
        if (!kind || kind.kind === "paste_only") continue; // never LinkedIn or login sites
        const host = new URL(url).hostname;
        // Spread "Portal oficial" across employers: at most 2 links per host.
        if (source === "Portal oficial" && (seenHosts.get(host) ?? 0) >= 2) continue;
        seenHosts.set(host, (seenHosts.get(host) ?? 0) + 1);
        seenUrls.add(url);
        picked.push({ source, url });
        count++;
      }
    }
  }
  return picked;
}

function liveDeps(): ResolverDeps {
  let lastHost = "";
  const pace = async (url: string) => {
    const host = new URL(url).hostname;
    if (host === lastHost) await sleep(PAUSE_MS);
    lastHost = host;
  };
  return {
    // No database: the worst case, every link goes live.
    ourJobDraft: async () => null,
    findJobIdByUrl: async () => null,
    findSameJob: async () => null,
    getCached: async () => null,
    putCached: async () => undefined,
    readAts: async (ref) => {
      await sleep(PAUSE_MS);
      return readAtsPosting(ref, boundedGet);
    },
    fetchHtml: async (url) => {
      await pace(url);
      return safeFetchHtml(url);
    }
  };
}

/** Field presence only — never the text itself. */
function shape(snapshot: JobSnapshot) {
  return {
    via: snapshot.via,
    hasCompany: snapshot.company !== null,
    hasLocation: snapshot.location !== null,
    hasSalary: snapshot.salary !== null,
    hasDatePosted: snapshot.datePosted !== null,
    hasValidThrough: snapshot.validThrough !== null,
    descriptionChars: snapshot.description.length
  };
}

async function main() {
  console.log(`[link-sample] ${live ? "EN VIVO" : "--dry-run"}: ${PLAN.map((p) => `${p.take} ${p.source}`).join(", ")}.`);
  if (!live) {
    console.log("[link-sample] Nada se descarga sin --allow-live-sources (aprobación del propietario 2026-11-21).");
    return;
  }
  const picked = await candidates();
  console.log(`[link-sample] ${picked.length} links elegidos de la API pública de BuscoTrabajo.`);
  const rows: Record<string, unknown>[] = [];
  for (const candidate of picked) {
    const started = Date.now();
    let result: JobLinkResult;
    try {
      result = await resolveJobLink(candidate.url, liveDeps());
    } catch (error) {
      result = { status: "paste_required", reason: "fetch_failed", sourceUrl: candidate.url, canonicalUrl: null };
      console.warn(`[link-sample] error inesperado: ${(error as Error).name}`);
    }
    const kind = classifyLink(candidate.url);
    const row = {
      source: candidate.source,
      host: new URL(candidate.url).hostname,
      // The path is hashed: the outcome is what matters, not the posting.
      pathHash: createHash("sha256").update(new URL(candidate.url).pathname).digest("hex").slice(0, 12),
      route: kind?.kind === "ats" ? `ats:${kind.ref.ats}` : (kind?.kind ?? "invalid"),
      status: result.status,
      ...(result.status === "resolved" ? shape(result.snapshot) : { reason: result.reason }),
      ms: Date.now() - started
    };
    rows.push(row);
    console.log(`  ${row.status === "resolved" ? "✔" : "·"} ${row.source.padEnd(14)} ${row.host.padEnd(34)} ${row.status}${"via" in row ? ` via ${row.via}` : ` (${row.reason})`} ${row.ms} ms`);
  }
  const resolved = rows.filter((row) => row.status === "resolved").length;
  const bySource: Record<string, { total: number; resolved: number }> = {};
  const reasons: Record<string, number> = {};
  for (const row of rows) {
    const entry = (bySource[row.source as string] ??= { total: 0, resolved: 0 });
    entry.total++;
    if (row.status === "resolved") entry.resolved++;
    else reasons[String(row.reason)] = (reasons[String(row.reason)] ?? 0) + 1;
  }
  const summary = {
    date: new Date().toISOString(),
    total: rows.length,
    resolvedWithoutLlm: resolved,
    percent: rows.length ? Math.round((resolved / rows.length) * 1000) / 10 : 0,
    bySource,
    pasteReasons: reasons,
    note: "Peor caso: sin consultar nuestra base (paso 1b). Solo lectura, robots.txt respetado, un GET por link."
  };
  console.log(JSON.stringify(summary, null, 2));
  if (outFile) await writeFile(outFile, `${JSON.stringify({ summary, rows }, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(`[link-sample] ${(error as Error).message}`);
  process.exit(1);
});
