import { ReputationScoreInput, ReputationSourceAdapter } from "./types.js";
import { getComputrabajoDiscoveryCandidates, upsertReputationAliases } from "../../db/company-reputation-repository.js";
import { jitterDelay } from "../../engine/jitter-delay.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Max candidates per run — deliberately small (see docs/COMPANY-REPUTATION-PLAN.md's
// R4 section): this session's live investigation watched the same job URL
// go from 200 to 403 within minutes of a handful of test requests, so a
// monthly tick processes a modest batch and lets incremental runs cover
// more companies over time, rather than trying to do it all in one pass.
const MAX_CANDIDATES_PER_RUN = 15;
// Stop the whole run after this many CONSECUTIVE failures — same "a
// misconfigured/blocked run fails every request the same way" reasoning
// scripts/run-indexing-tick.ts already uses. A skip for "this company has
// no salary data on Computrabajo" does NOT count here (see below) — only
// real HTTP-level failures/blocks do, since that's the actual signal the
// source is degrading, not that a particular company lacks data.
const CONSECUTIVE_FAILURE_LIMIT = 3;

export function unwrapGoogleRedirect(url: string): string {
  const match = url.match(/google\.com\/url\?q=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : url;
}

// The job page's `offer-grid-article-company-url` anchor is the company's
// own real link — the ONLY reliable, universal way to its slug (verified
// live against real job pages: present on every one tested, unlike the
// "Mostrar los N salarios" widget, which only renders when that specific
// job posting happens to have salary submissions — an earlier version of
// this function keyed off that widget instead and silently missed real
// companies like Concentrix that simply had zero salary data). The slug
// itself is not guessable from the company name (verified live:
// /alpina/evaluaciones silently redirects to the homepage instead of
// Alpina's real, hash-bearing URL). A company whose only Computrabajo
// profile is the old hash-bearing directory form
// (`/empresas/ofertas-de-trabajo-de-<slug>-<hash>`) is excluded here —
// that form doesn't support the same `/<slug>/evaluaciones` + Referer
// pattern this fetcher relies on. No Referer needed for this first
// request — verified live that a cold fetch of a real job page succeeds
// directly.
//
// Pure parser, kept separate from the fetch itself for the same
// unit-testability reason as parseComputrabajoEvaluationsPage() below.
export function extractCompanySlugFromJobPageHtml(html: string): string | null {
  const tagMatch = html.match(/<a\b[^>]*offer-grid-article-company-url[^>]*>/i);
  if (!tagMatch) return null;
  const hrefMatch = tagMatch[0].match(/href=["']?https:\/\/co\.computrabajo\.com\/([a-z0-9-]+)["' >]/i);
  return hrefMatch ? hrefMatch[1] : null;
}

async function fetchCompanySlugFromJobPage(jobUrl: string): Promise<string | null> {
  const response = await fetch(jobUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) return null;
  const html = await response.text();
  return extractCompanySlugFromJobPageHtml(html);
}

const SCORE_PATTERN = /<span class="fwB mr5">\s*([\d.,]+)\s*<\/span>/;
const REVIEW_COUNT_PATTERN = /Evaluaciones\s*<span class="fc_gray">([\d.,]+)<\/span>/;

// Colombian formatting uses "." as a thousands separator (e.g. "9.306" =
// 9306) — never a decimal here since review counts are whole numbers.
function parseReviewCount(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

// Pure parser, kept separate from the fetch itself so it's unit-testable
// against a real, saved fixture (tests/fixtures/computrabajo-evaluaciones-sample.html)
// with no network call — same split Merco/GPTW already use
// (parseMercoTalentoHtml/filterCurrentCertifications vs their fetchers).
// `finalUrl` is the response's URL *after* following redirects: this
// session's live investigation found that a blocked/unknown slug can
// still 200 by silently landing on the homepage instead of erroring, so
// checking the status code alone isn't enough — the final URL must still
// actually be this company's own /evaluaciones page.
export function parseComputrabajoEvaluationsPage(
  html: string,
  finalUrl: string,
  slug: string
): ReputationScoreInput | null {
  if (!finalUrl.includes(`/${slug}/evaluaciones`)) return null;

  const scoreMatch = html.match(SCORE_PATTERN);
  if (!scoreMatch) return null;
  const countMatch = html.match(REVIEW_COUNT_PATTERN);

  return {
    companyName: "", // filled in by the caller, which already has the exact jobs.company string
    source: "computrabajo",
    score: Number(scoreMatch[1].replace(",", ".")),
    scoreScale: "1-5",
    reviewCount: countMatch ? parseReviewCount(countMatch[1]) : null,
    sourceUrl: finalUrl
  };
}

// The evaluations page needs a Referer pointing at the job page it was
// "reached from" (verified live: without it, 403; with it, 200 and real
// content) — a real visitor clicking that exact link on that exact job
// page would send the same header, so this states an honest fact about
// where the request came from rather than fabricating one.
async function fetchCompanyReputation(
  slug: string,
  refererJobUrl: string
): Promise<ReputationScoreInput | null> {
  const url = `https://co.computrabajo.com/${slug}/evaluaciones`;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Referer: refererJobUrl }
  });
  if (!response.ok) return null;
  const html = await response.text();
  return parseComputrabajoEvaluationsPage(html, response.url, slug);
}

export const computrabajoAdapter: ReputationSourceAdapter = {
  name: "Computrabajo",
  async fetch(): Promise<ReputationScoreInput[]> {
    const candidates = await getComputrabajoDiscoveryCandidates(MAX_CANDIDATES_PER_RUN);
    const results: ReputationScoreInput[] = [];
    const newAliases: { rawCompanyName: string; source: string; canonicalName: string }[] = [];
    let consecutiveFailures = 0;

    for (const candidate of candidates) {
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        console.warn(
          `⚠️ [Computrabajo] ${CONSECUTIVE_FAILURE_LIMIT} fallos consecutivos — deteniendo esta corrida, quedan ${
            candidates.length - results.length
          } candidatos sin procesar para la próxima.`
        );
        break;
      }

      try {
        await jitterDelay();
        const jobUrl = unwrapGoogleRedirect(candidate.jobUrl);
        const slug = await fetchCompanySlugFromJobPage(jobUrl);
        if (!slug) {
          // No salary/company link on this job's page — absence of data,
          // not a block. Doesn't count as a failure.
          continue;
        }

        await jitterDelay();
        const reputation = await fetchCompanyReputation(slug, jobUrl);
        if (!reputation) {
          consecutiveFailures++;
          continue;
        }

        consecutiveFailures = 0;
        reputation.companyName = candidate.company;
        results.push(reputation);
        // companyName === canonicalName by design here — see
        // docs/COMPANY-REPUTATION-PLAN.md's R4 section for why this
        // source's alias is never a separate curated seed script like
        // Merco/GPTW's: the target company already IS the raw
        // jobs.company string, no cross-platform name to reconcile.
        newAliases.push({
          rawCompanyName: candidate.company,
          source: "computrabajo",
          canonicalName: candidate.company
        });
      } catch (err) {
        consecutiveFailures++;
        console.warn(`⚠️ [Computrabajo] Falló "${candidate.company}": ${(err as Error)?.message ?? err}`);
      }
    }

    if (newAliases.length > 0) {
      await upsertReputationAliases(newAliases);
    }

    return results;
  }
};
