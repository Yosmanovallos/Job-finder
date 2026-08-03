const HOUR_MS = 60 * 60 * 1000;

/**
 * How often each source may be re-scraped for a given role, keyed by the
 * adapter's `.name`. Fragile/no-official-API sources get longer gaps;
 * official APIs (Torre) can run more often.
 *
 * Only role-scoped sources belong here — ones whose fetch() actually uses
 * the role's keywords and returns different results per role. Sources that
 * ignore keywords/role entirely (RemoteOK, GetOnBoard, WeRemoto, Jooble)
 * live in GLOBAL_SOURCE_CADENCE_MS instead: tracking their cadence per role
 * here would re-fetch the identical catalog once per active role (~30x)
 * every window for zero extra coverage.
 */
export const SOURCE_CADENCE_MS: Record<string, number> = {
  LinkedIn: 4 * HOUR_MS,
  Torre: 4 * HOUR_MS,
  Computrabajo: 6 * HOUR_MS,
  Elempleo: 6 * HOUR_MS,
  Magneto: 6 * HOUR_MS,
  // Indeed and Glassdoor started returning 403 Forbidden on every request
  // during testing (2026-07-25) — pushed out further than the other sources
  // on top of the fanout cap in their adapters, to cut total request volume
  // against them while docs/source-catalog/*.md is researched for a
  // compliant API/feed alternative.
  Indeed: 24 * HOUR_MS,
  Glassdoor: 24 * HOUR_MS
  // Workana (the keyword-based adapter, src/sources/workana.ts) deliberately
  // has NO entry here anymore — it still 403s on every request (see
  // docs/source-catalog/workana.md), so leaving it "due" only burned up to
  // 12 requests/role/window failing for zero results. Retired from the
  // cadence, not deleted (docs/WORKANA-V2-PLAN.md §3.3, option (a) —
  // reversible): its replacement, WorkanaV2 (GLOBAL_SOURCE_CADENCE_MS
  // below), fetches the same source's global catalog via a TLS-fingerprint
  // technique that gets past the same 403.
};

/**
 * Cadence for catalog-wide sources (see getDueGlobalSources in
 * scheduler-repository.ts): fetched once per window total, not once per
 * active role, so they can afford to run far more often than a per-role
 * source at the same — or lower — total request volume. RemoteOK and
 * GetOnBoard are official public JSON APIs (cheap, tolerant); WeRemoto is
 * HTML-scraped pagination with no official API, kept more conservative.
 *
 * Jooble requires JOOBLE_API_KEY (adapter no-ops without it) and its free
 * key comes with a flat 500-request allowance — the signup email doesn't
 * say it renews monthly, so treat it as a fixed budget, not a recurring
 * quota, until Jooble confirms otherwise. At 6h this is 4 req/day (~120/mo),
 * which stretches a one-time 500 to ~4 months instead of the ~20 days a 1h
 * cadence would burn through it in. Tighten this only after confirming with
 * Jooble that the 500 actually resets.
 */
// WorkanaV2 (see docs/WORKANA-V2-PLAN.md): global-catalog re-implementation
// of Workana using got-scraping's Chrome TLS/JA3 fingerprint to get past the
// Cloudflare 403 that blocks the keyword-based `Workana` adapter (see its
// entry's removal from SOURCE_CADENCE_MS below). Measured real volume is
// ~900 postings/24h window, far above what a single run's 10-page fetch can
// cover — 3h (not 4h, deliberately offset from WeRemoto's cadence) so it
// rarely lands in the same tick as WeRemoto's own sequential HTML pagination
// inside the shared GLOBAL_CATALOG_TIMEOUT_MS budget (scripts/run-scrape-tick.ts).
// Coverage of the full daily catalog relies on saveJobs' dedupe absorbing
// re-fetches of already-seen postings across runs, same as every other
// source here — tune only after watching real savedCount/duplicateCount
// ratios (plan §4/§Fase 4), not by guessing.
// Remotive moved here from SOURCE_CADENCE_MS (2026-08-03): confirmed live
// that its `search` query param no longer filters results — every request
// returns the same fixed ~31-job batch regardless of query, so the
// previous per-role keyword fanout (~20 requests/role) was firing ~20
// identical requests for zero differentiation. Now fetched once per
// window like RemoteOK/GetOnBoard. 4h — no official rate limit published,
// matches WeRemoto's conservative default for a source with no clear SLA.
export const GLOBAL_SOURCE_CADENCE_MS: Record<string, number> = {
  RemoteOK: 1 * HOUR_MS,
  GetOnBoard: 1 * HOUR_MS,
  Jooble: 6 * HOUR_MS,
  WeRemoto: 4 * HOUR_MS,
  Remotive: 4 * HOUR_MS,
  WorkanaV2: 3 * HOUR_MS
};

// --- Venezuela (backlog/venezuela-expansion.md, Día 1) ----------------------
//
// Separate maps, not new entries in the CO maps above — role_source_runs and
// source_circuit_state are both keyed only by source name (no country
// column), so a VE fetch under the SAME name as its CO counterpart would
// share that row's cadence/circuit-breaker state across countries: whichever
// country's tick ran first would silently "use up" the other's window, and a
// real block on one country's fetch would degrade the other's too. The `-VE`
// suffix on every key here is what keeps the two countries' bookkeeping rows
// disjoint — see src/sources/*-ve.ts for the adapters registered under these
// exact names.
export const SOURCE_CADENCE_MS_VE: Record<string, number> = {
  "LinkedIn-VE": 4 * HOUR_MS,
  "Computrabajo-VE": 6 * HOUR_MS
};

// Deliberately does NOT include RemoteOK/GetOnBoard/WeRemoto: those already
// return remote-scoped jobs shared across every country (country stamped
// NULL, see scrape-worker.ts) — CO's tick already fetches them, so having
// VE's tick fetch the identical catalog again would double the request
// volume for zero new coverage. Jooble is different: its API takes a
// location filter, so Jooble-VE's response is genuinely distinct content
// from CO's Jooble fetch, not a re-fetch of the same catalog.
export const GLOBAL_SOURCE_CADENCE_MS_VE: Record<string, number> = {
  "Jooble-VE": 6 * HOUR_MS
};
