// Which pages may load Google AdSense (openspec/changes/adsense-readiness,
// rules PP-1…PP-5). Google's publisher policy forbids ads on screens with
// no publisher content, under construction, used for navigation/alerts, or
// carrying replicated content. index.html's deferred loader only injects
// adsbygoogle.js when the server marked the page with AD_ELIGIBLE_META, so
// the default for every page (sign-in, account, search, 404, legal, a
// third-party job copy, an empty hub) is "no ads". gtag.js is unaffected.
//
// Rollback: revert the commit that added this file and the loader check in
// index.html; nothing else depends on the marker.

export const AD_ELIGIBLE_META = '<meta name="bt-ads" content="on" />';

// Same threshold as the intent/city-hub inventory guard (intentRobots):
// below it a listing page is thin and stays out of the index.
export const MIN_LISTING_JOBS_FOR_ADS = 10;

/** The employer's own careers site — the only job copy we don't replicate from another job board. */
export const OFFICIAL_SOURCE = "Portal oficial";

export function isAdEligibleJobPage(job: { source?: string | null }, googleReady: boolean): boolean {
  return googleReady && job.source === OFFICIAL_SOURCE;
}

/** A hub, company or index listing: indexable and with enough real vacancies to be a page of its own. */
export function isAdEligibleListing(total: number | null | undefined, robots: string | null | undefined): boolean {
  if (robots && /noindex/i.test(robots)) return false;
  return typeof total === "number" && Number.isFinite(total) && total >= MIN_LISTING_JOBS_FOR_ADS;
}

export function markAdEligible(html: string): string {
  // Compare against the full tag: the shell's loader script itself
  // contains the selector text `meta[name="bt-ads"]`.
  if (html.includes(AD_ELIGIBLE_META)) return html;
  return html.replace("</head>", () => `  ${AD_ELIGIBLE_META}\n</head>`);
}

export function isMarkedAdEligible(html: string): boolean {
  return html.includes(AD_ELIGIBLE_META);
}
